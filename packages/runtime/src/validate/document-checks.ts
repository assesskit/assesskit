import { type ElementVisit, SCORE_COVERS_CLASS, SCORING_RUBRIC_CLASS } from "../asi/index.js";
import { XINCLUDE_NAMESPACE } from "../xml/index.js";
import { checkPatternText } from "./expressions.js";
import type { Findings } from "./findings.js";
import { elementPath, isWithin, textOf } from "./model-access.js";

const TEST = "qti-assessment-test";
const ITEM_BODY = "qti-item-body";

/** The interactions with a `pattern-mask`. */
const PATTERN_MASKS = new Set(["qti-text-entry-interaction", "qti-extended-text-interaction"]);

/**
 * Checks one element for what holds in every kind of document: an include left unresolved, the pattern of an interaction,
 * an interaction inside a rubric block, and the class of the covers or of the scoring rubric of an outcome where it is not
 * recognized.
 *
 * @param visit - The element that the walk of the document reached.
 * @param findings - The findings of the document, which receive the issues.
 */
export function checkDocumentElement(visit: ElementVisit, findings: Findings): void {
  checkIncludes(visit, findings);
  const mask = PATTERN_MASKS.has(visit.name) ? textOf(visit.model, "patternMask") : undefined;
  if (mask !== undefined) {
    checkPatternText(findings, mask, `The pattern-mask of the ${visit.name}`, elementPath(visit));
  }
  if (visit.name.endsWith("-interaction") && isWithin(visit, "qti-rubric-block")) {
    const message = `The ${visit.name} is inside a qti-rubric-block, which must not contain interactions.`;
    findings.error("assesskit/validate/rubric-interaction", message, elementPath(visit));
  }
  if (visit.name !== "qti-rubric-block") return;
  if (hasClass(visit, SCORE_COVERS_CLASS) && visit.parent?.name !== TEST) {
    const message = `The qti-rubric-block has the class ${SCORE_COVERS_CLASS}, which only a rubric block of the test is recognized by; here it is an ordinary rubric block.`;
    findings.warning("assesskit/covers/malformed", message, elementPath(visit));
  }
  if (hasClass(visit, SCORING_RUBRIC_CLASS) && visit.parent?.name !== TEST && !isWithin(visit, ITEM_BODY)) {
    const message = `The qti-rubric-block has the class ${SCORING_RUBRIC_CLASS}, which only a rubric block of an item body or of the test is recognized by; here it is an ordinary rubric block.`;
    findings.warning("assesskit/scoring-rubric/malformed", message, elementPath(visit));
  }
}

/** Reports each `xi:include` that the element holds, which must be resolved before the document is validated or run. */
function checkIncludes(visit: ElementVisit, findings: Findings): void {
  for (const element of visit.foreign) {
    if (element.namespace !== XINCLUDE_NAMESPACE) continue;
    const message = `The ${visit.name} holds an xi:include, which must be resolved before the document is validated or run.`;
    findings.error("assesskit/validate/unresolved-include", message, elementPath(visit));
  }
}

function hasClass(visit: ElementVisit, token: string): boolean {
  const classes = visit.model.class;
  return Array.isArray(classes) && classes.includes(token);
}
