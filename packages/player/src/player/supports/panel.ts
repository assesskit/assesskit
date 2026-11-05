import { describe, functionSchema, nonEmptyStringSchema, parseWith, strictRecord } from "@assesskit/runtime/checks";
import type { SupportView } from "@assesskit/runtime/delivery/wire";
import { DataError } from "@assesskit/runtime/errors";
import type { SupportName, SupportSetting } from "@assesskit/runtime/pnp";
import * as v from "valibot";
import type { Messages } from "../../messages/index.js";
import { messagesSchema } from "../../messages/internal.js";
import { html } from "../internal.js";
import { checkSupportViews } from "./check.js";
import { supportLabel } from "./names.js";
import { createSettingsControls, type SettingsControls } from "./settings.js";
import { adoptSupportStyles } from "./styles.js";

/** The options of {@link mountSupportPanel}. */
export interface SupportPanelOptions {
  /** The text of the interface. */
  readonly messages: Messages;
  /**
   * Called when the candidate asks to turn a support on or off: the host sends `{ type: "support", name, active }`.
   *
   * @remarks
   * The button follows the `active` flag of the next input, not the request, so a refusal leaves it as it was.
   */
  readonly onSupport: (name: SupportName, active: boolean) => void;
  /**
   * Called when the candidate changes a setting of a support that is on: the host sends
   * `{ type: "support-settings", settings }`. With it the panel has a list for each setting that the candidate may change
   * and the player follows: the color theme while `text-appearance` is on, the amount of magnification while
   * `magnification` is on, the preferences of the voice while `spoken` reads with `computer-read-aloud`, and those of
   * `braille`.
   *
   * @remarks
   * The settings are whole: those of the view with the value chosen. A list follows the settings of the next input, not the
   * request, so a refusal leaves it as it was.
   *
   * @defaultValue None, so that the panel has no lists
   */
  readonly onSettings?: (settings: SupportSetting) => void;
  /**
   * The language of the interface, a BCP 47 tag, in which the lists write numbers.
   *
   * @defaultValue `"en"`
   */
  readonly language?: string;
}

/** The panel of the supports of the candidate: the ones that can be turned on and off, and the state of the others. */
export interface SupportPanel {
  /**
   * Shows a button for each support of the list whose state is `option` and that the toolbar of the tools does not turn
   * on and off, pressed when the support is on.
   *
   * @remarks
   * A support that is on from the start or assigned has no button, because the runtime refuses the action for them
   * (`support-not-available`); it is listed with its state, such as "Additional testing time: on". A prohibited support
   * is not listed.
   *
   * @param supports - The supports of the view.
   * @throws `DataError` when `supports` is not a list of the runtime's `SupportView`s.
   */
  update(supports: readonly SupportView[]): void;
  /** Takes the panel away. */
  destroy(): void;
}

/** A line of the panel: a button for a support that can be turned on and off, else its state as text. */
interface Entry {
  readonly item: HTMLLIElement;
  /** The button of an option; `undefined` for a support that the candidate cannot change. */
  readonly button: HTMLButtonElement | undefined;
  /** Whether the support is on as the last input said. */
  active: boolean;
}

const panelOptionsSchema = strictRecord({
  messages: messagesSchema,
  onSupport: functionSchema<(...args: never[]) => unknown>(),
  onSettings: v.optional(functionSchema<(...args: never[]) => unknown>()),
  language: v.optional(nonEmptyStringSchema),
});

function checkPanelOptions(host: unknown, options: unknown): asserts options is SupportPanelOptions {
  if (!(host instanceof HTMLElement && host.isConnected)) {
    throw new DataError(`The host must be an element in a document, found ${describe(host)}.`);
  }
  parseWith(panelOptionsSchema, options, "The options object");
}

/**
 * Mounts the panel of the supports of the candidate.
 *
 * @remarks
 * The panel is a region with a toggle button for each support that can be turned on and off, named after the support, a
 * line with the state of each support that cannot, and with `onSettings` a list for each setting of a support that is on and
 * that the candidate may change. It sends no action itself: `onSupport` and `onSettings` get the requests.
 *
 * @param host - The element that gets the panel, in a document or a shadow root.
 * @param options - See {@link SupportPanelOptions}.
 * @returns The handle that updates the panel and takes it away.
 * @throws `DataError` when `host` or an option is not valid.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, personal needs and preferences}
 */
export function mountSupportPanel(host: HTMLElement, options: SupportPanelOptions): SupportPanel {
  checkPanelOptions(host, options);
  const { messages, onSupport, onSettings, language = "en" } = options;
  const release = adoptSupportStyles(host);
  const settings: SettingsControls | undefined =
    onSettings === undefined ? undefined : createSettingsControls({ messages, language }, onSettings);
  const list = html("ul");
  const region = html("section", { class: "ak-supports", "aria-label": messages.supportsLabel }, list);
  region.hidden = true;
  host.append(region);
  const entries = new Map<SupportName, Entry>();

  const create = (name: SupportName, label: string, option: boolean): Entry => {
    if (!option) return { item: html("li", { class: "ak-support-state" }, label), button: undefined, active: false };
    const button = html("button", { type: "button", class: "ak-support-button", "aria-pressed": "false" }, label);
    const entry: Entry = { item: html("li", {}, button), button, active: false };
    button.addEventListener("click", () => onSupport(name, !entry.active));
    return entry;
  };

  return {
    update(supports) {
      checkSupportViews(supports, "The list of supports");
      const shown = supports.flatMap((support) => {
        const label = support.state === "prohibited" ? undefined : supportLabel(support.name, messages);
        return label === undefined ? [] : [{ support, label, option: support.state === "option" }];
      });
      const kept = new Map(shown.map(({ support, option }) => [support.name, option]));
      for (const [name, entry] of entries) {
        if (kept.get(name) === (entry.button !== undefined)) continue;
        entry.item.remove();
        entries.delete(name);
      }
      const items = shown.map(({ support, label, option }) => {
        const entry = entries.get(support.name) ?? create(support.name, label, option);
        entries.set(support.name, entry);
        entry.active = support.active;
        if (entry.button === undefined) {
          entry.item.textContent = `${label}: ${support.active ? messages.supportOn : messages.supportOff}`;
        } else {
          entry.button.textContent = label;
          entry.button.setAttribute("aria-pressed", String(support.active));
        }
        return entry.item;
      });
      for (const item of settings?.update(supports) ?? []) items.push(item);
      // Only an item that is out of place moves, so that the button that has the focus keeps it.
      for (const [index, item] of items.entries()) {
        if (list.children[index] !== item) list.insertBefore(item, list.children[index] ?? null);
      }
      region.hidden = items.length === 0;
    },
    destroy() {
      region.remove();
      entries.clear();
      release();
    },
  };
}
