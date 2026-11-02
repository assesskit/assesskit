import { checkString, describe } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import type { Presentation } from "../presentation/index.js";
import { checkPresentation } from "../presentation/internal.js";
import { checkPciFrameOptions } from "./check-options.js";
import { describeFrame } from "./describe-frame.js";
import { createResponseDecoder, responseKey } from "./files.js";
import type { PciEvent, PciFrameOptions } from "./options.js";
import type { PciCommand, PciFrameMessage, PciValidityMethod, PciValidityResult } from "./protocol.js";
import { readFrameMessage } from "./read-message.js";

/** The least height of a frame in CSS pixels, so that an interaction that reports no height stays in view. */
export const MIN_PCI_HEIGHT = 48;

/**
 * The greatest height of a frame in CSS pixels, a bound against a layout that grows with its own frame.
 *
 * @remarks
 * Taller content scrolls inside the frame.
 */
export const MAX_PCI_HEIGHT = 4096;

/** How long the host waits for the frame to answer a request, in milliseconds, so that a frozen module cannot stall the player. */
const REPLY_TIMEOUT_MS = 2000;

/** The frame's document, under `staticUrl`. */
const FRAME_PATH = "pci-frame/frame.html";

/** A portable custom interaction in its frame, and the means to drive it. */
export interface PciFrame {
  /** The `iframe` element, which `mountPciFrame` appended to its parent. */
  readonly element: HTMLIFrameElement;
  /**
   * Asks the interaction whether its response is valid.
   *
   * @returns The verdict, or `undefined` when the interaction gives none, is not running, or does not answer in time.
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, validity of a portable custom interaction}
   */
  checkValidity(): Promise<boolean | undefined>;
  /**
   * Like {@link PciFrame.checkValidity}, and the interaction also shows the candidate what is invalid.
   *
   * @returns The verdict, or `undefined` when the interaction gives none, is not running, or does not answer in time.
   */
  reportValidity(): Promise<boolean | undefined>;
  /**
   * Sets the custom validity message of the interaction; the empty string clears it.
   *
   * @param message - The message.
   * @returns A promise that rejects with `DataError` when `message` is not a string.
   */
  setCustomValidity(message: string): Promise<void>;
  /**
   * Reads the custom validity message of the interaction.
   *
   * @returns The message, or `undefined` when the interaction gives none.
   */
  getCustomValidity(): Promise<string | undefined>;
  /**
   * Sets the look that the candidate's supports ask for on the `html` element of the frame, in place of the earlier one.
   *
   * @remarks
   * A setting that changes while the interaction runs reaches the interaction. A look set before the frame starts is the one
   * it starts with.
   *
   * @param presentation - The look.
   * @throws `DataError` when `presentation` is not one.
   */
  setPresentation(presentation: Presentation): void;
  /**
   * Has the interaction hand over its response and state, and resolves when the events of the frame have been delivered.
   *
   * @remarks
   * An interaction need not fire `qti-interaction-changed`: the player reads `getResponse()` and `getState()`, and delivers
   * them as a `changed` event when they differ from what the frame last told. Call it before an action that submits or
   * leaves the item. It waits at most two seconds for a frozen module, and resolves at once for a frame that is not running.
   *
   * @returns A promise that resolves when the response is delivered, its files stored.
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
   */
  settled(): Promise<void>;
  /**
   * Hands over the final response and state as a `completed` event, lets the interaction call `oncompleted`, and removes the
   * frame.
   *
   * @remarks
   * It waits at most two seconds for a frozen module, and it resolves when every event has been delivered. Calling it again
   * returns the same promise.
   *
   * @returns A promise that resolves when the frame is gone.
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
   */
  destroy(): Promise<void>;
}

type Phase = "waiting" | "started" | "closing" | "closed";

/** A message of the frame that answers a request of the player. */
type Answer = Extract<PciFrameMessage, { readonly type: "validity" | "snapshot" }>;

/** An event as the frame sent it: a response that is JSON and not yet a value. */
type RawEvent =
  | Exclude<PciFrameMessage, { readonly type: "loaded" | "height" | "validity" | "snapshot" | "completed" }>
  | { readonly type: "completed"; readonly response: unknown; readonly state: string };

function createFrameElement(staticUrl: string, title: string): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  // No allow-same-origin, so that the frame has an opaque origin: no cookies, storage or access to the player.
  frame.setAttribute("sandbox", "allow-scripts");
  // No referrer, so that the module cannot read the address of the player's page in `document.referrer`.
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = title;
  frame.src = new URL(FRAME_PATH, staticUrl).href;
  frame.style.display = "block";
  frame.style.border = "0";
  frame.style.width = "100%";
  frame.style.height = `${MIN_PCI_HEIGHT}px`;
  return frame;
}

/**
 * Mounts a portable custom interaction in a sandboxed frame and appends the frame to a parent.
 *
 * @remarks
 * The frame is an `iframe` with `sandbox="allow-scripts"` and no `allow-same-origin`, so it has an opaque origin, and with
 * `referrerpolicy="no-referrer"`, so it does not learn the address of the page; its document is `pci-frame/frame.html` under
 * `staticUrl`. The player writes the variables bound to the interaction as the
 * JSON of the binding, reading the bytes of the files among them first, and sends them with the configuration once the
 * frame says it runs. The frame restricts itself with a content security policy, loads `player.css` and the stylesheets,
 * builds the markup, loads the modules with RequireJS and creates the interaction.
 *
 * What the interaction does arrives as {@link PciEvent}s, in order. Messages from the frame are untrusted and dropped
 * unless they come from its window and have the shape of a message that the frame sends; a response that is not the JSON of
 * a value of the declaration of the response variable is dropped too, and the files of a response are stored through the
 * host before the event is delivered.
 *
 * @param parent - The element that gets the frame.
 * @param options - See {@link PciFrameOptions}.
 * @returns The frame and the means to drive it.
 * @throws `DataError` when `parent` is not an element, an option is not valid, the interaction names no module to load, a
 * module has no location, or a location in the package is on an origin that the frame loads no scripts from.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
 */
export function mountPciFrame(parent: HTMLElement, options: PciFrameOptions): PciFrame {
  if (!(parent instanceof HTMLElement))
    throw new DataError(`The parent must be an element, found ${describe(parent)}.`);
  checkPciFrameOptions(options);
  const { title, prepare } = describeFrame(options);
  const { onError = (error: unknown) => reportError(error) } = options;
  const frame = createFrameElement(options.staticUrl, title);
  const decode = createResponseDecoder(options.files);
  const starting = prepare().catch((error: unknown) => {
    onError(error);
    return undefined;
  });
  const asked = new Map<number, (answer: Answer | undefined) => void>();
  let presentation: Presentation = options.presentation ?? { attributes: new Map(), properties: new Map() };
  let phase: Phase = "waiting";
  let nextId = 0;
  let finishClosing: (() => void) | undefined;
  let closing: Promise<void> | undefined;
  let delivery: Promise<void> = Promise.resolve();
  // The response and the state that the frame last told, as text that compares, so that `settled` hands over only what
  // changed; the frame starts with the response it is bound to.
  let heard: string | undefined;
  let boundTo: unknown;
  const heardOf = (response: unknown, state: string): string =>
    JSON.stringify([responseKey(response, options.response.declaration) ?? null, state]);

  // The target origin is "*" because an opaque origin cannot be named.
  const post = (command: PciCommand): void => frame.contentWindow?.postMessage(command, "*");

  const setHeight = (height: number): void => {
    frame.style.height = `${Math.min(MAX_PCI_HEIGHT, Math.max(MIN_PCI_HEIGHT, height))}px`;
  };

  const toEvent = async (raw: RawEvent): Promise<PciEvent> => {
    if (raw.type === "ready" || raw.type === "failed") return raw;
    return { ...raw, response: await decode(raw.response, options.response.declaration) };
  };

  // One chain, so that events arrive in the order they were sent although storing the files of a response takes time.
  const deliver = (raw: RawEvent): void => {
    delivery = delivery.then(async () => {
      let event: PciEvent;
      try {
        event = await toEvent(raw);
      } catch (error) {
        if (!(error instanceof DataError)) onError(error);
        return;
      }
      try {
        options.onEvent(event);
      } catch (error) {
        onError(error);
      }
    });
  };

  /** Sends the frame its start once it runs, or fails it when the files of the variables could not be read. */
  const begin = (): void => {
    phase = "started";
    void starting.then((start) => {
      if (start === undefined) {
        deliver({ type: "failed", reason: "files" });
      } else {
        boundTo = start.boundTo;
        post({ ...start, presentation });
      }
    });
  };

  /** Delivers an event of the running interaction, and notes the response and the state it tells. */
  const tell = (message: RawEvent): void => {
    if (message.type === "ready") heard = heardOf(boundTo, message.state);
    else if (message.type !== "failed") heard = heardOf(message.response, message.state);
    deliver(message);
  };

  const handle = (message: PciFrameMessage): void => {
    switch (message.type) {
      case "loaded":
        if (phase === "waiting") begin();
        break;
      case "height":
        setHeight(message.height);
        break;
      case "validity":
      case "snapshot":
        asked.get(message.id)?.(message);
        break;
      case "completed":
        if (phase === "closing") {
          if (message.flushed !== null) deliver({ type: "completed", ...message.flushed });
          finishClosing?.();
        }
        break;
      default:
        if (phase === "started") tell(message);
    }
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow) return;
    let message: PciFrameMessage;
    try {
      message = readFrameMessage(event.data);
    } catch (error) {
      if (error instanceof DataError) return;
      throw error;
    }
    handle(message);
  };

  /** Sends a request that the frame answers with a message of its `id`; `undefined` when it does not run or answer in time. */
  const request = (command: (id: number) => PciCommand): Promise<Answer | undefined> => {
    if (phase !== "started") return Promise.resolve(undefined);
    const id = nextId++;
    return new Promise((resolve) => {
      const answer = (value: Answer | undefined): void => {
        clearTimeout(timer);
        asked.delete(id);
        resolve(value);
      };
      const timer = setTimeout(answer, REPLY_TIMEOUT_MS, undefined);
      asked.set(id, answer);
      post(command(id));
    });
  };

  const ask = async (method: PciValidityMethod, message?: string): Promise<PciValidityResult> => {
    const answer = await request((id) => ({
      type: "validity",
      id,
      method,
      ...(message === undefined ? {} : { message }),
    }));
    return answer?.type === "validity" ? answer.value : undefined;
  };

  const settled = async (): Promise<void> => {
    const answer = await request((id) => ({ type: "snapshot", id }));
    const flushed = answer?.type === "snapshot" ? answer.flushed : null;
    if (phase === "started" && flushed !== null && heardOf(flushed.response, flushed.state) !== heard) {
      heard = heardOf(flushed.response, flushed.state);
      deliver({ type: "changed", ...flushed, valid: undefined });
    }
    await delivery;
  };

  const close = async (): Promise<void> => {
    if (phase === "started") {
      phase = "closing";
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, REPLY_TIMEOUT_MS);
        finishClosing = () => {
          clearTimeout(timer);
          resolve();
        };
        post({ type: "complete" });
      });
    }
    phase = "closed";
    window.removeEventListener("message", onMessage);
    for (const answer of [...asked.values()]) answer(undefined);
    frame.remove();
    await delivery;
  };

  window.addEventListener("message", onMessage);
  parent.append(frame);

  return {
    element: frame,
    checkValidity: async () => {
      const verdict = await ask("checkValidity");
      return typeof verdict === "boolean" ? verdict : undefined;
    },
    reportValidity: async () => {
      const verdict = await ask("reportValidity");
      return typeof verdict === "boolean" ? verdict : undefined;
    },
    setCustomValidity: async (message) => {
      checkString(message, "The custom validity message");
      await ask("setCustomValidity", message);
    },
    getCustomValidity: async () => {
      const message = await ask("getCustomValidity");
      return typeof message === "string" ? message : undefined;
    },
    settled,
    setPresentation: (next) => {
      checkPresentation(next, "The presentation");
      presentation = next;
      if (phase === "started") post({ type: "presentation", presentation });
    },
    destroy: () => {
      closing ??= close();
      return closing;
    },
  };
}
