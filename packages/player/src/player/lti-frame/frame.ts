import { describe } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import { LTI_STORAGE_FRAME, LTI_TOOL_FRAME, type LtiFrame } from "../../protocol/index.js";
import { checkLtiFrame } from "../../protocol/internal.js";
import { answerCapabilities } from "./capabilities.js";

/**
 * The name of the slot that shows the frame of the tool.
 *
 * @remarks
 * The frames are children of the host element and not of its shadow root: a window finds a frame by name, as
 * `window.frames["lti-storage"]` does, only among the frames of its own document tree, and the tool and the storage page
 * find each other that way.
 */
export const LTI_SLOT = "ak-lti";

/** The text and the origins that a frame of the tool needs from the player. */
interface LtiFrameOptions {
  /** The title of the frame of the tool, which assistive technology announces: the title of the LTI link. */
  readonly title: string;
  /** The title of the hidden frame of the storage page. */
  readonly storageTitle: string;
  /** The origins that the tool and the storage page must not be served from: the player's and the asset origin. */
  readonly refused: readonly string[];
}

/** A tool running in its frame, with the storage frame beside it. */
export interface LtiFrameHandle {
  /** Removes both frames and stops answering the tool's messages. */
  destroy(): void;
}

/**
 * The permissions of the frame of the tool.
 *
 * @remarks
 * `allow-same-origin` keeps the origin of the tool, so that it has its own cookies and storage and can read its own
 * responses; that is safe only because `mountLtiFrame` refuses a tool that runs from the origin of the player or of the
 * assets, where the tool would have the player's own origin.
 */
const TOOL_SANDBOX = "allow-scripts allow-forms allow-same-origin";

/** The permissions of the storage frame: the platform's page runs scripts, and needs its origin to receive and answer messages. */
const STORAGE_SANDBOX = "allow-scripts allow-same-origin";

/** Throws when a URL is on one of the origins that a tool must not run from. */
function refuseOrigins(url: string, refused: readonly string[], what: string): void {
  const { origin } = new URL(url);
  if (refused.includes(origin)) {
    throw new DataError(
      `The ${what} must not be served from ${describe(origin)}, which is the origin of the player or of the assets.`,
    );
  }
}

/**
 * Shows the tool of an LTI item in a frame that is appended to a parent, with the platform's storage page in a hidden
 * frame beside it.
 *
 * @remarks
 * The frame of the tool is sandboxed with `allow-scripts allow-forms allow-same-origin`, takes its `allow` list from the
 * registration and sends no referrer. It starts when the storage page has loaded, so that the first message of the tool's
 * login finds the page listening. The tool keeps the `state` and the `nonce` of its login in the storage page, which
 * answers only the frame of the tool. The player itself answers the capabilities request of the tool.
 *
 * @param parent - The element that gets the frames: the host element of the player, whose shadow root has the slot
 * `LTI_SLOT`, and not an element inside a shadow root.
 * @param launch - Where the tool's login and the storage page are, from the host's route.
 * @param options - See {@link LtiFrameOptions}.
 * @returns The handle that removes the frames.
 * @throws `DataError` when `launch` is not a frame of an LTI item, or its URLs are on a refused origin.
 * @see {@link https://www.imsglobal.org/spec/lti/v1p3/ | LTI 1.3}
 */
export function mountLtiFrame(parent: HTMLElement, launch: LtiFrame, options: LtiFrameOptions): LtiFrameHandle {
  checkLtiFrame(launch);
  refuseOrigins(launch.url, options.refused, "tool");
  refuseOrigins(launch.storageUrl, options.refused, "storage page");

  const storage = document.createElement("iframe");
  storage.name = LTI_STORAGE_FRAME;
  storage.title = options.storageTitle;
  storage.hidden = true;
  storage.setAttribute("sandbox", STORAGE_SANDBOX);
  storage.setAttribute("referrerpolicy", "no-referrer");

  const tool = document.createElement("iframe");
  tool.name = LTI_TOOL_FRAME;
  tool.slot = LTI_SLOT;
  tool.title = options.title;
  tool.setAttribute("sandbox", TOOL_SANDBOX);
  tool.setAttribute("referrerpolicy", "no-referrer");
  if (launch.allow !== undefined) tool.setAttribute("allow", launch.allow);
  tool.style.display = "block";
  tool.style.boxSizing = "border-box";
  tool.style.width = "100%";
  tool.style.height = "75vh";
  tool.style.minHeight = "24rem";
  tool.style.border = "1px solid CanvasText";

  // The storage frame has its URL before it is inserted: an iframe without one fires `load` for its empty first document.
  storage.setAttribute("src", launch.storageUrl);
  storage.addEventListener("load", () => tool.setAttribute("src", launch.url), { once: true });

  const onMessage = (event: MessageEvent): void => {
    const target = tool.contentWindow;
    if (target === null || event.source !== target || event.origin === "null") return;
    const answer = answerCapabilities(event.data);
    if (answer !== undefined) target.postMessage(answer, event.origin);
  };
  window.addEventListener("message", onMessage);

  parent.append(storage, tool);
  return {
    destroy: () => {
      window.removeEventListener("message", onMessage);
      storage.remove();
      tool.remove();
    },
  };
}
