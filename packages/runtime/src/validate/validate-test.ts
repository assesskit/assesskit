import { type AssessmentTest, walkDocument } from "../asi/index.js";
import { checkFunction, checkRecord, checkString, describe } from "../checks.js";
import { DataError, type Issue } from "../errors.js";
import type { Resolvers } from "../package/index.js";
import { checkValidateOptions, type ValidateOptions } from "./options.js";
import { Reports } from "./reports.js";
import { checkTest } from "./test.js";

/** The kind of the model of `qti-assessment-test`. */
const TEST_KIND = "assessment-test";

/**
 * Validates a test with what it names: its own document as `validateAsi` checks it, and in addition the structure it
 * builds when the section references are resolved (identifiers, selection, adaptive sections, branch rules and
 * pre-conditions, their targets and what no path reaches), the variables of its item references (the item variables its
 * outcome processing reads as `ITEM.VARIABLE`, variable mappings, weights, template defaults), the covers of its
 * externally scored outcomes, and every item and stimulus it names, checked as `validateAsi` checks them. A reference
 * that cannot be resolved is an issue, and what it names is left out. This is the static gate of `createEngine`: it
 * reports what would fail when the test runs.
 *
 * @param test - The test, as `readAsi` reads it, with its includes resolved.
 * @param base - The path of the test document, against which its references resolve; named in the location of its issues.
 * @param resolvers - Resolvers for the references of the test, such as those of `packageResolvers`. They may throw an
 * error of the runtime for a reference that cannot be resolved.
 * @param options - See {@link ValidateOptions}; its `path` is not used: issues name the file each document is at.
 * @returns The issues, document by document: those of the test, then of the sections, items and stimuli it names.
 * @throws `DataError` when an argument has the wrong type, the test is not an object of the model of
 * `qti-assessment-test`, or a resolver returns a promise, which is a defect of the host and not a finding.
 */
export function validateTest(
  test: AssessmentTest,
  base: string,
  resolvers: Resolvers,
  options: ValidateOptions = {},
): readonly Issue[] {
  const checked = checkValidateOptions(options);
  checkRecord(test, "The test must be an object of the model of qti-assessment-test");
  if (test.kind !== TEST_KIND) {
    throw new DataError(`The test must be the model of a qti-assessment-test, found the kind ${describe(test.kind)}.`);
  }
  checkString(base, "The base");
  checkRecord(resolvers, "The resolvers must be an object");
  for (const name of ["items", "sections", "stimuli"] as const) {
    checkFunction(resolvers[name], `The resolvers must have a function ${name} of an href and a base`);
  }
  // The checks read the model by its properties, so the shape of the whole model is checked first.
  walkDocument({ kind: "test", test }, () => undefined);
  const reports = new Reports(checked.maxFindings);
  checkTest(test, reports, checked, { base, resolvers });
  return reports.issues;
}
