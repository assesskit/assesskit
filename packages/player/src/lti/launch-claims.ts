// biome-ignore-all lint/style/useNamingConvention: The names of the claims are those of the LTI specifications.

import { describe, looseRecord } from "@assesskit/runtime/checks";
import * as v from "valibot";
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
  required,
  STRING,
  STRING_ARRAY,
  STRING_RECORD,
} from "./claims.js";
import type { AgsEndpoint, DeepLinkingSettings, LaunchBase, LtiLaunch, ResourceLink } from "./launch-model.js";
import type { PlatformRegistration } from "./registration.js";

const MESSAGE = "The id_token";

/** Reads the resource link claim (LTI 1.3 Core section 5.3.5). */
function readResourceLink(claims: Claims): ResourceLink {
  const { id, title, description } = required(
    claims,
    CLAIM.resourceLink,
    MESSAGE,
    looseRecord({ id: IDENTIFIER, title: v.optional(STRING), description: v.optional(STRING) }),
  );
  return { id, title, description };
}

/** An endpoint of the grade services; LTI AGS 2.0 section 3.1 lets a platform leave `lineitem` blank. */
const endpointUrl = v.pipe(
  v.optional(v.nullable(v.string())),
  v.check(
    (url) => url === undefined || url === null || url === "" || v.is(HTTPS_URL, url),
    (issue) => `expected an absolute https URL, found ${issue.received}`,
  ),
  v.transform((url) => (url === null || url === "" ? undefined : url)),
);

/** Reads the grade services claim (LTI AGS 2.0 section 3.1), or returns `undefined` when the platform offers none. */
function readAgs(claims: Claims): AgsEndpoint | undefined {
  const endpoint = optional(
    claims,
    CLAIM.agsEndpoint,
    MESSAGE,
    looseRecord({ scope: v.optional(STRING_ARRAY), lineitems: endpointUrl, lineitem: endpointUrl }),
  );
  if (endpoint === undefined) return undefined;
  return { scopes: endpoint.scope ?? [], lineitems: endpoint.lineitems, lineitem: endpoint.lineitem };
}

/** Reads the Deep Linking settings claim (Deep Linking 2.0 section 4.4.1). */
function readSettings(claims: Claims): DeepLinkingSettings {
  const settings = required(
    claims,
    CLAIM.deepLinkingSettings,
    MESSAGE,
    looseRecord({
      deep_link_return_url: HTTPS_URL,
      accept_types: STRING_ARRAY,
      accept_multiple: v.optional(BOOLEAN),
      data: v.optional(STRING),
    }),
  );
  return {
    returnUrl: settings.deep_link_return_url,
    acceptTypes: settings.accept_types,
    acceptMultiple: settings.accept_multiple,
    data: settings.data,
  };
}

/** Reads the claims that every launch has (LTI 1.3 Core section 5.3), after checking the version and the deployment. */
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
    custom: optional(claims, CLAIM.custom, MESSAGE, STRING_RECORD) ?? new Map<string, string>(),
  };
}

/**
 * Reads the LTI claims of a verified `id_token` into a launch (LTI 1.3 Core section 5.3, Deep Linking 2.0 section 4.4): the message
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
