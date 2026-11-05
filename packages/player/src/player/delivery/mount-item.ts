import type { CandidateView } from "@assesskit/runtime/delivery/wire";
import { DataError } from "@assesskit/runtime/errors";
import { shadowRootOf } from "../internal.js";
import { createAnnouncer } from "./announcer.js";
import { baseStyles } from "./base-styles.js";
import { createBody } from "./body.js";
import { mountContentAttachments } from "./content-attachments.js";
import { createItemShell } from "./item-shell.js";
import { bindToLifetime } from "./lifetime.js";
import { checkItemOptions, type Mounted, type MountOptions } from "./options.js";
import { createSender } from "./sender.js";
import { resolveItemSettings } from "./settings.js";
import { createMountState } from "./state.js";
import { createViewChain } from "./view-chain.js";

/** Refuses a view that presents an item that is a link to an LTI tool, which only `mountDelivery` can start. */
function checkNoLtiItem(view: CandidateView): void {
  const item = view.current;
  if (item?.lti !== undefined) {
    throw new DataError(
      `The item ${item.key.ref} is a link to an LTI tool, which needs a login that mountItem does not start. Use mountDelivery.`,
    );
  }
}

/**
 * Mounts the content of the view that the session client holds and its interactions, and nothing else: for a page that
 * shows many items, such as a lesson.
 *
 * @remarks
 * It draws the content root with the rubric, the stimuli, the item and the modal feedback, the portable custom interactions,
 * the supports that are on and the reading aloud with its lexicons. It draws no heading, navigation map, timers, actions,
 * comment box or tools: the host sends the actions of the session client and shows what the engine refused. It does not load
 * the code of the chrome, so that a page with many items costs the content only (see the size guide).
 *
 * - **Status messages** go to one `role="status"` region that keeps its room whether or not it holds text, and never moves the
 *   focus.
 * - **Focus** moves only into a modal dialog of feedback, as a modal must, and back to where it was when the candidate closes
 *   it. Nothing else takes it from the page.
 * - **A closed item** stays drawn until `destroy`.
 * - **Submits** are the host's: it waits for `settled()` before it sends an action that submits or leaves the item.
 *
 * @param host - An element that has no shadow root, or one that an earlier mount of the player left empty. The player attaches one, or uses that one, and draws in it.
 * @param options - See {@link MountOptions}.
 * @returns The mounted player.
 * @throws `DataError` when `host` or an option is not of its type, or when the view presents an item that is a link to an LTI
 * tool.
 * @see {@link https://www.w3.org/TR/WCAG22/#status-messages | WCAG 2.2, status messages}
 * @see {@link https://www.w3.org/TR/WCAG22/#focus-order | WCAG 2.2, focus order}
 */
export function mountItem(host: HTMLElement, options: MountOptions): Mounted {
  checkItemOptions(host, options);
  const resolved = resolveItemSettings(options);
  const { client, messages, language, voice } = resolved;
  checkNoLtiItem(client.view);
  const state = createMountState(client.view);
  const settings = bindToLifetime(resolved, state);
  const shadow = shadowRootOf(host);
  shadow.adoptedStyleSheets = [baseStyles()];

  const status = createAnnouncer("ak-status");
  const sender = createSender({ client, messages, status, state, report: settings.report });
  const shell = createItemShell(language, status.element);
  const body = createBody({ ...settings, state, sender, host: shell.contentHost });
  shadow.append(shell.app);
  const attachments = mountContentAttachments({
    report: settings.report,
    client,
    messages,
    language,
    voice,
    fetch: settings.fetch,
    state,
    slot: shell.supportsSlot,
    contentHost: shell.contentHost,
    body,
  });

  const draw = createViewChain({ client, state, body, attachments, tools: undefined, report: settings.report });
  const update = (view: CandidateView): void => {
    checkNoLtiItem(view);
    state.view = view;
    attachments.supports.update(view);
    draw(view);
  };
  const unsubscribe = client.subscribe(update);
  update(client.view);

  return {
    settled: body.settled,
    destroy: () => {
      if (state.destroyed) return;
      state.destroyed = true;
      state.stop.abort();
      unsubscribe();
      attachments.supports.destroy();
      status.stop();
      void body.pci.reset().then(() => body.content.destroy());
      shadow.replaceChildren();
    },
  };
}
