import type { ItemKey } from "@luthfanwakan/olah/delivery";
import type { LtiLink } from "@luthfanwakan/olah/package";
import { checkNonEmptyString, checkPositiveInteger, checkRecord, describe } from "../../checks.js";
import { DataError, LtiError } from "../../errors.js";
import { type Caller, checkCaller } from "../../protocol/index.js";
import { MAX_IDENTIFIER_LENGTH, POSITIVE_NUMBER } from "../claims.js";
import { readClock } from "../clock.js";
import { checkHttpsUrl } from "../http.js";
import { randomToken } from "../random.js";
import type { PlatformConfig } from "./config.js";
import { checkLoginOptions, type PlatformLoginOptions } from "./options.js";
import { checkToolRegistration, type ToolRegistration } from "./registration.js";
import { sealHint, sealLoginHint } from "./tokens.js";

/** How long a hint is valid, in seconds (D-M1). It is the time for the browser to go to the tool and back. */
export const LTI_HINT_TTL_SECONDS = 300;
// The player page holds the platform's storage for the tool (LTI Client Side OIDC 0.1 §2.1), and it is the parent of the frame.
const STORAGE_TARGET = "_parent";

/** Checks the item instance that the host passes. */
function checkItemKey(item: unknown): asserts item is ItemKey {
  checkRecord(item, "The item must be an object");
  checkNonEmptyString(item.ref, "The reference of the item");
  checkPositiveInteger(item.instance, "The instance of the item");
}

/** Checks the parts of an LTI link that the platform reads. */
function checkLink(link: unknown): asserts link is LtiLink {
  checkRecord(link, "The LTI link must be an object");
  checkNonEmptyString(link.title, "The title of the LTI link");
  const { custom } = link;
  if (
    !(custom instanceof Map) ||
    ![...custom].every(([name, value]) => typeof name === "string" && typeof value === "string")
  ) {
    throw new DataError(`The custom properties of the LTI link must be a Map of strings, found ${describe(custom)}.`);
  }
  for (const property of ["secureLaunchUrl", "launchUrl"]) {
    if (link[property] !== undefined) checkNonEmptyString(link[property], `The ${property} of the LTI link`);
  }
}

/**
 * Refuses a URL on one of the platform's own origins. The tool's frame has `allow-same-origin`, so a tool on the player's
 * origin could reach the player (F-m8); one on the platform's or the asset origin would reach their pages.
 */
function refuseOwnOrigins(urls: readonly string[], config: PlatformConfig): void {
  const own = [config.origin, config.playerOrigin, config.assetOrigin];
  for (const url of urls) {
    if (own.includes(new URL(url).origin)) {
      throw new LtiError(
        `The tool must not be launched from ${describe(url)}, which is on an origin of the platform.`,
        "origin-refused",
      );
    }
  }
}

/** Returns the URL that launches the link (BPIG §6.2.9): the secure one when the link has both. */
function launchUrlOf(link: LtiLink): string {
  const url = link.secureLaunchUrl ?? link.launchUrl;
  if (url === undefined) {
    throw new DataError("The LTI link must have a launch URL; a link that names only a vendor is not supported.");
  }
  checkHttpsUrl(url, "The launch URL of the LTI link");
  return url;
}

/**
 * Prepares the launch of a tool for an item and returns the URL of the tool's third-party initiated login (Security
 * Framework §5.1.1.1) for the player to navigate the item's frame to.
 *
 * The URL carries `iss`, `client_id`, `lti_deployment_id`, `target_link_uri` and `lti_storage_target`, and two hints:
 * `lti_message_hint` is HMAC-signed and names the session, the item and the principal with a random `jti` and an expiry of
 * `LTI_HINT_TTL_SECONDS`, and `login_hint` is the principal, signed with the same key (D-M1). The hint also carries the
 * link's launch URL, custom properties and title, and the item's highest score, which `ltiPlatformAuthorize` puts in the
 * launch. It is signed and not encrypted, so the tool can read the session, the item and the principal.
 *
 * @param caller - The authenticated caller of the host's route.
 * @param item - The item instance to launch the tool for.
 * @param link - The LTI link of the item, from olah's `readLtiLink`.
 * @throws `DataError` when an argument or an option has the wrong type, the principal has more than 255 characters, the
 * link has no `https` launch URL or the highest score is not above 0.
 * @throws `AccessError` when `options.check` finds that the session is not the caller's.
 * @throws `LtiError` (`tool-unknown`) when the platform has no tool for the link, and (`origin-refused`) when the
 * link's launch URL or the tool's URLs are on the platform's, the player's or the asset origin.
 */
export async function ltiPlatformLogin(
  caller: Caller,
  item: ItemKey,
  link: LtiLink,
  options: PlatformLoginOptions,
): Promise<string> {
  checkLoginOptions(options);
  checkCaller(caller);
  checkItemKey(item);
  checkLink(link);
  if (caller.principal.length > MAX_IDENTIFIER_LENGTH) {
    throw new DataError(
      `The principal of the caller is the sub of the launch and must have at most 255 characters (LTI 1.3 Core §5.3.6), found ${caller.principal.length}.`,
    );
  }
  const { config } = options;
  await options.check(caller);
  const registration: ToolRegistration | undefined = await options.registration(link);
  if (registration === undefined) {
    throw new LtiError(`The platform has no tool for the LTI link ${describe(link.title)}.`, "tool-unknown");
  }
  checkToolRegistration(registration);
  const target = launchUrlOf(link);
  refuseOwnOrigins([target, registration.loginUrl, ...registration.redirectUris], config);
  const scoreMaximum = await options.scoreMaximum(item);
  if (!POSITIVE_NUMBER.accepts(scoreMaximum)) {
    throw new DataError(`The highest score of the item must be a number above 0, found ${describe(scoreMaximum)}.`);
  }
  const hint = await sealHint(
    {
      session: caller.session,
      item: { ref: item.ref, instance: item.instance },
      principal: caller.principal,
      client: registration.clientId,
      target,
      custom: Object.fromEntries(link.custom),
      title: link.title,
      scoreMaximum,
      jti: randomToken(),
      exp: Math.floor(readClock(options.clock) / 1000) + LTI_HINT_TTL_SECONDS,
    },
    config.hintKey,
  );
  const url = new URL(registration.loginUrl);
  const parameters: readonly (readonly [string, string])[] = [
    ["iss", config.issuer],
    ["login_hint", await sealLoginHint(caller.principal, config.hintKey)],
    ["lti_message_hint", hint],
    ["target_link_uri", target],
    ["client_id", registration.clientId],
    ["lti_deployment_id", registration.deploymentId],
    ["lti_storage_target", STORAGE_TARGET],
  ];
  for (const [name, value] of parameters) url.searchParams.append(name, value);
  return url.href;
}
