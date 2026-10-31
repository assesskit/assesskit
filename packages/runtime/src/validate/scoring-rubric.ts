import {
  type AssessmentItem,
  type AssessmentTest,
  rubricScoreRange,
  SCORING_RUBRIC_CLASS,
  type ScoringRubric,
} from "../asi/index.js";
import { scoringRubricBlocks, scoringRubricOf } from "../asi/internal.js";
import type { Findings } from "./findings.js";

const ITEM_ELEMENT = "qti-assessment-item/qti-item-body/qti-rubric-block";
const TEST_ELEMENT = "qti-assessment-test/qti-rubric-block";

type OutcomeDeclaration = (AssessmentItem | AssessmentTest)["outcomeDeclarations"][number];

/**
 * Checks the scoring rubrics of an item or a test, the runtime convention that gives an externally scored outcome its
 * criteria, levels and weights. A rubric block of the convention must keep the rules of the convention, name an outcome
 * that the document declares as externally scored, and be the only one of its outcome; the outcome must be a single
 * integer or float that the sums of the rubric fit. A block below the item body or the test is reported where it is
 * found, by the checks of every element.
 *
 * | Code                                          | Severity | Reported when                                                                                                       |
 * | --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
 * | `assesskit/scoring-rubric/malformed`          | error    | `view` lacks `scorer` or has `candidate`; no `data-outcome-identifier`; an unknown kind; no criteria; a criterion without an identifier or a levels list; a level without `data-score`; a weight or score out of range; a block with both class tokens |
 * | `assesskit/scoring-rubric/shape`              | error    | the shape that the kind requires is broken, a holistic weight other than 1 included                                  |
 * | `assesskit/scoring-rubric/duplicate`          | error    | two blocks for one outcome; a criterion identifier twice; a score twice within a criterion                           |
 * | `assesskit/scoring-rubric/undeclared-outcome` | error    | the outcome is not declared by the document                                                                         |
 * | `assesskit/scoring-rubric/not-external`       | error    | the outcome is not `external-scored`                                                                                 |
 * | `assesskit/scoring-rubric/outcome-type`       | error    | the outcome is not single integer or float, or is integer and some weight times score is not an integer             |
 * | `assesskit/scoring-rubric/out-of-range`       | warning  | the highest sum of the rubric exceeds `normal-maximum`, or the lowest is below `normal-minimum`                      |
 *
 * @param document - The item or the test.
 * @param findings - The findings of the document, which receive the issues.
 */
export function checkScoringRubrics(document: AssessmentItem | AssessmentTest, findings: Findings): void {
  const declared = new Map(document.outcomeDeclarations.map((declaration) => [declaration.identifier, declaration]));
  const owner = document.kind === "assessment-item" ? "item" : "test";
  const element = document.kind === "assessment-item" ? ITEM_ELEMENT : TEST_ELEMENT;
  const named = new Set<string>();
  for (const { block, language, outcomeIdentifier } of scoringRubricBlocks(document)) {
    const { rubric, issues } = scoringRubricOf(block, language);
    const subject = outcomeIdentifier === undefined ? "A scoring rubric" : `The scoring rubric of ${outcomeIdentifier}`;
    for (const { code, path, message } of issues) {
      const where = path === "" ? "" : ` at ${path}`;
      findings.error(`assesskit/scoring-rubric/${code}`, `${subject} is invalid${where}: ${message}.`, element);
    }
    if (outcomeIdentifier === undefined) continue;
    if (named.has(outcomeIdentifier)) {
      const message = `Two rubric blocks of the class ${SCORING_RUBRIC_CLASS} name the outcome ${outcomeIdentifier}; the rubric of an outcome belongs in one block.`;
      findings.error("assesskit/scoring-rubric/duplicate", message, element);
      continue;
    }
    named.add(outcomeIdentifier);
    checkOutcome(outcomeIdentifier, declared.get(outcomeIdentifier), rubric, { owner, element }, findings);
  }
}

function checkOutcome(
  identifier: string,
  declaration: OutcomeDeclaration | undefined,
  rubric: ScoringRubric | undefined,
  { owner, element }: { readonly owner: string; readonly element: string },
  findings: Findings,
): void {
  if (declaration === undefined) {
    const message = `A rubric block of the class ${SCORING_RUBRIC_CLASS} names the outcome ${identifier}, which the ${owner} does not declare.`;
    findings.error("assesskit/scoring-rubric/undeclared-outcome", message, element);
    return;
  }
  if (declaration.externalScored === undefined) {
    const message = `A rubric block of the class ${SCORING_RUBRIC_CLASS} names the outcome ${identifier}, which is not external-scored, so nobody rates it.`;
    findings.error("assesskit/scoring-rubric/not-external", message, element);
  }
  const { cardinality, baseType } = declaration;
  if (cardinality !== "single" || (baseType !== "integer" && baseType !== "float")) {
    const message = `The outcome ${identifier} has a scoring rubric, so it must be a single integer or float, found the cardinality ${cardinality} and the base type ${baseType ?? "none"}.`;
    findings.error("assesskit/scoring-rubric/outcome-type", message, element);
    return;
  }
  if (rubric === undefined) return;
  if (baseType === "integer" && !rubric.criteria.every(isWholeScore)) {
    const message = `The outcome ${identifier} is an integer, but the weight times the score of some level of its rubric is not a whole number.`;
    findings.error("assesskit/scoring-rubric/outcome-type", message, element);
  }
  const { minimum, maximum } = rubricScoreRange(rubric);
  const { normalMaximum, normalMinimum } = declaration;
  if (normalMaximum !== undefined && maximum > normalMaximum) {
    const message = `The highest score of the rubric of ${identifier} is ${maximum}, above the normal maximum of ${normalMaximum}.`;
    findings.warning("assesskit/scoring-rubric/out-of-range", message, element);
  }
  if (normalMinimum !== undefined && minimum < normalMinimum) {
    const message = `The lowest score of the rubric of ${identifier} is ${minimum}, below the normal minimum of ${normalMinimum}.`;
    findings.warning("assesskit/scoring-rubric/out-of-range", message, element);
  }
}

function isWholeScore({ weight, levels }: ScoringRubric["criteria"][number]): boolean {
  return levels.every(({ score }) => Number.isInteger(weight * score));
}
