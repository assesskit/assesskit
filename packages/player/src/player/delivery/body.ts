import type { CandidateAction, CandidateItem, CandidateView } from "@assesskit/runtime/delivery";
import {
  createInteractionRenderers,
  END_ATTEMPT_EVENT,
  InteractionElement,
  RESPONSE_EVENT,
} from "../elements/index.js";
import { createMathTypesetter } from "../math/index.js";
import { type ContentRoot, createContentRoot } from "../roots/index.js";
import { modalFeedbackOf, rootContentOf } from "./content.js";
import { createPciHost, type PciHost } from "./pci.js";
import type { Sender } from "./sender.js";
import type { Settings } from "./settings.js";
import { itemId, type MountState, signature } from "./state.js";

/** What the body of the player needs of it. */
export interface BodyContext
  extends Pick<
    Settings,
    | "messages"
    | "language"
    | "origins"
    | "client"
    | "report"
    | "files"
    | "staticUrl"
    | "stylesheet"
    | "fetch"
    | "mathjax"
    | "hooks"
  > {
  /** The state of the mounted player. */
  readonly state: MountState;
  /** Sends the responses and the end of an attempt that the interactions give. */
  readonly sender: Sender;
  /** The element that becomes the content root. */
  readonly host: HTMLElement;
}

/** The content of the item presented: the content root with the interactions bound to the view. */
export interface Body {
  /** The content root. */
  readonly content: ContentRoot;
  /** The host of the portable custom interactions in the content. */
  readonly pci: PciHost;
  /** Resolves when the interactions have handed over what the candidate gave, and the responses are on their way to the session. */
  settled(): Promise<void>;
  /** Sends an action that submits or leaves the item once its interactions have settled, so that a pending drawing is in what goes. */
  sendSettled(action: CandidateAction): Promise<void>;
  /**
   * Shows the body of a view when it differs from what is shown: a new item, or the same one with another status or
   * answers to review.
   *
   * @param view - The view.
   * @returns Whether the content was drawn again, or `undefined` when the player was destroyed while it was drawn.
   */
  showBody(view: CandidateView): Promise<boolean | undefined>;
  /** Shows the modal feedback of a view once, when the item or the attempt or the feedback is new. */
  showModal(view: CandidateView): Promise<void>;
}

/**
 * Gives the interaction elements of the content what the view says: the descriptor, whether the candidate can respond,
 * and, when the content was just drawn or the item is not interacting (review, solution), the response.
 *
 * @remarks
 * While the candidate interacts the element holds the response: a view that answers an earlier request must not take
 * back what was typed since.
 *
 * @param elements - The interaction elements of the content that is shown.
 * @param item - The item presented.
 * @param drawn - Whether the content was just drawn.
 */
function bindInteractions(elements: readonly InteractionElement[], item: CandidateItem, drawn: boolean): void {
  const interacting = item.status === "interacting";
  for (const element of elements) {
    const descriptor = item.interactions.find(
      ({ responseIdentifier }) => responseIdentifier === element.responseIdentifier,
    );
    if (descriptor === undefined) continue;
    element.descriptor = descriptor;
    element.disabled = !interacting;
    if (drawn || !interacting) element.value = item.responses.get(element.responseIdentifier) ?? null;
  }
}

/** Creates the host of the portable custom interactions, which report to the sender. */
function createPci(context: BodyContext): PciHost {
  const { messages, language, staticUrl, origins, files, client, state, sender, report } = context;
  return createPciHost({
    report,
    messages,
    language,
    staticUrl,
    origins,
    files,
    fetch: context.fetch,
    assets: (path) => client.assets(path),
    item: () => state.view.current,
    respond: sender.respond,
  });
}

/** Creates the content root of the player, with the renderers of the interactions of the package and the host's hooks. */
function createRoot(context: BodyContext, pci: PciHost): ContentRoot {
  const { messages, client, files, staticUrl, hooks, mathjax } = context;
  return createContentRoot(context.host, {
    messages,
    assets: (path) => client.assets(path),
    fetch: context.fetch,
    stylesheet: context.stylesheet,
    origins: context.origins,
    interactions: new Map([
      ...createInteractionRenderers({
        messages,
        files,
        staticUrl,
        ...(hooks.record === undefined ? {} : { record: hooks.record }),
        ...(hooks.customInteraction === undefined ? {} : { customInteraction: hooks.customInteraction }),
      }),
      ["portable-custom-interaction", pci.render],
    ]),
    fileUrl: (file) => files.url(file),
    ...(mathjax === undefined ? {} : { typesetter: createMathTypesetter(mathjax) }),
  });
}

/**
 * Creates the body of the player: the content root, and the listeners that send what the interactions give.
 *
 * @param context - See {@link BodyContext}.
 * @returns The body.
 */
export function createBody(context: BodyContext): Body {
  const { client, state, sender } = context;
  const pci = createPci(context);
  const content = createRoot(context, pci);
  const interactionElements = (): InteractionElement[] =>
    [...content.root.querySelectorAll("*")].filter((element) => element instanceof InteractionElement);
  const settled = async (): Promise<void> => {
    await Promise.all(interactionElements().map((element) => element.settled()));
  };
  const sendSettled = async (action: CandidateAction): Promise<void> => {
    await settled();
    if (!state.destroyed) await sender.send(action);
  };

  content.root.addEventListener(RESPONSE_EVENT, (event) => {
    sender.respond(event.detail.responseIdentifier, event.detail.value);
  });
  content.root.addEventListener(END_ATTEMPT_EVENT, (event) => {
    const item = state.view.current?.key;
    if (item !== undefined) {
      void sendSettled({ type: "end-attempt", item, interaction: event.detail.responseIdentifier });
    }
  });

  return {
    content,
    pci,
    settled,
    sendSettled,
    showBody: async (view) => {
      const { current } = view;
      const body = signature([
        rootContentOf(view, client.documents),
        current?.status,
        current?.status === "interacting" ? null : current?.responses,
      ]);
      const drawn = body !== state.shown.content;
      if (drawn) {
        state.shown.content = body;
        await pci.reset();
        try {
          await content.show(rootContentOf(view, client.documents));
        } catch (error) {
          context.report(error);
        }
      }
      // The player may have been destroyed while the content was drawn.
      if (state.destroyed) return undefined;
      if (current !== undefined) bindInteractions(interactionElements(), current, drawn);
      return drawn;
    },
    showModal: async (view) => {
      const { current } = view;
      const modal =
        current === undefined || current.modalFeedback.length === 0
          ? ""
          : signature([itemId(current.key), current.numAttempts, current.modalFeedback]);
      if (modal === state.shown.modal) return;
      state.shown.modal = modal;
      if (modal !== "" && !state.destroyed) await content.showFeedback([modalFeedbackOf(current?.modalFeedback ?? [])]);
    },
  };
}
