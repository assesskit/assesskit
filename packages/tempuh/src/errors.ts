/** The base class of every error tempuh throws. olah's errors pass through tempuh unchanged. */
export class TempuhError extends Error {
  /** Error class name. */
  override name = "TempuhError";
}

/**
 * The error for an argument of the wrong type or out of range, and for untrusted input that is not what it should be:
 * an envelope, a token, a payload of a service, a message of a frame, or a client action outside the policy.
 */
export class DataError extends TempuhError {
  /** Error class name. */
  override name = "DataError";
}

/**
 * The error for a caller that acts on a session it is not bound to, starts a session that exists, or presents a login
 * hint that is forged, expired, used or names another principal. A host maps it to 403.
 */
export class AccessError extends TempuhError {
  /** Error class name. */
  override name = "AccessError";
  /** A kebab-case code that names the rule the caller broke, such as `session-exists`. */
  readonly reason: string;

  /**
   * @param message - Says what the caller did and what is expected.
   * @param reason - A kebab-case code that names the broken rule.
   */
  constructor(message: string, reason: string) {
    super(message);
    this.reason = reason;
  }
}

/** The error for a message of an LTI launch, login or service that fails validation, in either role. */
export class LtiError extends TempuhError {
  /** Error class name. */
  override name = "LtiError";
  /** A kebab-case code that names the failed check, such as `nonce-reused`. */
  readonly reason: string;

  /**
   * @param message - Says what failed and what is expected.
   * @param reason - A kebab-case code that names the failed check.
   */
  constructor(message: string, reason: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * The error for a call to a service that fails, such as the CAT, AGS, JWKS and Caliper endpoints, and for a store
 * conflict that outlasts its retries.
 */
export class ServiceError extends TempuhError {
  /** Error class name. */
  override name = "ServiceError";
  /** The HTTP status of the failed call; `409` for a store conflict, and `0` when the call got no answer. */
  readonly status: number;
  /** The body of the response, or the empty string when the call had none. */
  readonly body: string;

  /**
   * @param message - Says which call failed.
   * @param status - The HTTP status of the failed call.
   * @param body - The body of the response.
   */
  constructor(message: string, status: number, body: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Tells whether an error is a `DataError` of tempuh or of olah. They are two classes with one name, and olah's errors
 * pass through tempuh unchanged, so `instanceof` knows only one of them. The player asks it to drop what a frame sent and
 * olah or tempuh refuses, and to let the errors of the host's storage through.
 */
export function isDataError(error: unknown): boolean {
  return error instanceof Error && error.name === "DataError";
}
