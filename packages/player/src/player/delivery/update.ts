import type { CandidateItem, CandidateView } from "@assesskit/runtime/delivery";
import type { Attachments } from "./attachments.js";
import type { Body } from "./body.js";
import type { Chrome } from "./chrome.js";
import { renderNotices } from "./notices.js";
import type { Settings } from "./settings.js";
import type { Shell } from "./shell.js";
import { itemId, type MountState } from "./state.js";
import { createViewChain } from "./view-chain.js";

/** What showing a view needs of the player. */
export interface UpdateContext extends Pick<Settings, "client" | "messages" | "chrome"> {
  /** The state of the mounted player. */
  readonly state: MountState;
  /** The elements of the player. */
  readonly shell: Shell;
  /** The content. */
  readonly body: Body;
  /** The supports, the lexicons and the tools. */
  readonly attachments: Attachments;
  /** The chrome, or `undefined` when the host draws its own. */
  readonly chromeView: Chrome | undefined;
  /** The slot of the tool of an LTI item. */
  readonly lti: { update(item: CandidateItem | undefined): void };
  /** The check of a paused test. */
  readonly resume: { update(view: CandidateView): void };
}

/**
 * Creates the function that shows a view in place of the one before.
 *
 * @remarks
 * The chrome, the notices, the supports and the tool of an LTI item follow the view at once. The content is drawn after the
 * content of the view before, one view at a time (see `createViewChain`).
 *
 * @param context - See {@link UpdateContext}.
 * @returns The function that shows a view.
 */
export function createUpdate(context: UpdateContext): (view: CandidateView) => void {
  const { client, messages, chrome, state, shell, body, attachments, chromeView, lti, resume } = context;
  const { supports, tools } = attachments;
  const draw = createViewChain({ client, state, body, attachments, tools });

  return (next) => {
    const changed = itemId(next.current?.key) !== state.shown.item || next.status !== state.view.status;
    const first = state.shown.item === "" && state.shown.content === "";
    state.view = next;
    shell.heading.textContent = next.current?.title ?? next.test.title;
    renderNotices(shell.notices, next, messages);
    resume.update(next);
    supports.update(next);
    lti.update(next.current);
    chromeView?.render(next);
    if (!first && changed && chrome) shell.heading.focus();
    state.shown.item = itemId(next.current?.key);
    draw(next);
  };
}
