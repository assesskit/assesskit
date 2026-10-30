import type { CandidateAction, CandidateItem, CandidateView, ItemKey } from "@luthfanwakan/olah/delivery";
import type { Value } from "@luthfanwakan/olah/values";
import { AccessError, isDataError } from "../../errors.js";
import { selectMessages } from "../../messages/index.js";
import { html } from "../dom.js";
import {
  createInteractionRenderers,
  END_ATTEMPT_EVENT,
  InteractionElement,
  RESPONSE_EVENT,
} from "../elements/index.js";
import { createMathTypesetter } from "../math/index.js";
import { createContentRoot } from "../roots/index.js";
import { webSpeech } from "../speech/index.js";
import { confirmationText, type PlannedAction, planActions } from "./actions.js";
import { createAnnouncer } from "./announcer.js";
import { createCommentBox } from "./comment.js";
import { confirmAction } from "./confirm.js";
import { modalFeedbackOf, rootContentOf } from "./content.js";
import { renderNavigation } from "./navigation.js";
import { checkDeliveryOptions, type DeliveryOptions, type Mounted } from "./options.js";
import { createPciHost } from "./pci.js";
import { REFUSAL_MESSAGES } from "./refusals.js";
import { chromeStyles } from "./styles.js";
import { type DeliverySupports, mountDeliverySupports } from "./supports.js";
import { createTimerBar } from "./timers.js";

/** How often the timers count down on screen, in milliseconds. */
const TICK_MS = 1000;

/** Writes a value so that two of them compare as text: maps as lists of their entries. */
const signature = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) => (member instanceof Map ? [...member] : member));

const itemId = (key: ItemKey | undefined): string => (key === undefined ? "" : `${key.ref} ${key.instance}`);

/**
 * Mounts the player on a session (tempuh design §2.5): the chrome and the content of the view the session client holds,
 * following it as it changes. The chrome is the navigation map, the timers with their warnings, the actions with their
 * confirmations, the comment box, the attempts, the panel of the supports that are options, and a status line that tells
 * what the engine refused (T54 to T64). The content is a content root, which takes the supports that are on; portable
 * custom interactions run in their frames. The player decides nothing of QTI: it
 * sends the actions that the engine lists and shows what the engine answers.
 *
 * - **Status messages** go to `role="status"` regions and never move the focus (WCAG 4.1.3).
 * - **Focus** moves to the heading of the item when the item changes, and when the control that had it is gone (WCAG 2.4.3).
 * - **Confirmations** are modal dialogs that start on the answer that goes back (WCAG 3.3.4).
 * - **Submits** wait for the interactions to hand over what the candidate gave, such as a drawing that is still being stored.
 *
 * @param host - An element that has no shadow root. The player attaches one and draws in it.
 * @param options - See {@link DeliveryOptions}.
 * @returns The mounted player.
 * @throws `DataError` when `host` or an option is not of its type.
 */
export function mountDelivery(host: HTMLElement, options: DeliveryOptions): Mounted {
  checkDeliveryOptions(host, options);
  const {
    client,
    files,
    staticUrl,
    stylesheet,
    language = "en",
    origins = [],
    mathjax,
    chrome = true,
    hooks = {},
  } = options;
  const { voice = webSpeech() } = hooks;
  const messages = selectMessages(language, options.messages);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.adoptedStyleSheets = [chromeStyles()];

  const status = createAnnouncer("tempuh-status");
  const timerStatus = createAnnouncer("tempuh-timer-status");
  const timers = createTimerBar(messages, language, timerStatus);
  const heading = html("h1", { class: "tempuh-heading", tabindex: "-1" });
  const notices = html("div", { class: "tempuh-notices" });
  const attempts = html("p", { class: "tempuh-attempts" });
  const mapSlot = html("div", { class: "tempuh-map" });
  const actionsSlot = html("div", { class: "tempuh-actions", role: "group", "aria-label": messages.actionsLabel });
  const supportsSlot = html("div", { class: "tempuh-supports-slot" });
  const contentHost = html("div", { class: "tempuh-content-host" });
  let view: CandidateView = client.view;
  let destroyed = false;
  let shown = { item: "", content: "", modal: "" };

  const send = async (action: CandidateAction, applied?: () => void): Promise<void> => {
    try {
      const { refusal } = await client.dispatch(action);
      if (refusal === undefined) applied?.();
      else status.say(messages[REFUSAL_MESSAGES[refusal.code]]);
    } catch (error) {
      const rejected = isDataError(error) || error instanceof AccessError;
      status.say(rejected ? messages.sendRejected : messages.sendFailed);
      if (!rejected) reportError(error);
    }
  };

  /** Sends a response that an interaction gave, with the state of a portable custom interaction when it has one. */
  const respond = (identifier: string, value: Value | null, state?: string): void => {
    const item = view.current?.key;
    if (item === undefined || destroyed) return;
    void send(
      {
        type: "set-responses",
        item,
        responses: new Map([[identifier, value]]),
        ...(state === undefined ? {} : { pciStates: new Map([[identifier, state]]) }),
      },
      () => status.say(messages.answersSaved),
    );
  };

  const pci = createPciHost({
    messages,
    language,
    staticUrl,
    origins,
    files,
    fetch: options.fetch,
    assets: (path) => client.assets(path),
    item: () => view.current,
    respond,
  });
  const content = createContentRoot(contentHost, {
    messages,
    assets: (path) => client.assets(path),
    fetch: options.fetch,
    stylesheet,
    origins,
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
  /** Returns the interaction elements of the content now shown. */
  const interactionElements = (): InteractionElement[] =>
    [...content.root.querySelectorAll("*")].filter((element) => element instanceof InteractionElement);

  /** Resolves when the interactions have handed over what the candidate gave, and the responses are on their way to the session. */
  const settled = async (): Promise<void> => {
    await Promise.all(interactionElements().map((element) => element.settled()));
  };

  /** Sends an action that submits or leaves the item once its interactions have settled, so that a pending drawing is in what goes. */
  const sendSettled = async (action: CandidateAction): Promise<void> => {
    await settled();
    if (!destroyed) await send(action);
  };

  content.root.addEventListener(RESPONSE_EVENT, (event) => {
    respond(event.detail.responseIdentifier, event.detail.value);
  });
  content.root.addEventListener(END_ATTEMPT_EVENT, (event) => {
    const item = view.current?.key;
    if (item !== undefined) {
      void sendSettled({ type: "end-attempt", item, interaction: event.detail.responseIdentifier });
    }
  });
  const comment = createCommentBox(messages, (text) => {
    const item = view.current?.key;
    if (item !== undefined) void send({ type: "comment", item, text }, () => status.say(messages.commentSaved));
  });

  const act = async (planned: PlannedAction): Promise<void> => {
    if (planned.confirm !== undefined) {
      if (!(await confirmAction(shadow, messages, confirmationText(planned.confirm, view, messages)))) return;
    }
    await sendSettled(planned.action);
  };

  const renderActions = (planned: readonly PlannedAction[]): void => {
    const groups = (["navigate", "answer", "session"] as const).map((group) =>
      html(
        "div",
        { class: "tempuh-row" },
        ...planned
          .filter((each) => each.group === group)
          .map((each) => {
            const button = html(
              "button",
              { type: "button", class: "tempuh-button", "data-focus-id": each.id },
              messages[each.label],
            );
            button.disabled = each.disabled === true;
            button.addEventListener("click", () => void act(each));
            return button;
          }),
      ),
    );
    actionsSlot.replaceChildren(...groups.filter((group) => group.childElementCount > 0));
  };

  const renderNotices = (next: CandidateView): void => {
    const texts = [
      ...(next.status === "suspended" ? [messages.testSuspended] : []),
      ...(next.status === "ended" ? [messages.testEnded] : []),
      ...(next.status === "in-progress" && next.current === undefined ? [messages.awaitingItem] : []),
      ...(next.current?.timeDependent === true ? [messages.timeDependentNotice] : []),
    ];
    notices.replaceChildren(...texts.map((text) => html("p", { class: "tempuh-notice", role: "note" }, text)));
  };

  const renderAttempts = (next: CandidateView): void => {
    const item = next.current;
    const limited = item?.attemptsLeft !== undefined;
    attempts.hidden = item === undefined || !(limited || item.numAttempts > 1);
    attempts.textContent =
      item === undefined
        ? ""
        : `${messages.attemptsUsed}: ${item.numAttempts}${limited ? `. ${messages.attemptsLeft}: ${item.attemptsLeft}` : ""}`;
  };

  /** Draws the chrome of a view; the control that had the focus keeps it, and the heading gets it when that control is gone (WCAG 2.4.3). */
  const renderChrome = (next: CandidateView): void => {
    const focused = shadow.activeElement?.getAttribute("data-focus-id") ?? undefined;
    const map = renderNavigation(next, messages, (to) => void sendSettled({ type: "move", to }));
    mapSlot.replaceChildren(...(map === undefined ? [] : [map]));
    layout.toggleAttribute("data-tempuh-map", map !== undefined);
    renderActions(planActions(next));
    renderAttempts(next);
    timers.update(next.timers, client.age());
    comment.update(next);
    if (focused === undefined || focused === "comment") return;
    const target = [...shadow.querySelectorAll<HTMLElement>("[data-focus-id]")].find(
      (each) => each.getAttribute("data-focus-id") === focused && !(each instanceof HTMLButtonElement && each.disabled),
    );
    (target ?? heading).focus();
  };

  /**
   * Gives the interaction elements of the content what the view says: the descriptor, whether the candidate can respond,
   * and, when the content was just drawn or the item is not interacting (review, solution), the response. While the
   * candidate interacts the element holds the response: a view that answers an earlier request must not take back what
   * was typed since.
   */
  const bindInteractions = (item: CandidateItem, drawn: boolean): void => {
    const interacting = item.status === "interacting";
    for (const element of interactionElements()) {
      const descriptor = item.interactions.find(
        ({ responseIdentifier }) => responseIdentifier === element.responseIdentifier,
      );
      if (descriptor === undefined) continue;
      element.descriptor = descriptor;
      element.disabled = !interacting;
      if (drawn || !interacting) element.value = item.responses.get(element.responseIdentifier) ?? null;
    }
  };

  /** Shows the body of a view when it differs from what is shown: a new item, or the same one with another status or answers to review. */
  const renderBody = async (next: CandidateView): Promise<void> => {
    const { current } = next;
    const body = signature([
      rootContentOf(next, client.documents),
      current?.status,
      current?.status === "interacting" ? null : current?.responses,
    ]);
    const drawn = body !== shown.content;
    if (drawn) {
      shown = { ...shown, content: body };
      await pci.reset();
      try {
        await content.show(rootContentOf(next, client.documents));
      } catch (error) {
        reportError(error);
      }
    }
    if (current !== undefined) bindInteractions(current, drawn);
    supports.applyToContent(next, drawn);
  };

  /** Shows the modal feedback of a view once, when the item or the attempt or the feedback is new. */
  const renderModal = async (next: CandidateView): Promise<void> => {
    const { current } = next;
    const modal =
      current === undefined || current.modalFeedback.length === 0
        ? ""
        : signature([itemId(current.key), current.numAttempts, current.modalFeedback]);
    if (modal === shown.modal) return;
    shown = { ...shown, modal };
    if (modal !== "" && !destroyed) await content.showFeedback([modalFeedbackOf(current?.modalFeedback ?? [])]);
  };

  const layout = html(
    "div",
    { class: "tempuh-layout" },
    mapSlot,
    html(
      "main",
      { class: "tempuh-main" },
      heading,
      notices,
      supportsSlot,
      contentHost,
      attempts,
      comment.element,
      actionsSlot,
    ),
  );
  const app = html(
    "div",
    { class: "tempuh-player", lang: language },
    ...(chrome ? [timers.element] : []),
    timerStatus.element,
    layout,
    status.element,
  );
  shadow.append(app);
  const supports: DeliverySupports = mountDeliverySupports({
    messages,
    language,
    slot: supportsSlot,
    contentHost,
    content,
    pci,
    voice,
    ...(chrome ? { request: (name, active) => void send({ type: "support", name, active }) } : {}),
  });

  let chain: Promise<void> = Promise.resolve();
  const update = (next: CandidateView): void => {
    const changed = itemId(next.current?.key) !== shown.item || next.status !== view.status;
    const first = shown.item === "" && shown.content === "";
    view = next;
    heading.textContent = next.current?.title ?? next.test.title;
    renderNotices(next);
    supports.update(next);
    if (chrome) renderChrome(next);
    if (!first && changed && chrome) heading.focus();
    shown = { ...shown, item: itemId(next.current?.key) };
    chain = chain
      .then(() => (destroyed ? undefined : renderBody(next).then(() => renderModal(next))))
      .catch((error: unknown) => reportError(error));
  };

  const unsubscribe = client.subscribe(update);
  const ticker = setInterval(() => timers.tick(client.age()), TICK_MS);
  update(client.view);

  return {
    update,
    settled,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      clearInterval(ticker);
      supports.destroy();
      status.stop();
      timerStatus.stop();
      void pci.reset().then(() => content.destroy());
      shadow.replaceChildren();
    },
  };
}
