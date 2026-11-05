import { checkArray, checkRecord, describe } from "@assesskit/runtime/checks";
import type { ScorerItem, ScorerView, ScoringCover, ScoringRequest } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { type Value, writeWireValue } from "@assesskit/runtime/values";
import {
  checkSubmission,
  type Submission,
  type SubmissionItem,
  type SubmissionPart,
  type SubmissionSupplied,
  type SubmissionVariable,
} from "../protocol/index.js";

/**
 * Returns the entries of a map of variables, in the map's order. A value names its own cardinality and base type, so the
 * entry decodes without a declaration; NULL is `null`, because the scorer view does not say which type a NULL would have.
 */
function variablesOf(values: ReadonlyMap<string, Value | null>): SubmissionVariable[] {
  return [...values].map(([identifier, value]) => ({
    identifier,
    value: value === null ? null : writeWireValue(value),
  }));
}

function partOf(cover: ScoringCover): SubmissionPart {
  const { item, responseIdentifier, label, presented, interaction, response } = cover;
  return {
    item: { ref: item.ref, instance: item.instance },
    responseIdentifier,
    ...(label === undefined ? {} : { label }),
    presented,
    ...(interaction === undefined ? {} : { interaction }),
    value: response === null ? null : writeWireValue(response),
  };
}

function itemOf(scored: ScorerItem): SubmissionItem {
  const { key, title, presented, body, templateValues, correctResponses } = scored;
  return {
    key: { ref: key.ref, instance: key.instance },
    title,
    presented,
    body,
    templateValues: variablesOf(templateValues),
    correctResponses: variablesOf(correctResponses),
  };
}

function suppliedOf(request: ScoringRequest): SubmissionSupplied | undefined {
  if (request.supplied === undefined) return undefined;
  const { value, at, scorer } = request.supplied;
  return { value: value === null ? null : writeWireValue(value), at, scorer };
}

/** Checks the parts of a scorer view that are read before the submission is built, so that a wrong type is not a `TypeError`. */
function checkView(view: unknown): asserts view is ScorerView {
  checkRecord(view, "The scorer view must be an object");
  const { request, rubric, items } = view;
  checkRecord(request, "The request of the scorer view must be an object");
  checkArray(request.covers, "The covers of the request of the scorer view must be an array");
  if (request.supplied !== undefined)
    checkRecord(request.supplied, "The supplied score of the request must be an object");
  checkArray(rubric, "The rubric of the scorer view must be an array");
  checkArray(items, "The items of the scorer view must be an array");
  for (const cover of request.covers) {
    checkRecord(cover, "A cover of the scorer view must be an object");
    checkRecord(cover.item, "The item of a cover of the scorer view must be an object");
  }
  for (const item of items) {
    checkRecord(item, "An item of the scorer view must be an object");
    checkRecord(item.key, "The key of an item of the scorer view must be an object");
    for (const [name, variables] of [
      ["templateValues", item.templateValues],
      ["correctResponses", item.correctResponses],
    ]) {
      if (!(variables instanceof Map)) {
        throw new DataError(`The ${name} of an item of the scorer view must be a Map, found ${describe(variables)}.`);
      }
    }
  }
}

/**
 * Turns the scorer view of one scoring request into a submission that is JSON text as it is.
 *
 * @remarks
 * The submission has the outcome with its declaration, the covers as parts with their `presented` flag and submitted
 * value, the rubric of the scorer view, the scoring rubric of the outcome when it has one, and for each covered item the body as the candidate saw it, its template values
 * and its correct responses. Values are the runtime's wire values, so the submission decodes without declarations; NULL
 * is `null`, and a file stays a reference that the host's `files.url` resolves. The submission holds the correct
 * responses: give it only to authorized raters.
 *
 * @param view - What `Engine.scorerView(state, request.id)` returned.
 * @returns The submission, which `mountSubmission` shows and `checkSubmission` accepts.
 * @throws `DataError` when `view` is not a scorer view, or what it holds is not a submission, and a `DataError` of the runtime when a
 * value is not a value.
 */
export function buildSubmission(view: ScorerView): Submission {
  checkView(view);
  const { request, rubric, scoringRubric, items } = view;
  const { id, outcome, mode, variableIdentifierRef, lti, declaration, covers, requestedAt } = request;
  const supplied = suppliedOf(request);
  const submission = {
    request: id,
    outcome,
    mode,
    ...(variableIdentifierRef === undefined ? {} : { variableIdentifierRef }),
    ...(lti === undefined ? {} : { lti }),
    declaration,
    requestedAt,
    ...(supplied === undefined ? {} : { supplied }),
    rubric,
    ...(scoringRubric === undefined ? {} : { scoringRubric }),
    parts: covers.map(partOf),
    items: items.map(itemOf),
  };
  checkSubmission(submission);
  return submission;
}
