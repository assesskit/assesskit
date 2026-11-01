import type { CandidateAction, CandidateView } from "@assesskit/runtime/delivery";
import type { Messages } from "../../messages/index.js";
import type { SessionClient } from "../../protocol/index.js";
import { renderActionRow } from "./action-row.js";
import { confirmationText, type PlannedAction, planActions } from "./actions.js";
import type { CommentBox } from "./comment.js";
import { confirmAction } from "./confirm.js";
import { renderNavigation } from "./navigation.js";
import { renderAttempts } from "./notices.js";
import type { Shell } from "./shell.js";
import type { MountState } from "./state.js";
import type { TimerBar } from "./timers.js";

/** What the chrome needs of the player. */
export interface ChromeContext {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The shadow root of the host, where the confirmations open and the focus is kept. */
  readonly shadow: ShadowRoot;
  /** The elements the chrome fills. */
  readonly shell: Shell;
  /** The timers. */
  readonly timers: TimerBar;
  /** The comment box. */
  readonly comment: CommentBox;
  /** The session client, which tells the age of the view. */
  readonly client: SessionClient;
  /** The state of the mounted player, which holds the view a confirmation speaks of. */
  readonly state: MountState;
  /** Whether the chrome offers Mark for review in a nonlinear part. */
  readonly marking: boolean;
  /** Sends an action at once. */
  readonly send: (action: CandidateAction) => Promise<void>;
  /** Sends an action once the interactions have settled. */
  readonly sendSettled: (action: CandidateAction) => Promise<void>;
}

/** The chrome: the navigation map, the timers, the actions, the attempts and the comment box. */
export interface Chrome {
  /**
   * Draws the chrome of a view; the control that had the focus keeps it, and the heading gets it when that control is gone.
   *
   * @see {@link https://www.w3.org/TR/WCAG22/#focus-order | WCAG 2.2, focus order}
   * @param view - The view.
   */
  render(view: CandidateView): void;
}

/**
 * Creates the chrome.
 *
 * @param context - See {@link ChromeContext}.
 * @returns The chrome.
 */
export function createChrome(context: ChromeContext): Chrome {
  const { messages, shadow, shell, timers, comment, client, state, marking, send, sendSettled } = context;

  const act = async (planned: PlannedAction): Promise<void> => {
    if (planned.confirm !== undefined) {
      if (!(await confirmAction(shadow, messages, confirmationText(planned.confirm, state.view, messages)))) return;
    }
    // A mark neither submits nor leaves the item, so it does not wait for the interactions: a recording goes on.
    await (planned.action.type === "mark" ? send : sendSettled)(planned.action);
  };

  return {
    render: (view) => {
      const focused = shadow.activeElement?.getAttribute("data-focus-id") ?? undefined;
      // After the end the map reviews: the engine takes `review` of an item and no `move`.
      const map = renderNavigation(
        view,
        messages,
        (to) => void sendSettled(view.status === "ended" ? { type: "review", item: to } : { type: "move", to }),
      );
      shell.mapSlot.replaceChildren(...(map === undefined ? [] : [map]));
      shell.layout.toggleAttribute("data-ak-map", map !== undefined);
      renderActionRow(shell.actionsSlot, planActions(view, marking), messages, (planned) => void act(planned));
      renderAttempts(shell.attempts, view, messages);
      timers.update(view.timers, client.age());
      comment.update(view);
      if (focused === undefined || focused === "comment") return;
      const target = [...shadow.querySelectorAll<HTMLElement>("[data-focus-id]")].find(
        (each) =>
          each.getAttribute("data-focus-id") === focused && !(each instanceof HTMLButtonElement && each.disabled),
      );
      (target ?? shell.heading).focus();
    },
  };
}
