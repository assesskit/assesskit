import type { CandidateItem, ItemKey } from "@assesskit/runtime/delivery";
import type { Messages } from "../../messages/index.js";
import type { LtiFrame } from "../../protocol/index.js";
import { html } from "../internal.js";
import { LTI_SLOT, type LtiFrameHandle, mountLtiFrame } from "./frame.js";

/** The hook of the host that starts the login of the tool of an item: its route answers with the frame of the item. */
export type LtiLogin = (item: ItemKey) => Promise<LtiFrame>;

/** What the slot of the LTI frame needs from the player. */
interface LtiSlotOptions {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The host element of the player, which gets the frames of the tool as its children. */
  readonly host: HTMLElement;
  /** The hook of the host, or `undefined` when it gave none. */
  readonly login: LtiLogin | undefined;
  /** The origins that a tool must not be served from. */
  readonly refused: readonly string[];
}

/** The place in the player where the tool of an LTI item runs. */
interface LtiSlot {
  /** The element to put in the page. */
  readonly element: HTMLElement;
  /** Shows what the current item needs: the tool of an LTI item while it is open, a note after it, and nothing for any other item. */
  update(item: CandidateItem | undefined): void;
  /** Takes the frames away. */
  destroy(): void;
}

/** Returns what the slot shows for an item: the item instance and whether it is open, or `undefined` when the item is no LTI item. */
function shownKey(item: CandidateItem | undefined): string | undefined {
  if (item?.lti === undefined) return undefined;
  return `${item.status === "interacting" ? "open" : "closed"} ${item.key.ref} ${item.key.instance}`;
}

/**
 * Creates the slot that shows the tool of an LTI item (`CandidateItem.lti`) while the item is open.
 *
 * @remarks
 * The tool is launched once for an open item and stays across the views that follow; a new item or a closed one takes it
 * away. The slot decides nothing of QTI: it shows a tool where the view says there is one.
 *
 * @param options - See {@link LtiSlotOptions}.
 * @returns The slot.
 */
export function createLtiSlot(options: LtiSlotOptions): LtiSlot {
  const { messages, login, refused, host } = options;
  const notes = html("div", { class: "ak-lti-notes" });
  const element = html("div", { class: "ak-lti" }, html("slot", { name: LTI_SLOT }), notes);
  let key: string | undefined;
  let mounted: LtiFrameHandle | undefined;

  const note = (text: string, role: "note" | "alert"): void => {
    notes.replaceChildren(html("p", { class: "ak-notice", role }, text));
  };

  const clear = (): void => {
    mounted?.destroy();
    mounted = undefined;
    notes.replaceChildren();
  };

  const launch = async (start: LtiLogin, item: ItemKey, title: string, current: string): Promise<void> => {
    try {
      const frame = await start(item);
      if (key !== current) return;
      mounted = mountLtiFrame(host, frame, { title, storageTitle: messages.ltiStorageFrame, refused });
    } catch (error) {
      if (key === current) note(messages.ltiUnavailable, "alert");
      reportError(error);
    }
  };

  return {
    element,
    update: (item) => {
      const next = shownKey(item);
      if (next === key) return;
      key = next;
      clear();
      const link = item?.lti;
      if (item === undefined || link === undefined || next === undefined) return;
      if (item.status !== "interacting") note(messages.ltiClosed, "note");
      else if (login === undefined) note(messages.ltiUnavailable, "alert");
      else void launch(login, item.key, link.title, next);
    },
    destroy: () => {
      key = undefined;
      clear();
    },
  };
}
