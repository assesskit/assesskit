import { checkString, describe } from "../../checks.js";
import { DataError } from "../../errors.js";
import { buildStart, checkPciFrameOptions, type PciFrameOptions } from "./options.js";
import {
  type PciCommand,
  type PciFrameMessage,
  type PciValidityMethod,
  type PciValidityResult,
  readFrameMessage,
} from "./protocol.js";

/** The least height of a frame in CSS pixels, so that an interaction that reports no height stays in view. */
export const MIN_PCI_HEIGHT = 48;

/**
 * The greatest height of a frame in CSS pixels, a bound against a layout that grows with its own frame. Taller content
 * scrolls inside the frame.
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
   * Asks the interaction whether its response is valid ([BPIG] §3.7.12.7.3).
   *
   * @returns the verdict, or `undefined` when the interaction gives none, is not running, or does not answer in time.
   */
  checkValidity(): Promise<boolean | undefined>;
  /** Like {@link PciFrame.checkValidity}, and the interaction also shows the candidate what is invalid. */
  reportValidity(): Promise<boolean | undefined>;
  /**
   * Sets the custom validity message of the interaction; the empty string clears it. Rejects with `DataError` when
   * `message` is not a string.
   */
  setCustomValidity(message: string): Promise<void>;
  /** Reads the custom validity message of the interaction, or `undefined` when it gives none. */
  getCustomValidity(): Promise<string | undefined>;
  /**
   * Hands over the final response and state as a `completed` event, lets the interaction call `oncompleted`, and
   * removes the frame ([BPIG] §3.7.12.7.4). It waits at most two seconds for a frozen module. Calling it again returns
   * the same promise.
   */
  destroy(): Promise<void>;
}

type Phase = "waiting" | "started" | "closing" | "closed";

function createFrameElement(staticUrl: string, title: string): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  // No allow-same-origin, so that the frame has an opaque origin: no cookies, storage or access to the player.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.title = title;
  frame.src = new URL(FRAME_PATH, staticUrl).href;
  frame.style.display = "block";
  frame.style.border = "0";
  frame.style.width = "100%";
  frame.style.height = `${MIN_PCI_HEIGHT}px`;
  return frame;
}

/**
 * Mounts a portable custom interaction in a sandboxed frame ([BPIG] §3.7.12) and appends the frame to `parent`.
 *
 * The frame is an `iframe` with `sandbox="allow-scripts"` and no `allow-same-origin`, so it has an opaque origin, and its
 * document is `pci-frame/frame.html` under `staticUrl`. Once the frame says it runs, the player sends it the
 * configuration; the frame restricts itself with a content security policy, loads `player.css` and the stylesheets,
 * builds the markup, loads the modules with RequireJS and creates the interaction. What the interaction does arrives
 * as {@link PciEvent}s. Messages from the frame are untrusted and dropped unless they come from its window and have
 * the shape of a message that the frame sends.
 *
 * @param parent - The element that gets the frame.
 * @param options - See {@link PciFrameOptions}.
 * @throws `DataError` when `parent` is not an element or an option is not valid.
 */
export function mountPciFrame(parent: HTMLElement, options: PciFrameOptions): PciFrame {
  if (!(parent instanceof HTMLElement))
    throw new DataError(`The parent must be an element, found ${describe(parent)}.`);
  checkPciFrameOptions(options);
  const start = buildStart(options);
  const frame = createFrameElement(options.staticUrl, start.title);
  const asked = new Map<number, (value: PciValidityResult) => void>();
  let phase: Phase = "waiting";
  let nextId = 0;
  let finishClosing: (() => void) | undefined;
  let closing: Promise<void> | undefined;

  // The target origin is "*" because an opaque origin cannot be named.
  const post = (command: PciCommand): void => frame.contentWindow?.postMessage(command, "*");

  const setHeight = (height: number): void => {
    frame.style.height = `${Math.min(MAX_PCI_HEIGHT, Math.max(MIN_PCI_HEIGHT, height))}px`;
  };

  const handle = (message: PciFrameMessage): void => {
    switch (message.type) {
      case "loaded":
        if (phase === "waiting") {
          phase = "started";
          post(start);
        }
        break;
      case "height":
        setHeight(message.height);
        break;
      case "validity":
        asked.get(message.id)?.(message.value);
        break;
      case "completed":
        if (phase === "closing") {
          if (message.flushed !== null) options.onEvent({ type: "completed", ...message.flushed });
          finishClosing?.();
        }
        break;
      default:
        if (phase === "started") options.onEvent(message);
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

  const ask = (method: PciValidityMethod, message?: string): Promise<PciValidityResult> => {
    if (phase !== "started") return Promise.resolve(undefined);
    const id = nextId++;
    return new Promise((resolve) => {
      const answer = (value: PciValidityResult): void => {
        clearTimeout(timer);
        asked.delete(id);
        resolve(value);
      };
      const timer = setTimeout(answer, REPLY_TIMEOUT_MS, undefined);
      asked.set(id, answer);
      post({ type: "validity", id, method, ...(message === undefined ? {} : { message }) });
    });
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
    destroy: () => {
      closing ??= close();
      return closing;
    },
  };
}
