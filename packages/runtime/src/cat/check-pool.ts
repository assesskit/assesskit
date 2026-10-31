import type { AssessmentSection } from "../asi/index.js";
import { checkArray, checkRecord, checkString, describe } from "../checks.js";
import type { Issue } from "../errors.js";
import { checkStage } from "./item-stage.js";
import type { ItemStage } from "./model.js";

const SECTION_ELEMENT = "qti-assessment-section";

/** Returns the identifiers of the item references that are children of the section, once each, in document order. */
function itemReferencesOf(section: Readonly<Record<string, unknown>>): Set<string> {
  const { children } = section;
  checkArray(children, "The property children of the section must be an array");
  const identifiers = new Set<string>();
  for (const child of children) {
    checkRecord(child, "A child of the section must be an object");
    if (child.kind !== "assessment-item-ref") continue;
    const { identifier } = child;
    checkString(identifier, "The identifier of an item reference");
    identifiers.add(identifier);
  }
  return identifiers;
}

/**
 * Compares the item references of an adaptive section with the item pool of the CAT engine, which Get Section returns
 * (CAT §3.2). The two lists must agree: an item of the pool that the section does not list can be selected and not
 * presented, and an item reference that the pool lacks can never be selected (CAT §2.1, §2.2). Only item references that
 * are children of the section count, because an adaptive section has no nested sections (CAT §2.3); the section must have
 * its includes resolved.
 *
 * @param section - The adaptive section of the test.
 * @param pool - The `items` of the answer to Get Section.
 * @returns One error per identifier that only one side lists: first the item references of the section that the pool
 * lacks, then the items of the pool that the section lacks, each in list order.
 * @throws `DataError` when an argument has the wrong type.
 */
export function checkPool(section: AssessmentSection, pool: ItemStage): readonly Issue[] {
  const input: unknown = section;
  checkRecord(input, "The section must be an object");
  checkStage(pool, "pool");
  checkString(input.identifier, "The identifier of the section");
  const name = describe(input.identifier);
  const listed = itemReferencesOf(input);
  const pooled = new Set(pool.itemIdentifiers ?? []);
  const issues: Issue[] = [];
  for (const identifier of listed) {
    if (pooled.has(identifier)) continue;
    issues.push({
      severity: "error",
      code: "assesskit/cat/item-not-in-pool",
      message: `The adaptive section ${name} lists the item ${describe(identifier)}, which the item pool of the CAT engine does not contain, so the engine can never select it. The item references and the pool must agree.`,
      location: { element: `${SECTION_ELEMENT}/qti-assessment-item-ref` },
    });
  }
  for (const identifier of pooled) {
    if (listed.has(identifier)) continue;
    issues.push({
      severity: "error",
      code: "assesskit/cat/item-not-in-section",
      message: `The item pool of the CAT engine contains the item ${describe(identifier)}, which the adaptive section ${name} does not list, so the engine can select an item that cannot be presented. The item references and the pool must agree.`,
      location: { element: SECTION_ELEMENT },
    });
  }
  return issues;
}
