import type { Issue } from "../errors.js";
import { Findings } from "./findings.js";

/** The findings of a validation that covers several documents: one `Findings` for each path, so that issues name their file. */
export class Reports {
  private readonly byPath = new Map<string | undefined, Findings>();

  /** Returns the findings of a document, created on first use. */
  of(path: string | undefined): Findings {
    let findings = this.byPath.get(path);
    if (findings === undefined) {
      findings = new Findings(path);
      this.byPath.set(path, findings);
    }
    return findings;
  }

  /** The issues of every document, document by document in the order they were first reported. */
  get issues(): readonly Issue[] {
    return [...this.byPath.values()].flatMap((findings) => findings.issues);
  }
}
