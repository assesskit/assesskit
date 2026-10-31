import {
  checkArray,
  checkNonEmptyString,
  checkProperties,
  checkRecord,
  checkString,
  describe,
} from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import { SignJWT } from "jose";
import { checkHttpsUrl } from "../checks.js";
import { CLAIM, LTI_VERSION, MESSAGE_TYPE } from "./claims.js";
import { readClock } from "./clock.js";
import { rs256Header } from "./jwt.js";
import type { DeepLinkingLaunch } from "./launch-model.js";
import { checkToolOptions, findDeployment, type ToolOptions } from "./options.js";
import { randomToken } from "./random.js";

// Security Framework section 4.1.1: a message of the tool expires "typically five minutes after the iat timestamp".
const MESSAGE_TTL_SECONDS = 300;
const ITEM_TYPE = "ltiResourceLink";

/** A line item that the platform may create for a placed resource (Deep Linking 2.0 section 3.2, `lineItem`). */
export interface DeepLinkLineItem {
  /** The highest score of the resource: a number above 0. */
  readonly scoreMaximum: number;
  /** The label of the line item; the platform uses the title of the item when absent. */
  readonly label?: string;
  /** The tool's identifier of the resource. */
  readonly resourceId?: string;
  /** Additional information that the tool uses to tell its line items apart. */
  readonly tag?: string;
}

/** A resource that the tool places in the platform: an LTI resource link (Deep Linking 2.0 section 3.2). */
export interface DeepLinkItem {
  /** The title of the link. */
  readonly title?: string;
  /** A description of the content, shown to everyone who can open it. */
  readonly text?: string;
  /** The URL to launch, which the platform sends back as `target_link_uri`; the tool's base LTI URL when absent. */
  readonly url?: string;
  /** Custom properties that the platform sends with every launch of the link, by name. */
  readonly custom?: ReadonlyMap<string, string>;
  /** The line item for scores, when the platform supports line items. */
  readonly lineItem?: DeepLinkLineItem;
}

/** Checks the line item of an item. */
function checkLineItem(value: unknown): void {
  checkRecord(value, "The line item of a Deep Linking item must be an object");
  checkProperties(value, "A line item", ["scoreMaximum", "label", "resourceId", "tag"]);
  const { scoreMaximum, label, resourceId, tag } = value;
  if (!(typeof scoreMaximum === "number" && Number.isFinite(scoreMaximum) && scoreMaximum > 0)) {
    throw new DataError(`The scoreMaximum of a line item must be a number above 0, found ${describe(scoreMaximum)}.`);
  }
  for (const [name, text] of [
    ["label", label],
    ["resourceId", resourceId],
    ["tag", tag],
  ] as const) {
    if (text !== undefined) checkString(text, `The ${name} of a line item`);
  }
}

/** Checks an item that the host passes. */
function checkItem(value: unknown): void {
  checkRecord(value, "A Deep Linking item must be an object");
  checkProperties(value, "A Deep Linking item", ["title", "text", "url", "custom", "lineItem"]);
  const { title, text, url, custom, lineItem } = value;
  if (title !== undefined) checkString(title, "The title of a Deep Linking item");
  if (text !== undefined) checkString(text, "The text of a Deep Linking item");
  if (url !== undefined) checkHttpsUrl(url, "The url of a Deep Linking item");
  if (custom !== undefined) {
    const isMapOfStrings =
      custom instanceof Map &&
      [...custom].every(([name, item]) => typeof name === "string" && typeof item === "string");
    if (!isMapOfStrings) {
      throw new DataError(
        `The custom properties of a Deep Linking item must be a Map of strings, found ${describe(custom)}.`,
      );
    }
  }
  if (lineItem !== undefined) checkLineItem(lineItem);
}

/** Checks the launch that the host passes: a Deep Linking request that `ltiLaunch` returned. */
function checkLaunch(value: unknown): asserts value is DeepLinkingLaunch {
  checkRecord(value, "The launch must be an object");
  if (value.messageType !== MESSAGE_TYPE.deepLinkingRequest) {
    throw new DataError(
      `The launch must be a ${MESSAGE_TYPE.deepLinkingRequest}, found the message type ${describe(value.messageType)}.`,
    );
  }
  checkNonEmptyString(value.issuer, "The issuer of the launch");
  checkNonEmptyString(value.clientId, "The client identifier of the launch");
  checkNonEmptyString(value.deploymentId, "The deployment of the launch");
  const { settings } = value;
  checkRecord(settings, "The settings of the launch must be an object");
  checkArray(settings.acceptTypes, "The accepted types of the launch must be an array");
  if (settings.data !== undefined) checkString(settings.data, "The data of the launch");
}

/** Checks that the platform accepts what the host returns (Deep Linking 2.0 section 4.4.1). */
function checkAccepted(launch: DeepLinkingLaunch, items: readonly unknown[]): void {
  const { acceptTypes, acceptMultiple } = launch.settings;
  if (items.length > 0 && !acceptTypes.includes(ITEM_TYPE)) {
    throw new DataError(`The platform accepts the types ${describe(acceptTypes.join(", "))}, and not ${ITEM_TYPE}.`);
  }
  if (items.length > 1 && acceptMultiple !== true) {
    throw new DataError(`The platform does not say that it accepts several items, and ${items.length} were given.`);
  }
}

/** Writes an item as the content item of Deep Linking 2.0 section 3.2. */
function contentItem(item: DeepLinkItem): Readonly<Record<string, unknown>> {
  const { title, text, url, custom, lineItem } = item;
  return { type: ITEM_TYPE, title, text, url, custom: custom && Object.fromEntries(custom), lineItem };
}

/**
 * Signs the response to a Deep Linking request: an `LtiDeepLinkingResponse` that places the items in the platform
 * (Deep Linking 2.0 section 4.5). The result is the value of the form parameter `JWT`, which the host posts to
 * `launch.settings.returnUrl` with an auto-submitted form. The platform may not create the items, and the tool should
 * send the response also when it places none (section 2.3).
 *
 * @remarks
 * The response carries the `data` of the request when it had one, and a `nonce` and the times that the Security
 * Framework requires of a message of the tool (section 5.2.2). It is signed with the key of the registration (RS256).
 *
 * @param launch - The Deep Linking request that `ltiLaunch` returned.
 * @param items - The resource links to place; an empty array places none.
 * @param options - The registrations of the tool and its `fetch`.
 * @returns The signed JWT, as the text of the form parameter `JWT`.
 * @throws `DataError` when an argument has the wrong type, or the platform does not accept what the items are: it does not
 * accept `ltiResourceLink`, or several items.
 * @throws `LtiError` (`platform-unknown`, `deployment-unknown`) when the registration is gone or no longer lists the
 * deployment of the launch.
 */
export async function deepLinkResponse(
  launch: DeepLinkingLaunch,
  items: readonly DeepLinkItem[],
  options: ToolOptions,
): Promise<string> {
  checkToolOptions(options);
  checkLaunch(launch);
  checkArray(items, "The items must be an array");
  for (const item of items) checkItem(item);
  checkAccepted(launch, items);
  const registration = await findDeployment(options, launch);
  const iat = Math.floor(readClock(options.clock) / 1000);
  return new SignJWT({
    nonce: randomToken(),
    [CLAIM.messageType]: MESSAGE_TYPE.deepLinkingResponse,
    [CLAIM.version]: LTI_VERSION,
    [CLAIM.deploymentId]: launch.deploymentId,
    [CLAIM.data]: launch.settings.data,
    [CLAIM.contentItems]: items.map(contentItem),
  })
    .setProtectedHeader(rs256Header(registration.keyId))
    .setIssuer(registration.clientId)
    .setAudience(registration.issuer)
    .setIssuedAt(iat)
    .setExpirationTime(iat + MESSAGE_TTL_SECONDS)
    .sign(registration.signingKey);
}
