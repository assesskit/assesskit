import { SignJWT } from "jose";
import { AGS_SCOPE, CLAIM, LEARNER_ROLE, LTI_VERSION, MESSAGE_TYPE } from "../claims.js";
import { readClock } from "../clock.js";
import { rs256Header } from "../jwt.js";
import { LINE_ITEM_PATH, platformKeyId } from "./config.js";
import type { PlatformOptions } from "./options.js";
import type { ToolRegistration } from "./registration.js";
import { resourceLinkId } from "./resource-link.js";
import { type Hint, sealLineItem } from "./tokens.js";

// A launch is posted to the tool at once; the hint it comes from expires in as long (D-M1).
const ID_TOKEN_TTL_SECONDS = 300;

/** Returns the URL of the one line item of an item instance (LTI AGS 2.0 §3.1, §3.4.1). */
async function lineItemUrl(hint: Hint, options: PlatformOptions): Promise<string> {
  const id = await sealLineItem(
    {
      session: hint.session,
      item: hint.item,
      client: hint.client,
      subject: hint.principal,
      title: hint.title,
      scoreMaximum: hint.scoreMaximum,
    },
    options.config.hintKey,
  );
  return `${options.config.origin}${LINE_ITEM_PATH}${id}`;
}

/**
 * Issues the `id_token` of a resource link launch (Security Framework §5.1.2, LTI 1.3 Core §5.3): the claims of the
 * platform, the candidate as the user with the role of a learner, the item as the resource link, the link's custom
 * properties and the one line item with the scopes to read it and to post scores.
 */
export async function issueIdToken(
  hint: Hint,
  registration: ToolRegistration,
  nonce: string,
  options: PlatformOptions,
): Promise<string> {
  const { config, clock } = options;
  const iat = Math.floor(readClock(clock) / 1000);
  return new SignJWT({
    nonce,
    [CLAIM.messageType]: MESSAGE_TYPE.resourceLink,
    [CLAIM.version]: LTI_VERSION,
    [CLAIM.deploymentId]: registration.deploymentId,
    [CLAIM.targetLinkUri]: hint.target,
    [CLAIM.resourceLink]: { id: await resourceLinkId(hint.session, hint.item), title: hint.title },
    [CLAIM.roles]: [LEARNER_ROLE],
    [CLAIM.custom]: hint.custom,
    [CLAIM.agsEndpoint]: {
      scope: [AGS_SCOPE.lineitemReadonly, AGS_SCOPE.score],
      lineitem: await lineItemUrl(hint, options),
    },
  })
    .setProtectedHeader(rs256Header(await platformKeyId(config)))
    .setIssuer(config.issuer)
    .setAudience(registration.clientId)
    .setSubject(hint.principal)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ID_TOKEN_TTL_SECONDS)
    .sign(config.keys.privateKey);
}
