import { checkFunction, checkRecord, describe } from "../checks.js";
import { LtiError } from "../errors.js";
import { type Clock, checkClock } from "./clock.js";
import { checkJwksCache, type JwksCache } from "./jwks.js";
import type { LtiDeployment } from "./launch-model.js";
import { checkPlatformRegistration, type PlatformRegistration } from "./registration.js";
import type { Fetch } from "./service.js";
import { checkLtiStore, type LtiStore } from "./store.js";

/** What every function of the tool role needs: where its registrations are, and the time. */
export interface ToolOptions {
  /**
   * Looks up the registration for the issuer of a platform and, when the platform names one, the client identifier of
   * the tool at that platform. Returns `undefined` when the tool has none.
   */
  readonly registration: (issuer: string, clientId: string | undefined) => Promise<PlatformRegistration | undefined>;
  /** The source of the current time. */
  readonly clock: Clock;
}

/** The options of `ltiLogin`. */
export interface LtiLoginOptions extends ToolOptions {
  /** Where the tool keeps the logins in progress. */
  readonly store: LtiStore;
}

/** The options of `ltiLaunch`. */
export interface LtiLaunchOptions extends ToolOptions {
  /** Where the tool keeps the logins in progress. */
  readonly store: LtiStore;
  /** The cache of the platforms' key sets, from `createJwksCache`. */
  readonly jwks: JwksCache;
}

/** The options of `ltiAccessToken`. */
export interface AccessTokenOptions extends ToolOptions {
  /** The `fetch` that calls the platform's token endpoint. */
  readonly fetch: Fetch;
  /** The most time that the call may take, in milliseconds. Default: `10000`. */
  readonly timeoutMs?: number;
}

/**
 * Checks the options that every function needs.
 *
 * @throws `DataError` when they are not an object with a function `registration` and a `clock`.
 */
export function checkToolOptions(options: unknown): asserts options is ToolOptions {
  checkRecord(options, "The options must be an object");
  checkFunction(options.registration, "The option registration must be a function");
  checkClock(options.clock);
}

/**
 * Checks the options of `ltiLogin`.
 *
 * @throws `DataError` when they are not.
 */
export function checkLoginOptions(options: unknown): asserts options is LtiLoginOptions {
  checkRecord(options, "The options must be an object");
  checkToolOptions(options);
  checkLtiStore(options.store);
}

/**
 * Checks the options of `ltiLaunch`.
 *
 * @throws `DataError` when they are not.
 */
export function checkLaunchOptions(options: unknown): asserts options is LtiLaunchOptions {
  checkRecord(options, "The options must be an object");
  checkToolOptions(options);
  checkLtiStore(options.store);
  checkJwksCache(options.jwks);
}

/**
 * Finds the registration of a platform with the host's lookup and checks it.
 *
 * @throws `LtiError` (`platform-unknown`) when the tool has none for the issuer and the client identifier.
 * @throws `DataError` when the lookup returns something that is not a registration.
 */
export async function findRegistration(
  options: ToolOptions,
  issuer: string,
  clientId: string | undefined,
): Promise<PlatformRegistration> {
  const registration = await options.registration(issuer, clientId);
  if (registration === undefined) {
    throw new LtiError(`The tool has no registration for the platform ${describe(issuer)}.`, "platform-unknown");
  }
  checkPlatformRegistration(registration);
  if (registration.issuer !== issuer || (clientId !== undefined && registration.clientId !== clientId)) {
    throw new LtiError(
      `The registration does not match the platform ${describe(issuer)} and the client ${describe(clientId)}.`,
      "platform-unknown",
    );
  }
  return registration;
}

/**
 * Finds the registration for a deployment that an earlier launch returned.
 *
 * @throws `LtiError` (`platform-unknown`) when the tool has no registration for the platform and the client, and
 * (`deployment-unknown`) when the registration no longer lists the deployment.
 */
export async function findDeployment(options: ToolOptions, deployment: LtiDeployment): Promise<PlatformRegistration> {
  const registration = await findRegistration(options, deployment.issuer, deployment.clientId);
  if (!registration.deploymentIds.includes(deployment.deploymentId)) {
    throw new LtiError(
      `The deployment ${describe(deployment.deploymentId)} is not one of the deployments of the registration.`,
      "deployment-unknown",
    );
  }
  return registration;
}
