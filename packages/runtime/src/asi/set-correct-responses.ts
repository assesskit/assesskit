import type { AssessmentItem } from "./model.js";

/** Collects the identifiers that a `qti-set-correct-response` rule sets, anywhere in a model of template processing. */
function collect(model: unknown, identifiers: Set<string>): void {
  if (Array.isArray(model)) {
    for (const member of model) collect(member, identifiers);
  } else if (typeof model === "object" && model !== null) {
    if (
      "kind" in model &&
      model.kind === "set-correct-response" &&
      "identifier" in model &&
      typeof model.identifier === "string"
    ) {
      identifiers.add(model.identifier);
    }
    for (const member of Object.values(model)) collect(member, identifiers);
  }
}

/** The sets that items have, found at the first need: an item never changes. */
const SETS = new WeakMap<AssessmentItem, ReadonlySet<string>>();

/**
 * Returns the response variables whose correct response the template processing of an item sets, in any branch.
 *
 * @param item - The item, as `readAsi` reads it.
 * @returns The identifiers of the response variables.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-set-correct-response}
 */
export function setCorrectResponses(item: AssessmentItem): ReadonlySet<string> {
  const known = SETS.get(item);
  if (known !== undefined) return known;
  const identifiers = new Set<string>();
  collect(item.templateProcessing, identifiers);
  SETS.set(item, identifiers);
  return identifiers;
}
