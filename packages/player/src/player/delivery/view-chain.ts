import type { CandidateView } from "@assesskit/runtime/delivery/wire";
import type { Body } from "./body.js";
import type { ContentAttachments } from "./content-attachments.js";
import type { ItemSettings } from "./settings.js";
import type { MountState } from "./state.js";

/** What drawing the content of a view needs of the player. */
export interface ViewChainContext extends Pick<ItemSettings, "client" | "report"> {
  /** The state of the mounted player. */
  readonly state: MountState;
  /** The content. */
  readonly body: Body;
  /** The supports and the lexicons. */
  readonly attachments: ContentAttachments;
  /** The tools, which follow the content once it is shown; a player without them leaves them out. */
  readonly tools: { update(view: CandidateView, redrawn: boolean): void } | undefined;
}

/**
 * Creates the function that draws the content of a view after the content of the view before, one view at a time, and then
 * what depends on it: the supports in the content, the lexicons, the tools and the modal feedback.
 *
 * @remarks
 * A failure to draw is reported to the page and does not stop the views that follow.
 *
 * @param context - See {@link ViewChainContext}.
 * @returns The function that takes a view.
 */
export function createViewChain(context: ViewChainContext): (view: CandidateView) => void {
  const { client, state, body, attachments, tools } = context;
  const { supports, lexicons } = attachments;

  const render = async (next: CandidateView): Promise<void> => {
    const drawn = await body.showBody(next);
    if (drawn !== undefined) {
      supports.applyToContent(next, drawn);
      lexicons.follow(client.documents.lexicons);
      tools?.update(next, drawn);
    }
    await body.showModal(next);
  };

  let chain: Promise<void> = Promise.resolve();
  return (next) => {
    chain = chain
      .then(() => (state.destroyed ? undefined : render(next)))
      .catch((error: unknown) => context.report(error));
  };
}
