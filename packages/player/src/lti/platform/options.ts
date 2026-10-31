import type { ItemKey } from "@assesskit/runtime/delivery";
import type { LtiLink } from "@assesskit/runtime/package";
import { checkFunction, checkRecord } from "../../checks.js";
import { AccessError, LtiError } from "../../errors.js";
import type { Caller } from "../../protocol/index.js";
import { type Clock, checkClock, checkJwksCache, type HttpRequest, type JwksCache } from "../internal.js";
import type { AgsScore } from "./ags-score.js";
import { checkPlatformConfig, type PlatformConfig } from "./config.js";
import { checkToolRegistration, type ToolRegistration } from "./registration.js";

/** What every handler of the platform role needs: what the platform is, and the time. */
export interface PlatformOptions {
  /** The identity, the origins and the keys of the platform. */
  readonly config: PlatformConfig;
  /** The source of the current time. */
  readonly clock: Clock;
}

/** The options of `ltiPlatformLogin`. */
export interface PlatformLoginOptions extends PlatformOptions {
  /** Looks up the registration of the tool that launches a link, or returns `undefined` when there is none. */
  readonly registration: (link: LtiLink) => Promise<ToolRegistration | undefined>;
  /** Confirms that the session of a caller is the caller's, and throws `AccessError` otherwise; wire it to `SessionHost.check`. */
  readonly check: (caller: Caller) => Promise<void>;
  /** Gives the highest score of an item, which is the `scoreMaximum` of its line item (LTI AGS 2.0 section 3.2.8). */
  readonly scoreMaximum: (item: ItemKey) => Promise<number>;
}

/** The options of `ltiPlatformAuthorize`. */
export interface PlatformAuthorizeOptions extends PlatformOptions {
  /** Looks up the registration of a tool by its client identifier, or returns `undefined` when there is none. */
  readonly client: (clientId: string) => Promise<ToolRegistration | undefined>;
  /** Records that an identifier is used until a time (milliseconds since 1970-01-01T00:00:00Z), and returns `false` when it was used already. */
  readonly once: (id: string, expiresAt: number) => Promise<boolean>;
  /** The caller that the host's cookie authenticated, when it arrived: an extra check, never a requirement. */
  readonly caller?: Caller;
}

/** The options of `platformToken`. */
export interface PlatformTokenOptions extends PlatformOptions {
  /** Looks up the registration of a tool by its client identifier, or returns `undefined` when there is none. */
  readonly client: (clientId: string) => Promise<ToolRegistration | undefined>;
  /** The cache of the key sets of tools, from `createJwksCache`. */
  readonly jwks: JwksCache;
  /** Records that an identifier is used until a time (milliseconds since 1970-01-01T00:00:00Z), and returns `false` when it was used already. */
  readonly once: (id: string, expiresAt: number) => Promise<boolean>;
}

/** The options of `agsScores`. */
export interface AgsScoresOptions extends PlatformOptions {
  /** Receives a score that passed every check, with the session and the item instance of its line item. */
  readonly onScore: (session: string, item: ItemKey, score: AgsScore) => Promise<void>;
}

/**
 * Checks the options that every handler needs.
 *
 * @throws `DataError` when they are not an object with a platform configuration and a `clock`.
 */
export function checkPlatformOptions(options: unknown): asserts options is PlatformOptions {
  checkRecord(options, "The options must be an object");
  checkPlatformConfig(options.config);
  checkClock(options.clock);
}

/**
 * Checks the options of `ltiPlatformLogin`.
 *
 * @throws `DataError` when they are not.
 */
export function checkLoginOptions(options: unknown): asserts options is PlatformLoginOptions {
  checkPlatformOptions(options);
  checkRecord(options, "The options must be an object");
  checkFunction(options.registration, "The option registration must be a function");
  checkFunction(options.check, "The option check must be a function");
  checkFunction(options.scoreMaximum, "The option scoreMaximum must be a function");
}

/**
 * Checks the options of `ltiPlatformAuthorize`.
 *
 * @throws `DataError` when they are not.
 */
export function checkAuthorizeOptions(options: unknown): asserts options is PlatformAuthorizeOptions {
  checkPlatformOptions(options);
  checkRecord(options, "The options must be an object");
  checkFunction(options.client, "The option client must be a function");
  checkFunction(options.once, "The option once must be a function");
}

/**
 * Checks the options of `platformToken`.
 *
 * @throws `DataError` when they are not.
 */
export function checkTokenOptions(options: unknown): asserts options is PlatformTokenOptions {
  checkAuthorizeOptions(options);
  checkRecord(options, "The options must be an object");
  checkJwksCache(options.jwks);
}

/**
 * Checks the options of `agsScores`.
 *
 * @throws `DataError` when they are not.
 */
export function checkScoresOptions(options: unknown): asserts options is AgsScoresOptions {
  checkPlatformOptions(options);
  checkRecord(options, "The options must be an object");
  checkFunction(options.onScore, "The option onScore must be a function");
}

/**
 * Checks that a request is for the platform's own origin. The tool's frame is same-origin with any platform page on the
 * player's origin, so a handler mounted elsewhere would put the player at risk.
 *
 * @throws `AccessError` (`wrong-origin`) when the request is for another origin.
 */
export function checkRequestOrigin(request: HttpRequest, config: PlatformConfig): void {
  if (new URL(request.url).origin !== config.origin) {
    throw new AccessError(
      `The platform answers only at ${config.origin}, and the request is for ${new URL(request.url).origin}.`,
      "wrong-origin",
    );
  }
}

/**
 * Finds a tool by its client identifier with the host's lookup and checks the registration.
 *
 * @throws `LtiError` (`client-unknown`) when the platform has no such tool.
 * @throws `DataError` when the lookup returns something that is not a registration.
 */
export async function findClient(
  lookup: (clientId: string) => Promise<ToolRegistration | undefined>,
  clientId: string,
): Promise<ToolRegistration> {
  const registration = await lookup(clientId);
  if (registration === undefined) {
    throw new LtiError(
      `The platform has no tool with the client identifier ${JSON.stringify(clientId)}.`,
      "client-unknown",
    );
  }
  checkToolRegistration(registration);
  if (registration.clientId !== clientId) {
    throw new LtiError(`The registration is not the one of the tool ${JSON.stringify(clientId)}.`, "client-unknown");
  }
  return registration;
}
