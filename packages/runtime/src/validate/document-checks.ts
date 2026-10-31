import { type ElementVisit, SCORE_COVERS_CLASS } from "../asi/index.js";
import { XINCLUDE_NAMESPACE } from "../xml/index.js";
import { checkPatternText } from "./expressions.js";
import type { Findings } from "./findings.js";
import { elementPath, textOf } from "./model-access.js";

/** The interactions with a `pattern-mask` (INFO §5.162.5, §5.48.4). */
const PATTERN_MASKS = new Set(["qti-text-entry-interaction", "qti-extended-text-interaction"]);

/**
 * The checks of an element that hold for every kind of document: an include left unresolved (F-m18), the pattern of an
 * interaction, an interaction inside a rubric block (INFO §2.8.6), and the class of the covers of an outcome below the
 * test, where it is not recognized (§4.16 of the design, O11).
 */
export class DocumentChecks {
  private readonly findings: Findings;

  constructor(findings: Findings) {
    this.findings = findings;
  }

  /** Checks one element. */
  visit(visit: ElementVisit): void {
    this.includes(visit);
    const mask = PATTERN_MASKS.has(visit.name) ? textOf(visit.model, "patternMask") : undefined;
    if (mask !== undefined) {
      checkPatternText(
        this.findings,
        mask,
        `The pattern-mask of the ${visit.name}`,
        "INFO §5.162.5",
        elementPath(visit),
      );
    }
    if (visit.name.endsWith("-interaction") && this.within(visit, "qti-rubric-block")) {
      const message = `The ${visit.name} is inside a qti-rubric-block, which must not contain interactions.`;
      this.findings.error("assesskit/validate/rubric-interaction", message, "INFO §2.8.6", elementPath(visit));
    }
    if (visit.name === "qti-rubric-block" && this.coversBelowTest(visit)) {
      const message = `The qti-rubric-block has the class ${SCORE_COVERS_CLASS}, which only a rubric block of the test is recognized by; here it is an ordinary rubric block.`;
      this.findings.warning("assesskit/covers/malformed", message, "runtime convention §4.16", elementPath(visit));
    }
  }

  private includes(visit: ElementVisit): void {
    for (const element of visit.foreign) {
      if (element.namespace !== XINCLUDE_NAMESPACE) continue;
      const message = `The ${visit.name} holds an xi:include, which must be resolved before the document is validated or run.`;
      this.findings.error("assesskit/validate/unresolved-include", message, "INFO §2.12", elementPath(visit));
    }
  }

  private within(visit: ElementVisit, name: string): boolean {
    for (let at = visit.parent; at !== undefined; at = at.parent) if (at.name === name) return true;
    return false;
  }

  private coversBelowTest(visit: ElementVisit): boolean {
    const classes = visit.model.class;
    const marked = Array.isArray(classes) && classes.includes(SCORE_COVERS_CLASS);
    return marked && visit.parent?.name !== "qti-assessment-test";
  }
}
