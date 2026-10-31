import { DataError } from "@assesskit/runtime/errors";
import { checkProperties, checkRecord, checkString, describe } from "../checks.js";

/** The name of the frame that holds the tool of an LTI item, by which the storage page recognizes the sender of a message. */
export const LTI_TOOL_FRAME = "lti-tool";

/**
 * The name of the frame, served from the platform's origin, that keeps the `state` and the `nonce` of a tool's login. The
 * `lti_storage_target` of the login names it.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-cs-oidc/v0p1 | LTI Client Side OIDC 0.1}
 */
export const LTI_STORAGE_FRAME = "lti-storage";

/**
 * What the player needs to show an LTI item: where the tool's login starts and where the platform's storage page is. The
 * host's route answers with it, and the player's `ltiLogin` hook returns it.
 */
export interface LtiFrame {
  /** The URL of the tool's third-party initiated login, which the player navigates the frame of the tool to. */
  readonly url: string;
  /** The URL of the platform's storage page, which the player shows in a hidden frame beside the frame of the tool. */
  readonly storageUrl: string;
  /**
   * The `allow` attribute of the frame of the tool: the features of the browser that the tool may use, from the tool's
   * registration.
   *
   * @defaultValue none, so that the tool may use no feature that needs permission
   */
  readonly allow?: string;
}

// The grammar of a Permissions Policy allow list needs letters, digits, quoted keywords and origins, `*`, and `;` between
// directives; the pattern leaves out quotes of the other kind, brackets, commas and control characters.
const ALLOW_LIST = /^[A-Za-z0-9 ;*:/.'-]+$/u;

/**
 * Checks the `allow` attribute of the frame of a tool.
 *
 * @param value - The attribute.
 * @param label - Names the value in the error message, such as `The allow list of a tool`.
 * @throws `DataError` when it is not a non-empty string of the characters that a Permissions Policy allow list uses.
 */
export function checkAllowList(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  if (!ALLOW_LIST.test(value)) {
    throw new DataError(
      `${label} must be a Permissions Policy allow list of letters, digits, spaces and the characters ; * : / . ' -, found ${describe(value)}.`,
    );
  }
}

/** Parses an absolute URL; `URL.canParse` is outside the browser baseline that this shared file keeps. */
function parseUrl(text: string): URL | undefined {
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}

/** Checks an absolute URL that a frame may show: its scheme is `http` or `https`, so that no `javascript:` or `data:` URL runs in a frame. */
function checkFrameUrl(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  const protocol = parseUrl(value)?.protocol;
  if (protocol !== "https:" && protocol !== "http:") {
    throw new DataError(`${label} must be an absolute http or https URL, found ${describe(value)}.`);
  }
}

/**
 * Checks the frame of an LTI item that arrived as JSON.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` when it is not an object with the properties `url`, `storageUrl` and, optionally, `allow` only,
 * the URLs absolute `http` or `https` URLs and `allow` an allow list.
 */
export function checkLtiFrame(value: unknown): asserts value is LtiFrame {
  checkRecord(value, "The frame of an LTI item must be an object");
  checkProperties(value, "The frame of an LTI item", ["url", "storageUrl", "allow"]);
  checkFrameUrl(value.url, "The property url of the frame of an LTI item");
  checkFrameUrl(value.storageUrl, "The property storageUrl of the frame of an LTI item");
  if (value.allow !== undefined) checkAllowList(value.allow, "The property allow of the frame of an LTI item");
}
