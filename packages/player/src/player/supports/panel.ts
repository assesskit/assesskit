import type { SupportView } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { SupportName } from "@assesskit/runtime/pnp";
import { checkFunction, checkProperties, checkRecord, describe } from "../../checks.js";
import type { Messages } from "../../messages/index.js";
import { checkMessages } from "../../messages/internal.js";
import { html } from "../internal.js";
import { checkSupportViews } from "./check.js";
import { supportLabel } from "./names.js";
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

function checkPanelOptions(host: unknown, options: unknown): asserts options is SupportPanelOptions {
  if (!(host instanceof HTMLElement && host.isConnected)) {
    throw new DataError(`The host must be an element in a document, found ${describe(host)}.`);
  }
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", ["messages", "onSupport"]);
  checkMessages(options.messages);
  checkFunction(options.onSupport, "The option onSupport must be a function");
}

/**
 * Mounts the panel of the supports of the candidate.
 *
 * @remarks
 * The panel is a region with a toggle button for each support that can be turned on and off, named after the support, and
 * a line with the state of each support that cannot. It sends no action itself: `onSupport` gets the request.
 *
 * @param host - The element that gets the panel, in a document or a shadow root.
 * @param options - See {@link SupportPanelOptions}.
 * @returns The handle that updates the panel and takes it away.
 * @throws `DataError` when `host` or an option is not valid.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, personal needs and preferences}
 */
export function mountSupportPanel(host: HTMLElement, options: SupportPanelOptions): SupportPanel {
  checkPanelOptions(host, options);
  const { messages, onSupport } = options;
  const release = adoptSupportStyles(host);
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
