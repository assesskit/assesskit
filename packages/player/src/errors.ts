import { AssesskitError } from "@assesskit/runtime/errors";

/**
 * The error for a caller that acts on a session it is not bound to, starts a session that exists, or presents a login
 * hint that is forged, expired, used or names another principal. A host maps it to 403.
 */
export class AccessError extends AssesskitError {
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
export class LtiError extends AssesskitError {
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
export class ServiceError extends AssesskitError {
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
