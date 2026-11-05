import type { CandidateView } from "@assesskit/runtime/delivery/wire";
import type { Messages } from "../../messages/index.js";
import type { SessionClient } from "../../protocol/index.js";
import { html } from "../internal.js";
import type { Announcer } from "./announcer.js";
import type { MountState } from "./state.js";

/** How often in milliseconds the player checks a test that a proctor paused; each check of a remote client is one request. */
export const RESUME_CHECK_MS = 30_000;

/** What the check for a resume needs of the player. */
export interface ResumeContext {
  /** The session client that asks the host for its view. */
  readonly client: SessionClient;
  /** The text of the interface. */
  readonly messages: Messages;
  /** The region that tells the result of a check that the candidate asked for. */
  readonly status: Announcer;
  /** The state of the mounted player, which tells the view shown and whether the player is gone. */
  readonly state: MountState;
}

/** The check of a paused test, with the button that asks for it. */
export interface ResumeWatch {
  /** The element with the button, which is hidden unless the test waits for someone else. */
  readonly element: HTMLElement;
  /**
   * Follows the view: shows the button and starts the checks while the test waits, and stops them when it does not.
   *
   * @param view - The view that is shown.
   */
  update(view: CandidateView): void;
  /** Stops the checks and takes the listeners away. */
  destroy(): void;
}

/** Whether the test is paused and the candidate has no action to continue it: a proctor has to act. */
const waitsForOthers = (view: CandidateView): boolean =>
  view.status === "suspended" && !view.actions.includes("resume");

/**
 * Creates the check of a paused test.
 *
 * @remarks
 * A candidate whom a proctor paused has no action, so the client learns of the resume only when it asks. The player asks on
 * the button, when the page becomes visible, and at the interval, for as long as the test waits for someone else. The
 * checks that the interval and the page cause are silent, and a failed one is tried again at the next; the button says what
 * it found.
 *
 * @param context - See {@link ResumeContext}.
 * @returns The check.
 */
export function createResumeWatch(context: ResumeContext): ResumeWatch {
  const { client, messages, status, state } = context;
  const button = html("button", { type: "button", class: "ak-button" }, messages.checkAgain);
  const element = html("div", { class: "ak-resume", hidden: "" }, button);
  let timer: ReturnType<typeof setInterval> | undefined;
  let checking = false;

  const stop = (): void => {
    clearInterval(timer);
    timer = undefined;
  };

  /** Asks the client for the view. Only a check that the candidate asked for says what it found. */
  const check = async (asked: boolean): Promise<void> => {
    if (checking || state.destroyed) return;
    checking = true;
    try {
      const view = await client.refresh({ signal: state.stop.signal });
      if (asked && !state.destroyed && waitsForOthers(view)) status.say(messages.stillSuspended);
    } catch {
      if (asked && !state.destroyed) status.say(messages.checkFailed);
    } finally {
      checking = false;
    }
  };

  const onVisibility = (): void => {
    if (document.visibilityState === "visible" && waitsForOthers(state.view)) void check(false);
  };
  button.addEventListener("click", () => void check(true));
  document.addEventListener("visibilitychange", onVisibility);

  return {
    element,
    update: (view) => {
      const waiting = waitsForOthers(view);
      element.hidden = !waiting;
      if (!waiting) stop();
      else if (timer === undefined) timer = setInterval(() => void check(false), RESUME_CHECK_MS);
    },
    destroy: () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
