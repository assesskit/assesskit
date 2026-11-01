import { createLtiSlot } from "../lti-frame/index.js";
import { createAnnouncer } from "./announcer.js";
import { mountAttachments } from "./attachments.js";
import { baseStyles } from "./base-styles.js";
import { createBody } from "./body.js";
import { createChrome } from "./chrome.js";
import { createCommentBox } from "./comment.js";
import { checkDeliveryOptions, type DeliveryOptions, type Mounted } from "./options.js";
import { createResumeWatch } from "./resume.js";
import { createSender } from "./sender.js";
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
 * - **Status messages** go to `role="status"` regions and never move the focus.
 * - **Focus** moves to the heading of the item when the item changes, and when the control that had it is gone.
 * - **Confirmations** are modal dialogs that start on the answer that goes back.
 * - **Submits** wait for the interactions to hand over what the candidate gave, such as a drawing that is still being
 *   stored.
 *
 * @param host - An element that has no shadow root. The player attaches one and draws in it. The frames of an LTI item are
 * children of `host`, which the shadow root shows through a slot.
 * @param options - See {@link DeliveryOptions}.
 * @returns The mounted player.
 * @throws `DataError` when `host` or an option is not of its type.
 * @see {@link https://www.w3.org/TR/WCAG22/#status-messages | WCAG 2.2, status messages}
 * @see {@link https://www.w3.org/TR/WCAG22/#focus-order | WCAG 2.2, focus order}
 */
export function mountDelivery(host: HTMLElement, options: DeliveryOptions): Mounted {
  checkDeliveryOptions(host, options);
  const settings = resolveSettings(options);
  const { client, messages, language, chrome, staticUrl, hooks } = settings;
  const state = createMountState(client.view);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.adoptedStyleSheets = [baseStyles(), chromeStyles()];

  const status = createAnnouncer("ak-status");
  const timerStatus = createAnnouncer("ak-timer-status");
  const timers = createTimerBar(messages, language, timerStatus);
  const sender = createSender({ client, messages, status, state });
  const comment = createCommentBox(messages, sender.comment);
  const resume = createResumeWatch({ client, messages, status, state, everyMs: settings.resumeCheckMs });
  const lti = createLtiSlot({
    host,
    messages,
    login: hooks.ltiLogin,
    refused: [window.location.origin, new URL(staticUrl, window.location.href).origin],
  });
  const shell = createShell({
    ...settings,
    timers: timers.element,
    timerStatus: timerStatus.element,
    status: status.element,
    lti: lti.element,
    comment: comment.element,
    resume: resume.element,
  });
  const body = createBody({ ...settings, state, sender, host: shell.contentHost });
  shadow.append(shell.app);
  const attachments = mountAttachments({ ...settings, state, sender, shell, body });
  const chromeView = chrome
    ? createChrome({ messages, shadow, shell, timers, comment, client, state, sendSettled: body.sendSettled })
    : undefined;

  const update = createUpdate({ ...settings, state, shell, body, attachments, chromeView, lti, resume });
  const unsubscribe = client.subscribe(update);
  const ticker = setInterval(() => timers.tick(client.age()), TICK_MS);
  update(client.view);

  return {
    update,
    settled: body.settled,
    destroy: () => {
      if (state.destroyed) return;
      state.destroyed = true;
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
