import { describe } from "../checks.js";
import { LtiError } from "../errors.js";
import {
  BOOLEAN,
  CLAIM,
  type Claims,
  HTTPS_URL,
  IDENTIFIER,
  LTI_VERSION,
  MESSAGE_TYPE,
  optional,
  RECORD,
  required,
  STRING,
  STRING_ARRAY,
  STRING_RECORD,
} from "./claims.js";
import type { AgsEndpoint, DeepLinkingSettings, LaunchBase, LtiLaunch, ResourceLink } from "./launch-model.js";
import type { PlatformRegistration } from "./registration.js";

const MESSAGE = "The id_token";

/** Reads the resource link claim (LTI 1.3 Core §5.3.5). */
function readResourceLink(claims: Claims): ResourceLink {
  const link = required(claims, CLAIM.resourceLink, MESSAGE, RECORD);
  const owner = `The claim ${JSON.stringify(CLAIM.resourceLink)}`;
  return {
    id: required(link, "id", owner, IDENTIFIER),
    title: optional(link, "title", owner, STRING),
    description: optional(link, "description", owner, STRING),
  };
}

/** Reads an endpoint of the grade services; LTI AGS 2.0 §3.1 lets a platform leave `lineitem` blank. */
function readEndpointUrl(endpoint: Claims, name: string, owner: string): string | undefined {
  const value = endpoint[name];
  return value === "" || value === null ? undefined : optional(endpoint, name, owner, HTTPS_URL);
}

/** Reads the grade services claim (LTI AGS 2.0 §3.1), or returns `undefined` when the platform offers none. */
function readAgs(claims: Claims): AgsEndpoint | undefined {
  const endpoint = optional(claims, CLAIM.agsEndpoint, MESSAGE, RECORD);
  if (endpoint === undefined) return undefined;
  const owner = `The claim ${JSON.stringify(CLAIM.agsEndpoint)}`;
  return {
    scopes: optional(endpoint, "scope", owner, STRING_ARRAY) ?? [],
    lineitems: readEndpointUrl(endpoint, "lineitems", owner),
    lineitem: readEndpointUrl(endpoint, "lineitem", owner),
  };
}

/** Reads the Deep Linking settings claim (Deep Linking 2.0 §4.4.1). */
function readSettings(claims: Claims): DeepLinkingSettings {
  const settings = required(claims, CLAIM.deepLinkingSettings, MESSAGE, RECORD);
  const owner = `The claim ${JSON.stringify(CLAIM.deepLinkingSettings)}`;
  return {
    returnUrl: required(settings, "deep_link_return_url", owner, HTTPS_URL),
    acceptTypes: required(settings, "accept_types", owner, STRING_ARRAY),
    acceptMultiple: optional(settings, "accept_multiple", owner, BOOLEAN),
    data: optional(settings, "data", owner, STRING),
  };
}

/** Reads the claims that every launch has (LTI 1.3 Core §5.3), after checking the version and the deployment. */
function readBase(claims: Claims, registration: PlatformRegistration): LaunchBase {
  const version = required(claims, CLAIM.version, MESSAGE, STRING);
  if (version !== LTI_VERSION) {
    throw new LtiError(
      `The LTI version of the launch must be ${describe(LTI_VERSION)}, found ${describe(version)}.`,
      "version-unsupported",
    );
  }
  const deploymentId = required(claims, CLAIM.deploymentId, MESSAGE, IDENTIFIER);
  if (!registration.deploymentIds.includes(deploymentId)) {
    throw new LtiError(
      `The deployment ${describe(deploymentId)} is not one of the deployments of the registration.`,
      "deployment-unknown",
    );
  }
  return {
    issuer: registration.issuer,
    clientId: registration.clientId,
    deploymentId,
    targetLinkUri: required(claims, CLAIM.targetLinkUri, MESSAGE, HTTPS_URL),
    subject: optional(claims, "sub", MESSAGE, IDENTIFIER),
    roles: required(claims, CLAIM.roles, MESSAGE, STRING_ARRAY),
    custom: new Map(Object.entries(optional(claims, CLAIM.custom, MESSAGE, STRING_RECORD) ?? {})),
  };
}

/**
 * Reads the LTI claims of a verified `id_token` into a launch (LTI 1.3 Core §5.3, Deep Linking 2.0 §4.4): the message
 * type, the version, a deployment that the registration lists, and the claims of that message type.
 *
 * @throws `LtiError` with the reason of the failed check: `message-type-unsupported`, `version-unsupported`,
 * `deployment-unknown`, `claim-missing` or `claim-invalid`.
 */
export function readLaunch(claims: Claims, registration: PlatformRegistration): LtiLaunch {
  const messageType = required(claims, CLAIM.messageType, MESSAGE, STRING);
  if (messageType !== MESSAGE_TYPE.resourceLink && messageType !== MESSAGE_TYPE.deepLinkingRequest) {
    throw new LtiError(
      `The message type must be ${describe(MESSAGE_TYPE.resourceLink)} or ${describe(MESSAGE_TYPE.deepLinkingRequest)}, found ${describe(messageType)}.`,
      "message-type-unsupported",
    );
  }
  const base = readBase(claims, registration);
  return messageType === MESSAGE_TYPE.resourceLink
    ? { ...base, messageType, resourceLink: readResourceLink(claims), ags: readAgs(claims) }
    : { ...base, messageType, settings: readSettings(claims) };
}
