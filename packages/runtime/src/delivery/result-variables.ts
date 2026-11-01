import type { AssessmentItem } from "../asi/index.js";
import { setCorrectResponses } from "../asi/internal.js";
import { checkArray, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import {
  BUILT_IN_OUTCOMES,
  BUILT_IN_RESPONSES,
  createItemVariables,
  describeType,
  type ItemVariables,
  type VariableType,
} from "../processing/index.js";
import { checkItem, fitValue } from "../processing/internal.js";
import type { ItemResult, ResultVariable } from "../results/index.js";
import type { Value } from "../values/index.js";
import { isAdaptive, resetOutcomes } from "./attempt.js";
import { itemContextValues } from "./course.js";

/** The values a stored result holds, by kind of variable and identifier. */
export interface ReportedValues {
  /** The candidate responses, `numAttempts` and `duration` included. */
  readonly responses: ReadonlyMap<string, Value | null>;
  /** The correct responses that the result discloses. */
  readonly keys: ReadonlyMap<string, Value>;
  /** The outcomes. */
  readonly outcomes: ReadonlyMap<string, Value | null>;
  /** The template variables. */
  readonly templates: ReadonlyMap<string, Value | null>;
  /** The context variables. */
  readonly contexts: ReadonlyMap<string, Value | null>;
}

/** Returns the values of the variables of a result, by kind. */
export function reportedValues(variables: readonly ResultVariable[]): ReportedValues {
  const responses = new Map<string, Value | null>();
  const keys = new Map<string, Value>();
  const outcomes = new Map<string, Value | null>();
  const templates = new Map<string, Value | null>();
  const contexts = new Map<string, Value | null>();
  for (const variable of variables) {
    checkRecord(variable, "Each variable of a result must be an object");
    switch (variable.kind) {
      case "response":
        responses.set(variable.identifier, variable.candidateResponse);
        if (variable.correctResponse !== undefined) keys.set(variable.identifier, variable.correctResponse.value);
        break;
      case "outcome":
        outcomes.set(variable.identifier, variable.value);
        break;
      case "template":
        templates.set(variable.identifier, variable.value);
        break;
      case "context":
        contexts.set(variable.identifier, variable.value);
        break;
    }
  }
  return { responses, keys, outcomes, templates, contexts };
}

/**
 * Returns a value of a stored result as the variable of its declaration holds it.
 *
 * @param owner - Names the item or the test in the message, such as `the item Q1`.
 * @throws `DataError` when the value does not fit the declaration: the declaration changed since the result was made.
 */
export function fitReported(
  owner: string,
  kind: string,
  identifier: string,
  type: VariableType,
  value: Value | null,
): Value | null {
  if (value === null) return null;
  const fitted = fitValue(value, type);
  if (fitted === undefined) {
    throw new DataError(
      `The result holds ${describeType(value)} for the ${kind} variable ${identifier} of ${owner}, which ${owner} declares as ${describeType(type)}. The declaration changed since the result was made, so the result cannot be scored again.`,
    );
  }
  return fitted;
}

/** Returns the start values with those that a result holds for the declared variables, each fitted to its declaration. */
function overlay(
  item: AssessmentItem,
  kind: string,
  start: ReadonlyMap<string, Value | null>,
  reported: ReadonlyMap<string, Value | null>,
  types: Iterable<readonly [string, VariableType]>,
): Map<string, Value | null> {
  const merged = new Map(start);
  for (const [identifier, type] of types) {
    const value = reported.get(identifier);
    if (value !== undefined) {
      merged.set(identifier, fitReported(`the item ${item.identifier}`, kind, identifier, type, value));
    }
  }
  return merged;
}

/** Returns the identifier and type of each declaration. */
function typesOf(declarations: readonly (VariableType & { readonly identifier: string })[]) {
  return declarations.map((declaration): readonly [string, VariableType] => [declaration.identifier, declaration]);
}

/**
 * Returns the variables of an item instance as its stored result holds them. A variable the result omits has its start
 * value, as an instance not presented has it; the correct response of a variable that `qti-set-correct-response` sets is
 * the result's, when it holds one, and the declared one otherwise.
 */
export function itemVariablesFromResult(item: AssessmentItem, result: Pick<ItemResult, "variables">): ItemVariables {
  checkItem(item);
  checkRecord(result, "The result of the item must be an object");
  checkArray(result.variables, "The variables of the result of the item must be an array");
  const reported = reportedValues(result.variables);
  const start = createItemVariables(item, { context: itemContextValues(reported.contexts, item) });
  const keys = new Map(start.correctResponses);
  const set = setCorrectResponses(item);
  for (const declaration of item.responseDeclarations) {
    const key = reported.keys.get(declaration.identifier);
    if (key !== undefined && set.has(declaration.identifier)) {
      keys.set(
        declaration.identifier,
        fitReported(`the item ${item.identifier}`, "response", declaration.identifier, declaration, key),
      );
    }
  }
  return {
    ...start,
    responses: overlay(item, "response", start.responses, reported.responses, [
      ...BUILT_IN_RESPONSES,
      ...typesOf(item.responseDeclarations),
    ]),
    outcomes: overlay(item, "outcome", start.outcomes, reported.outcomes, [
      ...BUILT_IN_OUTCOMES,
      ...typesOf(item.outcomeDeclarations),
    ]),
    templates: overlay(item, "template", start.templates, reported.templates, typesOf(item.templateDeclarations)),
    correctResponses: keys,
  };
}

/**
 * Reads the variables that response processing starts from out of a stored result of one item instance.
 *
 * @remarks
 * Responses, `numAttempts`, `duration`, template and context variables, `completionStatus` and the outcomes with
 * `external-scored` are the result's. The other outcomes are reset as the engine resets them before response
 * processing. Defaults are the declared ones, so a default that `qti-set-default-value` set is not known. The correct
 * response is the declared one, except for a variable that `qti-set-correct-response` sets: the result holds its key, as
 * template processing drew it, and a fix to that rule changes no score unless the caller puts the new key into
 * `correctResponses` of the result. A variable the result omits starts as the item declares it.
 *
 * The result is one of an ended session, with one result for each planned instance: the status `initial` and
 * `pendingSubmission` are for the caller to skip, because the first ran no response processing and the second holds a
 * response never submitted.
 *
 * @param item - The item as it is now, with the fix, as `readAsi` reads it.
 * @param result - The stored result of one instance of the item, or the variables of one built from its responses.
 * @returns The variables to give `runResponseProcessing`.
 * @throws `DataError` when an argument has the wrong type, the item is adaptive, because the result holds the last
 * attempt only and an adaptive item's outcomes depend on all of them, so the attempts must be replayed, or a value of the
 * result does not fit the declaration of the item, which means the fix changed the declaration.
 * @throws `ProcessingError` when a declared value is not in the lexical form of its base type.
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
export function readItemVariables(item: AssessmentItem, result: Pick<ItemResult, "variables">): ItemVariables {
  checkItem(item);
  if (isAdaptive(item)) {
    throw new DataError(
      `The item ${describe(item.identifier)} is adaptive and its outcomes depend on every attempt, which a result does not hold. Replay its attempts instead.`,
    );
  }
  const read = itemVariablesFromResult(item, result);
  const reset = resetOutcomes(item, read);
  const outcomes = new Map(reset.outcomes);
  for (const { identifier, externalScored } of item.outcomeDeclarations) {
    if (externalScored !== undefined) outcomes.set(identifier, read.outcomes.get(identifier) ?? null);
  }
  return { ...reset, outcomes };
}
