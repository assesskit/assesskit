import type { AssessmentItem, ModalFeedback, TestFeedback } from "../asi/index.js";
import { checkArray, checkChoice, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { Value } from "../values/index.js";
import { isShown } from "./visibility.js";

function checkOutcomes(outcomes: unknown): void {
  if (!(outcomes instanceof Map)) {
    throw new DataError(`The outcomes must be a Map from identifier to value, found ${describe(outcomes)}.`);
  }
}

/**
 * Returns the modal feedback that an item shows after response processing.
 *
 * @remarks
 * A `qti-modal-feedback` is shown when its outcome matches or contains its `identifier` for `show`, and when it does
 * not for `hide`. The engine shows modal feedback directly after response processing, and only when the item session
 * control allows feedback.
 *
 * @param item - The item.
 * @param outcomes - The outcomes of the item session by identifier; an outcome that is missing is NULL.
 * @returns The feedback in document order.
 * @throws `DataError` when an argument has the wrong type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-modal-feedback}
 */
export function visibleModalFeedback(
  item: AssessmentItem,
  outcomes: ReadonlyMap<string, Value | null>,
): readonly ModalFeedback[] {
  const input: unknown = item;
  checkRecord(input, "The item must be an object of the model of qti-assessment-item");
  checkArray(input.modalFeedback, "The modal feedback of the item must be an array");
  checkOutcomes(outcomes);
  return item.modalFeedback.filter((feedback) =>
    isShown(feedback.showHide, feedback.identifier, outcomes.get(feedback.outcomeIdentifier) ?? null),
  );
}

/**
 * Returns the test feedback of one access that is shown.
 *
 * @remarks
 * `during` feedback is shown after outcome processing, and `atEnd` feedback at the end of its test part or test.
 * Whether a test part or the test has ended is the engine's to know; the feedback of a part comes from the part, and
 * that of the test from the test.
 *
 * @param feedback - The `qti-test-feedback` of a test or test part.
 * @param outcomes - The outcomes of the test by identifier; an outcome that is missing is NULL.
 * @param access - Which feedback to return.
 * @returns The feedback in document order whose `access` is the one asked for and whose outcome shows it.
 * @throws `DataError` when an argument has the wrong type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function visibleTestFeedback(
  feedback: readonly TestFeedback[],
  outcomes: ReadonlyMap<string, Value | null>,
  access: "atEnd" | "during",
): readonly TestFeedback[] {
  checkArray(feedback, "The test feedback must be an array");
  checkOutcomes(outcomes);
  checkChoice(access, "The access", ["during", "atEnd"]);
  return feedback.filter(
    (entry) =>
      entry.access === access &&
      isShown(entry.showHide, entry.identifier, outcomes.get(entry.outcomeIdentifier) ?? null),
  );
}
