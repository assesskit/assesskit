import { AssesskitError } from "@assesskit/runtime/errors";

/**
 * The rule that a caller broke, the reason of an {@link AccessError}: `not-bound` for a session that does not belong to the
 * caller's principal or does not exist, `session-exists` for a start of a session that exists.
 */
export type AccessErrorReason = "not-bound" | "session-exists";

/** The error for a caller that acts on a session it is not bound to, or starts a session that exists. A host maps it to 403. */
export class AccessError extends AssesskitError {
  /** Error class name. */
  override name = "AccessError";
  /** The rule the caller broke. */
  readonly reason: AccessErrorReason;

  /**
   * @param message - Says what the caller did and what is expected.
   * @param reason - The rule the caller broke.
   * @param options - The `cause`: the error that this one reports.
   */
  constructor(message: string, reason: AccessErrorReason, options?: ErrorOptions) {
    super(message, options);
    this.reason = reason;
  }
}

/**
 * The error for a call to a service that fails, such as the endpoints of a CAT engine, and for a store conflict that
 * outlasts its retries.
 *
 * @remarks
 * A `CatPort` that `createCatRestHandler` serves also throws it to refuse a request: the status 400 for data of the request
 * that the engine finds invalid, 404 for an object that is unknown, and 429 or 503 for an engine that is busy. The handler
 * answers with that status and a fixed text, and never shows the message.
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
   * @param options - The `cause`: the error that this one reports.
   */
  constructor(message: string, status: number, body: string, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
    this.body = body;
  }
}
