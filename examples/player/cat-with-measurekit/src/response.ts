import { DataError } from "@assesskit/runtime/errors";
import type { AssessmentResult, ItemResult } from "@assesskit/runtime/results";
import type { Value } from "@assesskit/runtime/values";
import type { TestItem } from "@measurekit/psychometrics/irt";
import { checkArray, checkRecord, describe } from "./checks.ts";

/** The outcome that carries the score of an item. */
const SCORE = "SCORE";

/**
 * Maps the outcomes of an item to its response category in the item's model.
 *
 * @param item - The identifier of the item.
 * @param outcomes - The outcome variables of the item's result, by identifier.
 * @returns The category, a whole number from 0 to one less than the item's number of categories.
 */
export type CategoryOfOutcomes = (item: string, outcomes: ReadonlyMap<string, Value | null>) => number;

/**
 * Returns the `SCORE` of an item as its category. A dichotomous item has the categories 0 and 1, and a polytomous item
 * the scores 0 to one less than its categories, so a score is the category (the CAT service asks for a `SCORE` per item).
 *
 * @throws `DataError` when the item has no numeric `SCORE`.
 */
export const scoreCategory: CategoryOfOutcomes = (item, outcomes) => {
  const score = outcomes.get(SCORE);
  if (score?.cardinality === "single" && typeof score.value === "number") return score.value;
  throw new DataError(
    `The outcome ${SCORE} of the item ${describe(item)} must be a single number to serve as its response category, found ${score === undefined ? "none" : describe(score)}.`,
  );
};

/** The category of an item that the candidate submitted without a response: no credit, the lowest category of any model. */
const NO_CREDIT = 0;

/** The `sessionStatus` of an item that the candidate submitted without a response. */
const SUBMITTED_BLANK = "initial";

/** Returns the last result for an item. */
function resultOf(result: AssessmentResult, item: string): ItemResult {
  checkRecord(result, "The assessmentResult must be an object");
  checkArray(result.itemResults, "The itemResults of the assessmentResult must be an array");
  const itemResult = result.itemResults.findLast((candidate) => candidate.identifier === item);
  if (itemResult === undefined) {
    throw new DataError(
      `The assessmentResult has no result for the item ${describe(item)}, which the session presented.`,
    );
  }
  checkArray(itemResult.variables, `The variables of the result for the item ${describe(item)} must be an array`);
  return itemResult;
}

/** Returns the outcome variables of an item result, by identifier. */
const outcomesOf = ({ variables }: ItemResult): ReadonlyMap<string, Value | null> =>
  new Map(
    variables.flatMap((variable) =>
      variable.kind === "outcome" ? [[variable.identifier, variable.value] as const] : [],
    ),
  );

/**
 * Returns the response of the candidate to an item as a category of the item's model. An item with the status `initial`
 * was submitted without a response and has no `SCORE`: it is category 0, without asking `category`.
 *
 * @param category - Maps the outcomes of the item to its category.
 * @throws `DataError` when the results have none for the item, or the category is not a whole number from 0 to one less
 * than the item's categories.
 */
export function responseTo(item: TestItem, result: AssessmentResult, category: CategoryOfOutcomes): number {
  const itemResult = resultOf(result, item.id);
  const response = itemResult.sessionStatus === SUBMITTED_BLANK ? NO_CREDIT : category(item.id, outcomesOf(itemResult));
  const count = item.model.categoryCount(item.parameters);
  if (!(Number.isSafeInteger(response) && response >= 0 && response < count)) {
    throw new DataError(
      `The response category of the item ${describe(item.id)} must be a whole number from 0 to ${count - 1}, found ${describe(response)}.`,
    );
  }
  return response;
}
