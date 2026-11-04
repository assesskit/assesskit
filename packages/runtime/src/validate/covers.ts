import { type AssessmentTest, SCORE_COVERS_CLASS, type ScoreCoverBlock, selectScoreCoverBlocks } from "../asi/index.js";
import type { Findings } from "./findings.js";
import type { ItemRefInfo } from "./test-scope.js";

const ELEMENT = "qti-assessment-test/qti-rubric-block";

/**
 * Checks the covers of the externally scored outcomes of a test, the runtime convention that names the responses an outcome
 * rates. A rubric block of the convention must be shown to scorers and hidden from candidates, as its `view` is a list;
 * name an outcome that the test declares as externally scored; and list
 * each response once, of an item reference of the test and of an item that declares the response. A block below the
 * test is reported where it is found, by the checks of every element.
 *
 * | Code                            | Reported when                                                                           |
 * | ------------------------------- | --------------------------------------------------------------------------------------- |
 * | `assesskit/covers/undeclared-outcome`| a block names an outcome that the test does not declare                                 |
 * | `assesskit/covers/not-external`      | the outcome is not `external-scored`                                                    |
 * | `assesskit/covers/unknown-item-ref`  | a cover names an item reference that the test does not have                             |
 * | `assesskit/covers/unknown-response`  | a cover names a response that the item of the item reference does not declare           |
 * | `assesskit/covers/duplicate`         | a block lists a cover twice, or two blocks name one outcome                             |
 * | `assesskit/covers/malformed`         | a block lacks `scorer` in `view`, has `candidate`, or lacks `data-outcome-identifier`; an entry lacks an attribute |
 *
 * @param test - The test.
 * @param itemRefs - The item references of the test by identifier, with their items where they could be resolved; absent
 * when the test is checked alone, so that what the covers name is not checked.
 * @param findings - The findings of the document, which receive the issues.
 */
export function checkCovers(
  test: AssessmentTest,
  itemRefs: ReadonlyMap<string, ItemRefInfo> | undefined,
  findings: Findings,
): void {
  const declared = new Map(test.outcomeDeclarations.map((declaration) => [declaration.identifier, declaration]));
  const named = new Set<string>();
  for (const block of selectScoreCoverBlocks(test)) {
    if (!block.block.view.includes("scorer") || block.block.view.includes("candidate")) {
      const message = `The rubric block of the class ${SCORE_COVERS_CLASS} must be shown to scorers and hidden from candidates: its view must contain scorer and not candidate, found ${block.block.view.join(" ")}.`;
      findings.error("assesskit/covers/malformed", message, ELEMENT);
    }
    const { outcomeIdentifier } = block;
    if (outcomeIdentifier === undefined) {
      const message = `The rubric block of the class ${SCORE_COVERS_CLASS} must name the outcome it covers in data-outcome-identifier.`;
      findings.error("assesskit/covers/malformed", message, ELEMENT);
    } else {
      checkOutcome(outcomeIdentifier, declared.get(outcomeIdentifier), named, findings);
    }
    checkEntries(block, itemRefs, findings);
  }
}

/** Checks the entries of a covers block: each has both attributes, is listed once, and names a response of an item reference. */
function checkEntries(
  { outcomeIdentifier, entries }: ScoreCoverBlock,
  itemRefs: ReadonlyMap<string, ItemRefInfo> | undefined,
  findings: Findings,
): void {
  const of = outcomeIdentifier ?? "an outcome";
  const listed = new Set<string>();
  for (const { itemRef, responseIdentifier } of entries) {
    if (itemRef === undefined || responseIdentifier === undefined) {
      const message = `A list entry of the covers of ${of} must have both data-item-ref and data-response-identifier.`;
      findings.error("assesskit/covers/malformed", message, ELEMENT);
      continue;
    }
    const key = JSON.stringify([itemRef, responseIdentifier]);
    if (listed.has(key)) {
      const message = `The covers of ${of} list the response ${responseIdentifier} of the item reference ${itemRef} twice.`;
      findings.error("assesskit/covers/duplicate", message, ELEMENT);
    }
    listed.add(key);
    if (itemRefs !== undefined) checkCover(itemRef, responseIdentifier, itemRefs, findings);
  }
}

function checkOutcome(
  identifier: string,
  declaration: AssessmentTest["outcomeDeclarations"][number] | undefined,
  named: Set<string>,
  findings: Findings,
): void {
  if (named.has(identifier)) {
    const message = `Two rubric blocks of the class ${SCORE_COVERS_CLASS} name the outcome ${identifier}; the covers of an outcome belong in one block.`;
    findings.error("assesskit/covers/duplicate", message, ELEMENT);
  }
  named.add(identifier);
  if (declaration === undefined) {
    const message = `A rubric block of the class ${SCORE_COVERS_CLASS} names the outcome ${identifier}, which the test does not declare.`;
    findings.error("assesskit/covers/undeclared-outcome", message, ELEMENT);
  } else if (declaration.externalScored === undefined) {
    const message = `A rubric block of the class ${SCORE_COVERS_CLASS} names the outcome ${identifier}, which is not external-scored, so nobody rates it.`;
    findings.error("assesskit/covers/not-external", message, ELEMENT);
  }
}

function checkCover(
  itemRef: string,
  responseIdentifier: string,
  itemRefs: ReadonlyMap<string, ItemRefInfo>,
  findings: Findings,
): void {
  const info = itemRefs.get(itemRef);
  if (info === undefined) {
    const message = `A cover names the item reference ${itemRef}, which the test does not have.`;
    findings.error("assesskit/covers/unknown-item-ref", message, ELEMENT);
  } else if (
    info.item !== undefined &&
    !info.item.responseDeclarations.some(({ identifier }) => identifier === responseIdentifier)
  ) {
    const message = `A cover names the response ${responseIdentifier} of the item reference ${itemRef}, whose item declares no such response variable.`;
    findings.error("assesskit/covers/unknown-response", message, ELEMENT);
  }
}
