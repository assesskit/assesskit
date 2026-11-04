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
