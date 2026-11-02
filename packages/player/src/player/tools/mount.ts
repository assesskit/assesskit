import { checkFunction, checkProperties, checkRecord, checkString, describe } from "@assesskit/runtime/checks";
import type { SupportView } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { SupportName } from "@assesskit/runtime/pnp";
import type { Messages } from "../../messages/index.js";
import { checkMessages } from "../../messages/internal.js";
import { deepActiveElement, html } from "../internal.js";
import { checkToolsInput } from "./check-input.js";
import type { OpenTool, ToolContext, ToolMemory, ToolSlots } from "./context.js";
import { SLOT_TOOLS, type ToolContent, type ToolEntry, type ToolsInput } from "./model.js";
import { toolName } from "./names.js";
import { openTool } from "./open.js";
import { isAbsoluteUrl } from "./package-path.js";
import { resolveTools } from "./resolve.js";
import { adoptStageStyles, adoptToolStyles } from "./styles.js";

/** The options of {@link mountTools}. */
export interface ToolsOptions {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of the interface, a BCP 47 tag, which the tools of the host get. */
  readonly language: string;
  /**
   * The element that holds the rendered item, in the document or in a shadow root.
   *
   * @remarks
   * It must be positioned (a `position` other than `static`): the rule, the protractor and the line reader lie over it
   * in a layer that the mount appends to it, the line reader follows its text and answer masking covers its choice
   * interactions.
   */
  readonly stage: HTMLElement;
  /** Turns the path of a file in the package into the URL to load it from. */
  readonly assets: (path: string) => string;
  /**
   * The tools that the host provides.
   *
   * @defaultValue None
   */
  readonly slots?: ToolSlots;
  /**
   * Called when the candidate turns on or off a tool that a support of the profile puts on the screen.
   *
   * @remarks
   * The tool follows the `active` flag of the next input, not the candidate's request.
   */
  readonly onSupport: (name: SupportName, active: boolean) => void;
}

/** The tools of an item and a candidate, mounted. */
export interface Tools {
  /**
   * Shows the tools in force for an item and the candidate: a button for each in the toolbar, and the open ones.
   *
   * @remarks
   * Tools that stay in force stay open, and the others go.
   *
   * @param input - The companion materials of the item and the supports of the candidate.
   * @throws `DataError` when `input` is not valid, or a function of `slots` returns something other than a function; a
   * function of `slots` that throws makes it throw the same error.
   */
  update(input: ToolsInput): void;
  /** Takes the tools down and gives the stage back as it was. */
  destroy(): void;
}

/** The names of content that the host did not name: no marks outlast the next `update`. */
const UNNAMED: ToolContent = { item: "", stimuli: [] };

/** A tool in force, with its button and what it has open. */
interface Instance {
  entry: ToolEntry;
  readonly button: HTMLButtonElement;
  opened: OpenTool | null;
  /** Whether the focus should go into the tool when the next input opens it, because the candidate asked. */
  focusNext: boolean;
}

function checkToolsOptions(host: unknown, options: unknown): asserts options is ToolsOptions {
  if (!(host instanceof HTMLElement && host.isConnected)) {
    throw new DataError(`The host must be an element in a document, found ${describe(host)}.`);
  }
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", ["messages", "language", "stage", "assets", "slots", "onSupport"]);
  checkMessages(options.messages);
  checkString(options.language, "The option language");
  const { stage } = options;
  if (!(stage instanceof HTMLElement && stage.isConnected)) {
    throw new DataError(`The option stage must be an element in a document, found ${describe(stage)}.`);
  }
  if (getComputedStyle(stage).position === "static") {
    throw new DataError("The option stage must be positioned: its position must not be static.");
  }
  checkFunction(options.assets, "The option assets must be a function");
  checkFunction(options.onSupport, "The option onSupport must be a function");
  if (options.slots !== undefined) {
    checkRecord(options.slots, "The option slots must be an object");
    checkProperties(options.slots, "The option slots", SLOT_TOOLS);
    for (const [name, build] of Object.entries(options.slots))
      checkFunction(build, `The slot ${name} of the option slots must be a function`);
  }
}

/**
 * Returns the support that a `support` action turns on and off for the tool: only an option can be, and the runtime
 * refuses the action for any other state.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, support states}
 */
function turnable({ support }: ToolEntry): SupportView | null {
  return support?.state === "option" ? support : null;
}

/**
 * Returns whether a tool is open after an input: the tool that a `support` action turns on and off follows its support,
 * and any other starts open when its support is on, and then the candidate decides.
 */
function wantsOpen(entry: ToolEntry, fresh: boolean, opened: boolean): boolean {
  const support = turnable(entry);
  if (support !== null) return support.active;
  return fresh ? (entry.support?.active ?? false) : opened;
}

/** Names the tools for their buttons: a number follows the name of each tool that shares it with another. */
function buttonNames(entries: readonly ToolEntry[], messages: Messages): readonly string[] {
  const names = entries.map(({ spec }) => toolName(spec, messages));
  const seen = new Map<string, number>();
  return names.map((name) => {
    if (names.filter((other) => other === name).length === 1) return name;
    const number = (seen.get(name) ?? 0) + 1;
    seen.set(name, number);
    return `${name} ${number}`;
  });
}

/**
 * Mounts the tools of an item.
 *
 * @remarks
 * The toolbar goes into `host` with the physical materials and the panels of the open tools; the tools that overlay the
 * item go into a layer over the stage. The tools are the rule, the protractor, the basic, standard and scientific
 * calculators, the line reader, answer masking, the highlighter, the answer eliminator and the digital materials, and the
 * tools of the host in their slots. Every tool works by keyboard and without dragging.
 *
 * @param host - The element that gets the toolbar, in a document or a shadow root.
 * @param options - See {@link ToolsOptions}.
 * @returns The tools.
 * @throws `DataError` when `host` or an option is not valid.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, companion materials info}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, tools}
 */
export function mountTools(host: HTMLElement, options: ToolsOptions): Tools {
  checkToolsOptions(host, options);
  const { messages, language, stage, assets, slots = {}, onSupport } = options;
  const releases = [adoptToolStyles(host), adoptStageStyles(stage)];
  const toolbar = html("div", { class: "ak-row" });
  const physical = html("div", { class: "ak-physical", role: "group" });
  const tray = html("div", { class: "ak-tray" });
  const root = html("section", { class: "ak-tools", "aria-label": messages.toolsLabel }, toolbar, physical, tray);
  const layer = html("div", { class: "ak-tool-layer" });
  host.append(root);
  stage.append(layer);
  let content: ToolContent = UNNAMED;
  const memory: ToolMemory = { words: new Map(), choices: new Map() };
  const context: ToolContext = {
    messages,
    language,
    stage,
    layer,
    tray,
    assets,
    slots,
    content: () => content,
    memory,
  };
  const instances = new Map<string, Instance>();

  /** Takes the names of the content shown; content with no names leaves nothing in the memory. */
  const nameContent = (named: ToolsInput["content"]): void => {
    content = named ?? UNNAMED;
    if (named == null) {
      memory.words.clear();
      memory.choices.clear();
    }
  };

  const setOpen = (instance: Instance, open: boolean, focus: boolean): void => {
    if (open && instance.opened === null) {
      instance.opened = openTool(context, instance.entry, () => closeFromPanel(instance));
      if (focus) instance.opened.focus();
    } else if (!open && instance.opened !== null) {
      const active = deepActiveElement();
      instance.opened.destroy();
      instance.opened = null;
      // The focus was in what went; it goes to the button that opened the tool.
      if (active !== null && !active.isConnected) instance.button.focus();
    }
    instance.button.setAttribute("aria-pressed", String(instance.opened !== null));
  };
  const closeFromPanel = (instance: Instance): void => {
    instance.button.focus();
    const support = turnable(instance.entry);
    if (support === null) setOpen(instance, false, false);
    else onSupport(support.name, false);
  };
  const toggle = (instance: Instance): void => {
    const support = turnable(instance.entry);
    if (support === null) {
      setOpen(instance, instance.opened === null, true);
    } else {
      instance.focusNext = true;
      onSupport(support.name, !support.active);
    }
  };
  const create = (entry: ToolEntry): Instance => {
    const button = html("button", { type: "button", class: "ak-button", "aria-pressed": "false" });
    const instance: Instance = { entry, button, opened: null, focusNext: false };
    button.addEventListener("click", () => toggle(instance));
    return instance;
  };
  const label = (instance: Instance, name: string): void => {
    const { spec } = instance.entry;
    const icon = spec.kind === "digital" ? spec.material.resourceIcon?.value : undefined;
    instance.button.replaceChildren(
      ...(icon === undefined || isAbsoluteUrl(icon) ? [] : [html("img", { src: assets(icon), alt: "" })]),
      name,
    );
  };

  return {
    update(input) {
      checkToolsInput(input);
      nameContent(input.content);
      const { tools, physical: materials } = resolveTools(input);
      const keys = new Set(tools.map(({ key }) => key));
      for (const [key, instance] of instances) {
        if (keys.has(key)) continue;
        setOpen(instance, false, false);
        instance.button.remove();
        instances.delete(key);
      }
      const names = buttonNames(tools, messages);
      // A tool of the host that fails does not keep the others from showing; its error is thrown at the end.
      let failure: unknown;
      const buttons = tools.map((entry, index) => {
        const known = instances.get(entry.key);
        const fresh = known === undefined;
        const instance = known ?? create(entry);
        const wasOpen = instance.opened !== null;
        instances.set(entry.key, instance);
        instance.entry = entry;
        label(instance, names[index] ?? "");
        const open = wantsOpen(entry, fresh, wasOpen);
        try {
          setOpen(instance, open, open && instance.focusNext);
          if (wasOpen) instance.opened?.refresh?.();
        } catch (error) {
          failure ??= error;
        }
        instance.focusNext = false;
        return instance.button;
      });
      // Only a button that is out of place moves, so that the one that has the focus keeps it.
      for (const [index, button] of buttons.entries()) {
        if (toolbar.children[index] !== button) toolbar.insertBefore(button, toolbar.children[index] ?? null);
      }
      physical.replaceChildren(
        html("h3", {}, messages.toolPhysicalMaterials),
        html("ul", {}, ...materials.map((material) => html("li", {}, material))),
      );
      physical.setAttribute("aria-label", messages.toolPhysicalMaterials);
      physical.hidden = materials.length === 0;
      root.hidden = tools.length === 0 && materials.length === 0;
      if (failure !== undefined) throw failure;
    },
    destroy() {
      for (const instance of instances.values()) setOpen(instance, false, false);
      instances.clear();
      root.remove();
      layer.remove();
      for (const release of releases) release();
    },
  };
}
