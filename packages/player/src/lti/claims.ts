import * as v from "valibot";
import {
  finiteSchema,
  httpsUrlSchema,
  issueText,
  mapSchema,
  positiveIntegerSchema,
  positiveSchema,
} from "../checks.js";
import { LtiError } from "../errors.js";

/** The claims of a token: a JSON object. */
export type Claims = Readonly<Record<string, unknown>>;

/** The most characters of an identifier of a deployment, a resource link or a user (LTI 1.3 Core sections 5.3.3 and 5.3.5, section 5.3.6). */
export const MAX_IDENTIFIER_LENGTH = 255;

/** A string. */
export const STRING = v.string();

/** A non-empty string of at most 255 characters, such as a `deployment_id` or a `sub`. */
export const IDENTIFIER = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_IDENTIFIER_LENGTH));

/** A finite number, such as `exp`. */
export const NUMBER = finiteSchema;

/** A finite number above 0, such as a maximum score. */
export const POSITIVE_NUMBER = positiveSchema;

/** A safe integer of at least 1, such as the number of an item instance. */
export const POSITIVE_INTEGER = positiveIntegerSchema;

/** A boolean. */
export const BOOLEAN = v.boolean();

/** An absolute `https` URL: LTI requires HTTPS for every URL of a message (LTI 1.3 Core section 3.5). */
export const HTTPS_URL = httpsUrlSchema;

/** An array of strings. */
export const STRING_ARRAY = v.array(v.string());

/** An object whose values are strings, such as `custom` (LTI 1.3 Core section 5.4.6: a custom value is always a string). */
export const STRING_RECORD = mapSchema(v.string());

/** The failure of a claim: `claim-missing` when it is absent, else `claim-invalid`. */
function invalid(owner: string, name: string, issue: v.BaseIssue<unknown>): LtiError {
  return new LtiError(
    `${owner} is invalid at ${JSON.stringify(name)}: ${issueText(issue)}.`,
    issue.received === "undefined" ? "claim-missing" : "claim-invalid",
  );
}

/**
 * Reads a property that must be present.
 *
 * @param owner - Names the object in the error message, such as `The id_token`.
 * @param schema - What the value must be.
 * @throws `LtiError` (`claim-missing`) when it is absent and (`claim-invalid`) when it has another shape.
 */
export function required<TSchema extends v.GenericSchema>(
  source: Claims,
  name: string,
  owner: string,
  schema: TSchema,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, source[name], { abortEarly: true });
  if (!result.success) throw invalid(owner, name, result.issues[0]);
  return result.output;
}

/**
 * Reads a property that may be absent.
 *
 * @param owner - Names the object in the error message, such as `The id_token`.
 * @param schema - What the value must be, when it is there.
 * @throws `LtiError` (`claim-invalid`) when it is present with another shape.
 */
export function optional<TSchema extends v.GenericSchema>(
  source: Claims,
  name: string,
  owner: string,
  schema: TSchema,
): v.InferOutput<TSchema> | undefined {
  return source[name] === undefined ? undefined : required(source, name, owner, schema);
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

/** The scopes of the Assignment and Grade Services that a launch offers (LTI AGS 2.0 sections 3.2 and 3.4.2). */
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

/** The version of LTI that the tool speaks: `1.3.0` (LTI 1.3 Core section 5.3.2). */
export const LTI_VERSION = "1.3.0";
