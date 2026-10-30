import { describe, isRecord } from "../checks.js";
import { LtiError } from "../errors.js";

/** The claims of a token: a JSON object. */
export type Claims = Readonly<Record<string, unknown>>;

/** The kinds of claim value that the readers accept: what a value must be, and the test for it. */
export interface Shape<T> {
  /** Says what the value must be, completing the sentence "must have the claim as ...". */
  readonly expected: string;
  /** Returns whether a value has the shape. */
  readonly accepts: (value: unknown) => value is T;
}

/** The most characters of an identifier of a deployment, a resource link or a user (LTI 1.3 Core §5.3.3, §5.3.5, §5.3.6). */
export const MAX_IDENTIFIER_LENGTH = 255;

/** A string. */
export const STRING: Shape<string> = {
  expected: "a string",
  accepts: (value): value is string => typeof value === "string",
};

/** A non-empty string of at most 255 characters, such as a `deployment_id` or a `sub`. */
export const IDENTIFIER: Shape<string> = {
  expected: "a string of 1 to 255 characters",
  accepts: (value): value is string =>
    typeof value === "string" && value.length >= 1 && value.length <= MAX_IDENTIFIER_LENGTH,
};

/** A finite number, such as `exp`. */
export const NUMBER: Shape<number> = {
  expected: "a number",
  accepts: (value): value is number => typeof value === "number" && Number.isFinite(value),
};

/** A finite number above 0, such as a maximum score. */
export const POSITIVE_NUMBER: Shape<number> = {
  expected: "a number above 0",
  accepts: (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
};

/** A safe integer of at least 1, such as the number of an item instance. */
export const POSITIVE_INTEGER: Shape<number> = {
  expected: "an integer of at least 1",
  accepts: (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1,
};

/** A boolean. */
export const BOOLEAN: Shape<boolean> = {
  expected: "a boolean",
  accepts: (value): value is boolean => typeof value === "boolean",
};

/** An absolute `https` URL: LTI requires HTTPS for every URL of a message (LTI 1.3 Core §3.5). */
export const HTTPS_URL: Shape<string> = {
  expected: "an absolute https URL",
  accepts: (value): value is string =>
    typeof value === "string" && URL.canParse(value) && new URL(value).protocol === "https:",
};

/** An array of strings. */
export const STRING_ARRAY: Shape<readonly string[]> = {
  expected: "an array of strings",
  accepts: (value): value is readonly string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string"),
};

/** An object. */
export const RECORD: Shape<Claims> = {
  expected: "an object",
  accepts: isRecord,
};

/** An object whose values are strings, such as `custom` (LTI 1.3 Core §5.4.6: a custom value is always a string). */
export const STRING_RECORD: Shape<Readonly<Record<string, string>>> = {
  expected: "an object of strings",
  accepts: (value): value is Readonly<Record<string, string>> =>
    isRecord(value) && Object.values(value).every((item) => typeof item === "string"),
};

/** Builds the error for a claim that is missing or has the wrong shape. */
function invalid(owner: string, name: string, expected: string, found: unknown): LtiError {
  return new LtiError(
    `${owner} must have ${JSON.stringify(name)} as ${expected}, found ${describe(found)}.`,
    found === undefined ? "claim-missing" : "claim-invalid",
  );
}

/**
 * Reads a property that must be present.
 *
 * @param owner - Names the object in the error message, such as `The id_token`.
 * @throws `LtiError` (`claim-missing`) when it is absent and (`claim-invalid`) when it has another shape.
 */
export function required<T>(source: Claims, name: string, owner: string, shape: Shape<T>): T {
  const value = source[name];
  if (!shape.accepts(value)) throw invalid(owner, name, shape.expected, value);
  return value;
}

/**
 * Reads a property that may be absent.
 *
 * @param owner - Names the object in the error message, such as `The id_token`.
 * @throws `LtiError` (`claim-invalid`) when it is present with another shape.
 */
export function optional<T>(source: Claims, name: string, owner: string, shape: Shape<T>): T | undefined {
  const value = source[name];
  if (value === undefined) return undefined;
  if (!shape.accepts(value)) throw invalid(owner, name, shape.expected, value);
  return value;
}

/** The claims of LTI messages that the tool reads, by the URI that names each. */
export const CLAIM = {
  messageType: "https://purl.imsglobal.org/spec/lti/claim/message_type",
  version: "https://purl.imsglobal.org/spec/lti/claim/version",
  deploymentId: "https://purl.imsglobal.org/spec/lti/claim/deployment_id",
  targetLinkUri: "https://purl.imsglobal.org/spec/lti/claim/target_link_uri",
  resourceLink: "https://purl.imsglobal.org/spec/lti/claim/resource_link",
  roles: "https://purl.imsglobal.org/spec/lti/claim/roles",
  custom: "https://purl.imsglobal.org/spec/lti/claim/custom",
  deepLinkingSettings: "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings",
  contentItems: "https://purl.imsglobal.org/spec/lti-dl/claim/content_items",
  data: "https://purl.imsglobal.org/spec/lti-dl/claim/data",
  agsEndpoint: "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint",
} as const;

/** The scopes of the Assignment and Grade Services that a launch offers (LTI AGS 2.0 §3.2, §3.4.2). */
export const AGS_SCOPE = {
  lineitem: "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
  lineitemReadonly: "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
  score: "https://purl.imsglobal.org/spec/lti-ags/scope/score",
} as const;

/** The role of a candidate in a launch: a learner (LTI 1.3 Core Appendix A.2.3). */
export const LEARNER_ROLE = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";

/** The message types of a launch that the tool accepts. */
export const MESSAGE_TYPE = {
  resourceLink: "LtiResourceLinkRequest",
  deepLinkingRequest: "LtiDeepLinkingRequest",
  deepLinkingResponse: "LtiDeepLinkingResponse",
} as const;

/** The version of LTI that the tool speaks: `1.3.0` (LTI 1.3 Core §5.3.2). */
export const LTI_VERSION = "1.3.0";
