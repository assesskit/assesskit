import type { Issue } from "../errors.js";

/** The most issues that a validation lists unless the caller says otherwise. */
export const DEFAULT_MAX_FINDINGS = 1000;

/**
 * How many more issues a validation lists, shared by the findings of every document it checks, so that content that is
 * wrong in a million places costs the memory of the limit and not of a million issues.
 */
export class FindingsLimit {
  private left: number;
  private stopped = false;
  private readonly maxFindings: number;

  /** @param maxFindings - The most issues the validation lists. */
  constructor(maxFindings: number) {
    this.maxFindings = maxFindings;
    this.left = maxFindings;
  }

  /** Takes the room for one more issue; `false`, and the list stops, when the limit is reached. */
  take(): boolean {
    if (this.left === 0) {
      this.stopped = true;
      return false;
    }
    this.left -= 1;
    return true;
  }

  /**
   * Returns the issue that ends a list that stopped: an error, because a validation that stopped cannot say that the content
   * holds no more errors. None when the list did not stop.
   */
  end(): Issue[] {
    if (!this.stopped) return [];
    return [
      {
        severity: "error",
        code: "assesskit/validate/findings-stopped",
        message: `The validation stopped after ${this.maxFindings} issues, so the content may hold more, errors among them. Raise the option maxFindings to list them.`,
      },
    ];
  }
}

/** Collects the issues of one validation, each located in the file the validation names. */
export class Findings {
  /** The issues found, in the order they were reported, up to the limit. */
  readonly issues: Issue[] = [];
  private readonly path: string | undefined;
  private readonly limit: FindingsLimit;

  /**
   * @param path - The path of the document, named in the location of every issue.
   * @param limit - The limit that the findings share with those of the other documents of the validation; by default
   * one of their own, at `DEFAULT_MAX_FINDINGS`.
   */
  constructor(path?: string, limit = new FindingsLimit(DEFAULT_MAX_FINDINGS)) {
    this.path = path;
    this.limit = limit;
  }

  /** Returns the issues, with the one that ends the list when the validation stopped at its limit. */
  list(): readonly Issue[] {
    return [...this.issues, ...this.limit.end()];
  }

  private report(severity: Issue["severity"], code: string, message: string, element: string | undefined): void {
    if (!this.limit.take()) return;
    const location = {
      ...(this.path === undefined ? {} : { path: this.path }),
      ...(element === undefined ? {} : { element }),
    };
    this.issues.push({
      severity,
      code,
      message,
      ...(Object.keys(location).length === 0 ? {} : { location }),
    });
  }

  /**
   * Reports content that breaks a rule.
   *
   * @param code - The issue code.
   * @param message - A full sentence that says what is wrong and what is expected.
   * @param element - The element path.
   */
  error(code: string, message: string, element?: string): void {
    this.report("error", code, message, element);
  }

  /**
   * Reports content that runs but deviates from a recommendation.
   *
   * @param code - The issue code.
   * @param message - A full sentence that says what deviates and what is recommended.
   * @param element - The element path.
   */
  warning(code: string, message: string, element?: string): void {
    this.report("warning", code, message, element);
  }

  /**
   * Adds issues that another check returned, such as `checkBindings`, naming the file when they do not.
   *
   * @param issues - The issues to add.
   */
  adopt(issues: readonly Issue[]): void {
    for (const issue of issues) {
      if (!this.limit.take()) return;
      const { location } = issue;
      const located =
        this.path === undefined || location?.path !== undefined
          ? issue
          : { ...issue, location: { ...location, path: this.path } };
      this.issues.push(located);
    }
  }
}
