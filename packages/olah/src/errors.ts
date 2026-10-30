/** The base class of every error olah throws. */
export class OlahError extends Error {
  /** Error class name. */
  override name = "OlahError";
}

/**
 * The error for an argument of the wrong type or out of range, an untrusted action that is not an action, or a state in
 * an unknown format.
 */
export class DataError extends OlahError {
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
  /** `olah/<module>/<name>`, or the identifier of a rule set in BIND §5. */
  readonly code: string;
  /** A full sentence that says what is wrong and what is expected. */
  readonly message: string;
  /** The specification reference that defines the rule, such as `INFO §5.150` or `olah convention §4.16`. */
  readonly source: string;
  /** Where the problem is, when known. */
  readonly location?: IssueLocation;
}

/** The error for a document that is not well-formed, not in the expected namespace, or cannot be mapped to the model. */
export class ReadError extends OlahError {
  /** Error class name. */
  override name = "ReadError";
  /** The problems found. */
  readonly issues: readonly Issue[];

  /**
   * @param message - Says what could not be read.
   * @param issues - The problems found.
   */
  constructor(message: string, issues: readonly Issue[]) {
    super(message);
    this.issues = issues;
  }
}

/**
 * The error for input that breaks a security rule or a limit: a DOCTYPE, a path escape, a symbolic link, or a size,
 * depth, ratio or container size above its limit.
 */
export class SecurityError extends OlahError {
  /** Error class name. */
  override name = "SecurityError";
  /** The name of the broken limit, such as `maxBytes`. */
  readonly limit: string;
  /** The value of the limit; `0` for a rule that allows none, such as a DOCTYPE. */
  readonly value: number;

  /**
   * @param message - Says which input broke the limit.
   * @param limit - The name of the broken limit.
   * @param value - The value of the limit.
   */
  constructor(message: string, limit: string, value: number) {
    super(message);
    this.limit = limit;
    this.value = value;
  }
}

/**
 * The error for a condition that processing does not define as NULL: an undeclared variable, a type mismatch on
 * assignment, or an unknown template or custom operator.
 */
export class ProcessingError extends OlahError {
  /** Error class name. */
  override name = "ProcessingError";
  /** The specification reference that defines the rule, such as `INFO §2.2.2`. */
  readonly source: string;
  /** The variable, template or operator the error is about, when there is one. */
  readonly identifier?: string;

  /**
   * @param message - Says what is wrong and what is expected.
   * @param source - The specification reference that defines the rule.
   * @param identifier - The variable, template or operator the error is about.
   */
  constructor(message: string, source: string, identifier?: string) {
    super(message);
    this.source = source;
    this.identifier = identifier;
  }
}
