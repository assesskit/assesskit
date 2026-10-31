import type { AssessmentItem } from "../asi/index.js";
import type { Findings } from "./findings.js";
import type { PlacedPart, PlacedSection, PlacedTest } from "./test-structure.js";

const ROOT = "qti-assessment-test";

function sectionsOf(placed: PlacedTest): readonly PlacedSection[] {
  const collect = (section: PlacedSection): PlacedSection[] => [
    section,
    ...section.children.flatMap((child) => (child.kind === "section" ? collect(child) : [])),
  ];
  return placed.parts.flatMap((part) => part.sections.flatMap(collect));
}

/**
 * Checks the selection of each section: it selects no more children than it has unless it selects with replacement, and no
 * fewer than the children it requires (INFO §5.129.1, §4.2.2, B21). A sub-section counts as one child.
 */
function checkSelections(placed: PlacedTest, findings: Findings): void {
  for (const section of sectionsOf(placed)) {
    const selection = section.model.selection;
    if (selection === undefined) continue;
    const here = `${ROOT}/qti-assessment-section/qti-selection`;
    const name = JSON.stringify(section.model.identifier);
    const required = section.children.filter(({ model }) => model.required === true).length;
    if (selection.select > section.children.length && selection.withReplacement !== true) {
      const message = `The section ${name} selects ${selection.select} of its ${section.children.length} children without replacement; only a selection with replacement may select more children than the section has.`;
      findings.error("assesskit/validate/selection", message, here);
    }
    if (selection.select < required) {
      const message = `The section ${name} selects ${selection.select} children but requires ${required}; it is an error to select fewer children than the section requires.`;
      findings.error("assesskit/validate/selection", message, here);
    }
  }
}

/** Checks that an adaptive section holds item references only and is a section of a test part (CAT §2.3, B66). */
function checkAdaptiveSections(placed: PlacedTest, findings: Findings): void {
  for (const section of sectionsOf(placed)) {
    if (section.model.adaptiveSelection === undefined) continue;
    const name = JSON.stringify(section.model.identifier);
    const here = `${ROOT}/qti-assessment-section/qti-adaptive-selection`;
    if (section.children.some((child) => child.kind === "section")) {
      const message = `The adaptive section ${name} has a sub-section, but an adaptive section must list all the items of its pool directly.`;
      findings.error("assesskit/validate/adaptive-section", message, here);
    }
    if (section.parent.kind === "section") {
      const message = `The adaptive section ${name} is nested in another section, but it must be a section of a test part.`;
      findings.error("assesskit/validate/adaptive-section", message, here);
    }
  }
}

/** Reports the adaptive items of a part with simultaneous submission, where a candidate takes one attempt (INFO §5.159.5, B27). */
function checkSubmission(
  part: PlacedPart,
  items: ReadonlyMap<string, AssessmentItem | undefined>,
  findings: Findings,
): void {
  if (part.model.submissionMode !== "simultaneous") return;
  const visit = (section: PlacedSection): void => {
    if (section.model.adaptiveSelection !== undefined) return;
    for (const child of section.children) {
      if (child.kind === "section") visit(child);
      else if (items.get(child.model.identifier)?.adaptive === true) {
        const message = `The item reference ${JSON.stringify(child.model.identifier)} names an adaptive item in the test part ${JSON.stringify(part.model.identifier)}, which submits simultaneously; adaptive items need several attempts and so are not compatible with simultaneous submission.`;
        findings.error("assesskit/validate/adaptive-simultaneous", message, `${ROOT}/qti-test-part`);
      }
    }
  };
  for (const section of part.sections) visit(section);
}

/**
 * Checks the structure of a test that does not depend on the expressions of its rules: the selections, the adaptive
 * sections and the submission of the parts.
 *
 * @param items - The item of each item reference, absent where it could not be resolved.
 */
export function checkTestStructure(
  placed: PlacedTest,
  items: ReadonlyMap<string, AssessmentItem | undefined>,
  findings: Findings,
): void {
  checkSelections(placed, findings);
  checkAdaptiveSections(placed, findings);
  for (const part of placed.parts) checkSubmission(part, items, findings);
}
