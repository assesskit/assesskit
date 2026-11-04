/** The base class of every error that assesskit throws: the runtime's, and the errors of `@assesskit/player`. */
export class AssesskitError extends Error {
  /** Error class name. */
  override name = "AssesskitError";
}

/**
 * The error for an argument of the wrong type or out of range, an untrusted action that is not an action, or a state in
 * an unknown format.
 */
export class DataError extends AssesskitError {
  /** Error class name. */
  override name = "DataError";
}

/** Where a problem is: a file path, a position in it, and the path of the element. */
export interface IssueLocation {
  /** The path of the file in its package or directory. */
  readonly path?: string;
  /** The line, from 1. */
  readonly line?: number;
  /** The column, from 1. */
  readonly column?: number;
  /** The element path, such as `qti-assessment-item/qti-item-body`. */
  readonly element?: string;
}

/** A problem found in a document, model or package. Validation returns issues; it does not throw. */
export interface Issue {
  /** An `error` makes the content invalid; a `warning` flags content that runs but deviates from a recommendation. */
  readonly severity: "error" | "warning";
  /** The rule that the content breaks: `assesskit/<module>/<name>`, or the identifier of a rule set in BIND section 5. */
  readonly rule: string;
  /** A full sentence that says what is wrong and what is expected. */
  readonly message: string;
  /** Where the problem is, when known. */
  readonly location?: IssueLocation;
}

/** The error for a document that is not well-formed, not in the expected namespace, or cannot be mapped to the model. */
export class ReadError extends AssesskitError {
  /** Error class name. */
  override name = "ReadError";
  /** The problems found. */
  readonly issues: readonly Issue[];

  /**
   * @param message - Says what could not be read.
   * @param issues - The problems found.
   * @param options - The `cause`: the error that this one reports.
   */
  constructor(message: string, issues: readonly Issue[], options?: ErrorOptions) {
    super(message, options);
    this.issues = issues;
  }
}

/**
 * The error for input that breaks a security rule or a limit: a DOCTYPE, a path escape, a symbolic link, or a size,
 * depth, ratio or container size above its limit.
 */
export class SecurityError extends AssesskitError {
  /** Error class name. */
  override name = "SecurityError";
  /** The name of the broken limit or rule: the option that sets it, such as `maxBytes`, or a rule that the guide names, such as `symlink`. */
  readonly limit: string;
  /** The value of the limit, in the unit of its name; `0` for a rule that allows none, such as a DOCTYPE. */
  readonly maximum: number;

  /**
   * @param message - Says which input broke the limit.
   * @param limit - The name of the broken limit or rule.
   * @param maximum - The value of the limit.
   * @param options - The `cause`: the error that this one reports.
   */
  constructor(message: string, limit: string, maximum: number, options?: ErrorOptions) {
    super(message, options);
    this.limit = limit;
    this.maximum = maximum;
  }
}

/**
 * The error for a condition that processing does not define as NULL: an undeclared variable, a type mismatch on
 * assignment, an unknown template or custom operator, or a custom operator that throws.
 */
export class ProcessingError extends AssesskitError {
  /** Error class name. */
  override name = "ProcessingError";
  /** The variable, template or operator the error is about, when there is one. */
  readonly identifier?: string;

  /**
   * @param message - Says what is wrong and what is expected.
   * @param identifier - The variable, template or operator the error is about.
   * @param options - The `cause`: the error that this one reports.
   */
  constructor(message: string, identifier?: string, options?: ErrorOptions) {
    super(message, options);
    this.identifier = identifier;
  }
}

/**
 * The error for a call to a service that fails, such as the endpoints of a CAT engine, and for a store conflict that
 * outlasts its retries.
 *
 * @remarks
 * A `CatPort` that a handler serves also throws it to refuse a request: the status 400 for data of the request that
 * the engine finds invalid, 404 for an object that is unknown, and 429 or 503 for an engine that is busy. The handler
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
