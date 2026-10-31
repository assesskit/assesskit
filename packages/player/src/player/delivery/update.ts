import type { CandidateItem, CandidateView } from "@assesskit/runtime/delivery";
import type { Attachments } from "./attachments.js";
import type { Body } from "./body.js";
import type { Chrome } from "./chrome.js";
import { renderNotices } from "./notices.js";
import type { Settings } from "./settings.js";
import type { Shell } from "./shell.js";
import { itemId, type MountState } from "./state.js";

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
}

/**
 * Creates the function that shows a view in place of the one before.
 *
 * @remarks
 * The chrome, the notices, the supports and the tool of an LTI item follow the view at once. The content is drawn after the
 * content of the view before, one view at a time, and then what depends on it: the supports in the content, the lexicons and
 * the tools, and the modal feedback. A failure to draw is reported to the page and does not stop the views that follow.
 *
 * @param context - See {@link UpdateContext}.
 * @returns The function that shows a view.
 */
export function createUpdate(context: UpdateContext): (view: CandidateView) => void {
  const { client, messages, chrome, state, shell, body, attachments, chromeView, lti } = context;
  const { supports, lexicons, tools } = attachments;

  const render = async (next: CandidateView): Promise<void> => {
    const drawn = await body.showBody(next);
    if (drawn !== undefined) {
      supports.applyToContent(next, drawn);
      lexicons.follow(client.documents.lexicons);
      tools?.update(next);
    }
    await body.showModal(next);
  };

  let chain: Promise<void> = Promise.resolve();
  return (next) => {
    const changed = itemId(next.current?.key) !== state.shown.item || next.status !== state.view.status;
    const first = state.shown.item === "" && state.shown.content === "";
    state.view = next;
    shell.heading.textContent = next.current?.title ?? next.test.title;
    renderNotices(shell.notices, next, messages);
    supports.update(next);
    lti.update(next.current);
    chromeView?.render(next);
    if (!first && changed && chrome) shell.heading.focus();
    state.shown.item = itemId(next.current?.key);
    chain = chain
      .then(() => (state.destroyed ? undefined : render(next)))
      .catch((error: unknown) => reportError(error));
  };
}
