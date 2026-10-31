import type { Issue } from "../errors.js";

/** Collects the issues of one validation, each located in the file the validation names. */
export class Findings {
  /** The issues found, in the order they were reported. */
  readonly issues: Issue[] = [];
  private readonly path: string | undefined;

  /** @param path - The path of the document, named in the location of every issue. */
  constructor(path?: string) {
    this.path = path;
  }

  private report(severity: Issue["severity"], code: string, message: string, element: string | undefined): void {
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
      const { location } = issue;
      const located =
        this.path === undefined || location?.path !== undefined
          ? issue
          : { ...issue, location: { ...location, path: this.path } };
      this.issues.push(located);
    }
  }
}
