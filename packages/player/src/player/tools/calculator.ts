import type { CalculatorInfo } from "@assesskit/runtime/asi";
import type { Messages } from "../../messages/index.js";
import { html } from "../dom.js";
import {
  BASIC_KEYS,
  type CalculatorKey,
  type CalculatorState,
  INITIAL_STATE,
  KEYBOARD_KEYS,
  press,
  STANDARD_ONLY_KEYS,
} from "./calculator-engine.js";
import type { OpenTool, ToolContext } from "./context.js";
import { viewFile } from "./file-viewer.js";
import type { BuiltInCalculator } from "./model.js";
import { materialName } from "./names.js";
import { createPanel } from "./panel.js";

/** What a key shows, and the message that names it for assistive technology; the digits name themselves. */
const KEY_FACES: ReadonlyMap<CalculatorKey, readonly [string, keyof Messages]> = new Map([
  ["decimal", [".", "calculatorDecimal"]],
  ["add", ["+", "calculatorAdd"]],
  ["subtract", ["\u2212", "calculatorSubtract"]],
  ["multiply", ["\u00d7", "calculatorMultiply"]],
  ["divide", ["\u00f7", "calculatorDivide"]],
  ["equals", ["=", "calculatorEquals"]],
  ["clear", ["C", "calculatorClear"]],
  ["square-root", ["\u221a", "calculatorSquareRoot"]],
  ["percent", ["%", "calculatorPercent"]],
  ["sign", ["\u00b1", "calculatorSign"]],
  ["memory-clear", ["MC", "calculatorMemoryClear"]],
  ["memory-recall", ["MR", "calculatorMemoryRecall"]],
  ["memory-add", ["M+", "calculatorMemoryAdd"]],
  ["memory-subtract", ["M\u2212", "calculatorMemorySubtract"]],
]);

/** The rows of keys of the basic calculator, and of the standard one, which has the keys of the basic one below its own. */
const KEYPAD: readonly (readonly CalculatorKey[])[] = [
  ["7", "8", "9", "divide"],
  ["4", "5", "6", "multiply"],
  ["1", "2", "3", "subtract"],
  ["0", "decimal", "equals", "add"],
];
const LAYOUTS = {
  basic: [["clear"], ...KEYPAD],
  standard: [
    ["memory-clear", "memory-recall", "memory-add", "memory-subtract"],
    ["clear", "sign", "percent", "square-root"],
    ...KEYPAD,
  ],
} as const satisfies Readonly<Record<BuiltInCalculator, readonly (readonly CalculatorKey[])[]>>;

/** The keys a type of calculator has. */
const KEYS_OF: Readonly<Record<BuiltInCalculator, ReadonlySet<CalculatorKey>>> = {
  basic: new Set<CalculatorKey>(BASIC_KEYS),
  standard: new Set<CalculatorKey>([...BASIC_KEYS, ...STANDARD_ONLY_KEYS]),
};

/** The columns of the keypad, which a row of fewer keys spans. */
const COLUMNS = 4;

/**
 * Opens the basic or the standard calculator (BPIG §3.7.8.1; the player design D1). The candidate operates it with the
 * buttons or by typing: digits, the decimal point, the four operations, `=` or Enter, `%`, and Escape or Delete to clear.
 * Typing works while the focus is anywhere in the calculator, but Enter still presses the focused button. The file of
 * the calculator that the item gives, if any, is shown below the keys.
 */
export function openCalculator(
  context: ToolContext,
  type: BuiltInCalculator,
  description: string | null,
  file: CalculatorInfo | null,
  close: () => void,
): OpenTool {
  const { messages } = context;
  const title = type === "basic" ? messages.toolBasicCalculator : messages.toolStandardCalculator;
  const panel = createPanel(context, title, close);
  const keys = KEYS_OF[type];
  let state: CalculatorState = INITIAL_STATE;

  const display = html("output", { class: "ak-display", tabindex: "0", "aria-label": messages.calculatorDisplay });
  const memory = html("span", { class: "ak-memory", role: "img", "aria-label": messages.calculatorMemory }, "M");
  const render = (): void => {
    display.textContent = state.error ? messages.calculatorError : state.display;
    memory.hidden = state.memory === 0;
  };
  const pressKey = (key: CalculatorKey): void => {
    state = press(state, key);
    render();
  };

  const keypad = html("div", { class: "ak-keys" });
  for (const row of LAYOUTS[type]) {
    for (const key of row) {
      const face = KEY_FACES.get(key);
      const button = html(
        "button",
        { type: "button", class: "ak-button", ...(face === undefined ? {} : { "aria-label": messages[face[1]] }) },
        face === undefined ? key : face[0],
      );
      button.style.gridColumn = `span ${COLUMNS / row.length}`;
      button.addEventListener("click", () => pressKey(key));
      keypad.append(button);
    }
  }
  panel.body.append(
    html(
      "div",
      { class: "ak-calculator" },
      ...(description === null ? [] : [html("p", {}, description)]),
      html("div", { class: "ak-screen" }, memory, display),
      keypad,
    ),
    // The calculator is available at the location of its file (INFO §5.24.3); the viewer shows it without running it.
    ...(file === null
      ? []
      : [html("div", { role: "group", "aria-label": materialName(file) }, viewFile(context, file))]),
  );
  panel.element.addEventListener("keydown", (event) => {
    const key = KEYBOARD_KEYS.get(event.key);
    if (key === undefined || !keys.has(key) || event.ctrlKey || event.altKey || event.metaKey) return;
    // Enter presses the button that has the focus, as it does everywhere.
    if (event.target instanceof HTMLButtonElement && event.key === "Enter") return;
    event.preventDefault();
    pressKey(key);
  });
  render();

  return { focus: () => display.focus(), destroy: () => panel.remove() };
}
