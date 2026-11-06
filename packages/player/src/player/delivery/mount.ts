import { shadowRootOf } from "../internal.js";
import { createLtiSlot } from "../lti-frame/index.js";
import { createAnnouncer, keepRoomOf } from "./announcer.js";
import { mountAttachments } from "./attachments.js";
import { baseStyles } from "./base-styles.js";
import { createBody } from "./body.js";
import { createChrome } from "./chrome.js";
import { createCommentBox } from "./comment.js";
import { bindToLifetime } from "./lifetime.js";
import { checkDeliveryOptions, type DeliveryOptions, type Mounted } from "./options.js";
import { createResumeWatch, RESUME_MESSAGES } from "./resume.js";
import { createSender, SENDER_MESSAGES } from "./sender.js";
import { resolveSettings } from "./settings.js";
import { createShell } from "./shell.js";
import { createMountState } from "./state.js";
import { chromeStyles } from "./styles.js";
import { createTimerBar } from "./timers.js";
import { createUpdate } from "./update.js";

/** How often the timers count down on screen, in milliseconds. */
const TICK_MS = 1000;

/**
 * Mounts the player on a session: the chrome and the content of the view the session client holds, following it as it
 * changes.
 *
 * @remarks
 * The chrome is the navigation map, the timers with their warnings, the actions with their confirmations, the comment box,
 * the attempts, the panel of the supports that are options, and a status line that tells what the engine refused. The
 * content is a content root, which takes the supports that are on; portable custom interactions run in their frames. The
 * player decides nothing of QTI: it sends the actions that the engine lists and shows what the engine answers.
 *
 * - **Status messages** go to `role="status"` regions that keep their room whether or not they hold text, and never move the
 *   focus.
 * - **Focus** moves to the heading of the item when the item changes, and when the control that had it is gone.
 * - **Confirmations** are modal dialogs that start on the answer that goes back.
 * - **Submits** wait for the interactions to hand over what the candidate gave, such as a drawing that is still being
 *   stored.
 *
 * @param host - An element that has no shadow root, or one that an earlier mount of the player left empty. The player attaches one, or uses that one, and draws in it. The frames of an LTI item are
 * children of `host`, which the shadow root shows through a slot.
 * @param options - See {@link DeliveryOptions}.
 * @returns The mounted player.
 * @throws `DataError` when `host` or an option is not of its type.
 * @see {@link https://www.w3.org/TR/WCAG22/#status-messages | WCAG 2.2, status messages}
 * @see {@link https://www.w3.org/TR/WCAG22/#focus-order | WCAG 2.2, focus order}
 * @example
 * ```ts
 * import { readAsi } from "@assesskit/runtime/asi";
 * import { createLocalSession } from "@assesskit/player/client/local";
 * import { mountDelivery } from "@assesskit/player/player";
 * import css from "@assesskit/player/player.css?inline"; // any bundler that imports a file as text
 *
 * const { item } = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
 *     identifier="q1" title="Question" adaptive="false" time-dependent="false">
 *   <qti-item-body><p>Hello</p></qti-item-body>
 * </qti-assessment-item>`);
 * const saved = new Map();
 * const client = await createLocalSession({
 *   definition: { kind: "item", item, base: "items/q1.xml" },
 *   store: {
 *     load: async (session) => saved.get(session),
 *     save: async (session, { state }) => void saved.set(session, state),
 *   },
 *   session: "preview-1",
 *   seed: 1,
 *   assets: (path) => `https://assets.example/package/${path}`,
 * });
 *
 * const stylesheet = new CSSStyleSheet();
 * stylesheet.replaceSync(css);
 * const host = document.createElement("div");
 * document.body.append(host);
 * const mounted = mountDelivery(host, {
 *   client,
 *   files: {
 *     upload: async (bytes, mimeType) => ({ reference: "f1", mimeType }),
 *     read: async () => new Uint8Array(),
 *     url: (file) => `/files/${file.reference}`,
 *     reserve: async (mimeType) => ({ reference: "f2", mimeType }),
 *     fill: async (file, bytes) => undefined,
 *   },
 *   staticUrl: "https://assets.example/static/",
 *   stylesheet,
 *   fetch: (url, init) => fetch(url, init),
 *   language: "id",
 * });
 * await mounted.settled();
 * host.shadowRoot.querySelector(".ak-heading")?.textContent; // => "Question"
 * mounted.destroy();
 * ```
 */
export function mountDelivery(host: HTMLElement, options: DeliveryOptions): Mounted {
  checkDeliveryOptions(host, options);
  const resolved = resolveSettings(options);
  const state = createMountState(resolved.client.view);
  const settings = bindToLifetime(resolved, state);
  const { client, messages, language, chrome, marking, staticUrl, ltiLogin } = settings;
  const shadow = shadowRootOf(host);
  shadow.adoptedStyleSheets = [baseStyles(), chromeStyles()];

  const status = createAnnouncer("ak-status");
  const timerStatus = createAnnouncer("ak-timer-status");
  const timers = createTimerBar(messages, language, timerStatus);
  const sender = createSender({ client, messages, status, state, report: settings.report });
  const comment = createCommentBox(messages, sender.comment);
  const resume = createResumeWatch({ client, messages, status, state });
  const lti = createLtiSlot({
    host,
    messages,
    login: ltiLogin,
    refused: [window.location.origin, new URL(staticUrl, window.location.href).origin],
    report: settings.report,
  });
  const shell = createShell({
    ...settings,
    timers: timers.element,
    timerStatus: timerStatus.element,
    // A host that draws its own controls puts them after the player, so the status keeps the room of its longest message.
    status: keepRoomOf(
      status.element,
      [...SENDER_MESSAGES, ...RESUME_MESSAGES].map((key) => messages[key]),
    ),
    lti: lti.element,
    comment: comment.element,
    resume: resume.element,
  });
  const body = createBody({ ...settings, state, sender, host: shell.contentHost });
  shadow.append(shell.app);
  const attachments = mountAttachments({ ...settings, state, sender, shell, body });
  const chromeView = chrome
    ? createChrome({
        messages,
        shadow,
        shell,
        timers,
        comment,
        client,
        state,
        marking,
        send: sender.send,
        sendSettled: body.sendSettled,
      })
    : undefined;

  const update = createUpdate({ ...settings, state, shell, body, attachments, chromeView, lti, resume });
  const unsubscribe = client.subscribe(update);
  const ticker = setInterval(() => timers.tick(client.age()), TICK_MS);
  update(client.view);

  return {
    settled: body.settled,
    destroy: () => {
      if (state.destroyed) return;
      state.destroyed = true;
      state.stop.abort();
      unsubscribe();
      clearInterval(ticker);
      resume.destroy();
      attachments.tools?.destroy();
      attachments.supports.destroy();
      status.stop();
      timerStatus.stop();
      lti.destroy();
      void body.pci.reset().then(() => body.content.destroy());
      shadow.replaceChildren();
    },
  };
}
