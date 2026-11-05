import { DataError } from "@assesskit/runtime/errors";
import { initVirtualKeyboardInCurrentBrowsingContext, MathfieldElement } from "mathlive";
import { type InstanceArguments, notifyChange, type PciInstance, takesInput } from "../frame/internal.js";
import { PCI_TYPE_IDENTIFIERS } from "../interaction-types.js";
import { buildKeyboardLayouts, type DecimalSeparator } from "./keyboard.js";
import { type StepWords, selectStepWords } from "./messages.js";
import { INLINE_SHORTCUTS } from "./shortcuts.js";

/** The folder of MathLive's fonts, beside the module: `math-entry.js` loads `math-entry/fonts/*.woff2`. */
const FONTS = "math-entry/fonts/";

/** The class of the list of worked steps, which an item's stylesheet may style. */
const STEPS_CLASS = "math-entry-steps";

/** The layout of the fields and the buttons; the item's stylesheets come after it and may change it. */
const STYLE = `qti-portable-custom-interaction math-field { display: block; min-width: 12em; font-size: 1.25em; }
.ML__keyboard { --keyboard-toolbar-text-active: var(--_toolbar-text); }
.${STEPS_CLASS} { margin: 0; padding-inline-start: 2em; }
.${STEPS_CLASS} li { display: flex; gap: 0.5em; align-items: center; margin-block-end: 0.5em; }
.${STEPS_CLASS} math-field { flex: 1; }`;

/** Reads the decimal mark of `data-decimal-separator`: `.`, the default, or `,`. */
function readSeparator(properties: Readonly<Record<string, string>>): DecimalSeparator {
  const value = properties.decimalSeparator ?? ".";
  if (value !== "." && value !== ",") {
    throw new DataError(`The attribute data-decimal-separator must be "." or ",", found ${JSON.stringify(value)}.`);
  }
  return value;
}

/** Whether the response variable holds several strings, `ordered` worked steps, from the JSON it is bound to. */
const isList = (boundTo: unknown): boolean => typeof boundTo === "object" && boundTo !== null && "list" in boundTo;

/** The strings of a value of the JSON binding, `{ base: { string } }` or `{ list: { string: [] } }`; none for NULL. */
function stringsOf(json: unknown): readonly string[] {
  const value: unknown =
    typeof json === "object" && json !== null ? (Reflect.get(json, "base") ?? Reflect.get(json, "list")) : null;
  const strings: unknown = typeof value === "object" && value !== null ? Reflect.get(value, "string") : undefined;
  if (typeof strings === "string") return [strings];
  return Array.isArray(strings) ? strings.filter((line): line is string => typeof line === "string") : [];
}

/** The lines of a state that `getState` gave, or `undefined` when it is not one. */
function linesOfState(state: string | undefined): readonly string[] | undefined {
  if (state === undefined || state === "") return undefined;
  try {
    const lines: unknown = JSON.parse(state);
    return Array.isArray(lines) && lines.every((line) => typeof line === "string") ? lines : undefined;
  } catch {
    return undefined;
  }
}

/** Sets MathLive up for the frame: fonts from the package, no sounds, the item's decimal mark, a keyboard of its own. */
function configureMathLive(moduleUrl: string, separator: DecimalSeparator, language: string): void {
  MathfieldElement.fontsDirectory = new URL(FONTS, moduleUrl).href;
  MathfieldElement.soundsDirectory = null;
  MathfieldElement.decimalSeparator = separator;
  MathfieldElement.locale = language;
  // MathLive in a frame puts a proxy on the window that shows the keyboard in the top window, which a sandboxed frame cannot
  // reach; the proxy also posts to the frame's own origin, which is opaque, and `postMessage` throws on the target "null".
  // The frame drops the proxy unread and mounts MathLive's keyboard in its own document.
  Object.defineProperty(window, "mathVirtualKeyboard", { value: undefined, configurable: true, writable: true });
  initVirtualKeyboardInCurrentBrowsingContext();
  window.mathVirtualKeyboard.layouts = buildKeyboardLayouts(separator);
}

/**
 * Lets Tab and Shift+Tab leave a field where MathLive has nowhere to go, so that the browser moves the focus on in the
 * page's order, out of the frame past its last element.
 *
 * @remarks
 * MathLive keeps the key either way and moves the focus only among the elements of the frame's document, so a keyboard
 * stays in a frame of one field. The handler runs MathLive's command for the key with the `move-out` event that tells of
 * the dead end cancelled, and holds the key back from MathLive. Tab in LaTeX mode accepts a suggestion, and stays
 * MathLive's.
 *
 * @see {@link https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html | Understanding WCAG 2.2, 2.1.2 No Keyboard Trap}
 */
function leaveOnTab(field: MathfieldElement, event: KeyboardEvent): void {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  if (field.mode === "latex" && !event.shiftKey) return;
  let deadEnd = false;
  const onMoveOut = (moveOut: Event): void => {
    moveOut.preventDefault();
    deadEnd = true;
  };
  field.addEventListener("move-out", onMoveOut);
  try {
    field.executeCommand(event.shiftKey ? "moveToPreviousGroup" : "moveToNextGroup");
  } finally {
    field.removeEventListener("move-out", onMoveOut);
  }
  event.stopPropagation();
  if (!deadEnd) event.preventDefault();
}

/**
 * Creates the math entry interaction: a MathLive field whose value, LaTeX, is the response, or one field a line for worked
 * steps when the response variable is `ordered`.
 *
 * @param args - The arguments of `getInstance` and the URL of the module.
 * @returns The instance.
 * @throws `DataError` when `data-decimal-separator` is neither `.` nor `,`.
 */
export function createMathEntry(args: InstanceArguments): PciInstance {
  const { dom, configuration, state } = args;
  const separator = readSeparator(configuration.properties);
  const language = document.documentElement.lang || "en";
  configureMathLive(args.moduleUrl, separator, language);
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.prepend(style);

  const steps = isList(configuration.boundTo);
  const editable = takesInput(configuration.status);
  const fields: MathfieldElement[] = [];
  const changed = (): void => notifyChange(instance, args);

  const createField = (value: string): MathfieldElement => {
    // MathLive takes options before the field is in the document only through its constructor.
    const field = new MathfieldElement({
      inlineShortcuts: INLINE_SHORTCUTS,
      mathVirtualKeyboardPolicy: "auto",
      readOnly: !editable,
    });
    field.value = value;
    field.addEventListener("input", changed);
    // MathLive focuses its field from a timer after the press, and Firefox lets that focus in only when the frame's window
    // has the focus already: the window takes it with the press, or a press that follows a frame removed while it had the
    // focus leaves the field deaf to the keys while MathLive takes it for focused.
    field.addEventListener("pointerdown", () => window.focus(), { capture: true });
    // Before MathLive, which takes every Tab: the field is the host of the element that has the focus.
    field.addEventListener("keydown", (event) => leaveOnTab(field, event), { capture: true });
    return field;
  };

  const instance: PciInstance = {
    typeIdentifier: PCI_TYPE_IDENTIFIERS["math-entry"],
    getResponse: () => {
      const values = fields.map((field) => field.value).filter((value) => value !== "");
      if (steps) return { list: values.length === 0 ? null : { string: values } };
      return { base: values[0] === undefined ? null : { string: values[0] } };
    },
    getState: () => JSON.stringify(fields.map((field) => field.value)),
    oncompleted: () => {
      if (window.mathVirtualKeyboard.visible) window.mathVirtualKeyboard.hide();
    },
  };

  const lines = linesOfState(state) ?? stringsOf(configuration.boundTo);
  if (steps) {
    mountSteps(dom, lines, {
      createField,
      fields,
      changed,
      editable,
      words: selectStepWords(language, configuration.properties),
    });
  } else {
    const field = createField(lines[0] ?? "");
    field.setAttribute("aria-label", document.title);
    fields.push(field);
    dom.append(field);
  }
  configuration.onready(instance, state);
  return instance;
}

/** What the list of worked steps needs from the interaction. */
interface StepsContext {
  readonly createField: (value: string) => MathfieldElement;
  /** The fields, in the order of the lines, which the list keeps current. */
  readonly fields: MathfieldElement[];
  readonly changed: () => void;
  readonly editable: boolean;
  readonly words: StepWords;
}

/**
 * Mounts worked steps: a numbered list with a field a line, a button that removes each line and one that adds a line;
 * Enter in a field adds the next line after it.
 */
function mountSteps(dom: HTMLElement, lines: readonly string[], context: StepsContext): void {
  const { createField, fields, changed, editable, words } = context;
  const list = document.createElement("ol");
  list.className = STEPS_CLASS;
  dom.append(list);

  const relabel = (): void => {
    fields.forEach((field, index) => {
      field.setAttribute("aria-label", `${words.step} ${index + 1}`);
      field.parentElement?.querySelector("button")?.setAttribute("aria-label", `${words.removeStep} ${index + 1}`);
    });
  };

  const insertLine = (value: string, after: number): MathfieldElement => {
    const field = createField(value);
    const item = document.createElement("li");
    item.append(field);
    if (editable) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        const index = fields.indexOf(field);
        fields.splice(index, 1);
        item.remove();
        relabel();
        (fields[Math.max(0, index - 1)] ?? add).focus();
        changed();
      });
      item.append(remove);
      // Before MathLive, which takes Enter to commit its value: the field is the host of the element that has the focus.
      field.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Enter" || event.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          insertLine("", fields.indexOf(field)).focus();
          changed();
        },
        { capture: true },
      );
    }
    const next = fields[after + 1]?.parentElement ?? null;
    list.insertBefore(item, next);
    fields.splice(after + 1, 0, field);
    relabel();
    return field;
  };

  const add = document.createElement("button");
  add.type = "button";
  add.textContent = words.addStep;
  add.addEventListener("click", () => {
    insertLine("", fields.length - 1).focus();
    changed();
  });

  for (const line of lines.length === 0 ? [""] : lines) insertLine(line, fields.length - 1);
  if (editable) dom.append(add);
}
