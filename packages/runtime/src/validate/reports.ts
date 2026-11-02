import type { Issue } from "../errors.js";
import { Findings, FindingsLimit } from "./findings.js";

/**
 * The findings of a validation that covers several documents: one `Findings` for each path, so that issues name their file,
 * all within one limit on the number of issues.
 */
export class Reports {
  private readonly byPath = new Map<string | undefined, Findings>();
  private readonly limit: FindingsLimit;

  /** @param maxFindings - The most issues the validation lists. */
  constructor(maxFindings: number) {
    this.limit = new FindingsLimit(maxFindings);
  }

  /**
   * Returns the findings of a document, created on first use.
   *
   * @param path - The path of the document.
   * @returns The findings of the document.
   */
  of(path: string | undefined): Findings {
    let findings = this.byPath.get(path);
    if (findings === undefined) {
      findings = new Findings(path, this.limit);
      this.byPath.set(path, findings);
    }
    return findings;
  }

  /**
   * The issues of every document, document by document in the order they were first reported, and the issue that ends the
   * list when the validation stopped at its limit.
   */
  get issues(): readonly Issue[] {
    return [...[...this.byPath.values()].flatMap((findings) => findings.issues), ...this.limit.end()];
  }
}
