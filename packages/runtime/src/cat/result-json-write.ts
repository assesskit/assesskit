// biome-ignore-all lint/style/useNamingConvention: The names of the JSON fields are those of the binding.
import { checkArray, checkRecord } from "../checks.js";
import type {
  AssessmentResult,
  ItemResult,
  OutcomeVariable,
  ResponseVariable,
  ResultContext,
  ResultVariable,
  ResultVariableType,
  SessionStatus,
  TemplateVariable,
  TestResult,
} from "../results/index.js";
import { type BaseType, formatPrimitive, type Value } from "../values/index.js";

// The field names of the public binding differ from the runtime's model in `sourceID`, `itemResult` and the three lists
// of variables of a result.

/** The `sessionStatus` terms of the binding: those of QTI 2.2 Results Reporting, without `pendingExternalScoring`. */
const BINDING_STATUSES: readonly SessionStatus[] = [
  "final",
  "initial",
  "pendingResponseProcessing",
  "pendingSubmission",
];

/** A value in the binding: the lexical form, with a field identifier and base type for the field of a record. */
interface ValueJson {
  readonly value: string;
  readonly fieldIdentifier?: string;
  readonly baseType?: BaseType;
}

/** Returns the values of a variable in the binding: none for NULL, as the binding says NULL is the absence of a value. */
function valueToJson(value: Value | null): ValueJson[] {
  if (value === null) return [];
  switch (value.cardinality) {
    case "single":
      return [{ value: formatPrimitive(value.value, value.baseType) }];
    case "multiple":
    case "ordered":
      return value.values.map((primitive) => ({ value: formatPrimitive(primitive, value.baseType) }));
    case "record":
      return [...value.fields].map(([fieldIdentifier, field]) => ({
        fieldIdentifier,
        baseType: field.baseType,
        value: formatPrimitive(field.value, field.baseType),
      }));
  }
}

function typeToJson({ cardinality, baseType }: ResultVariableType): { cardinality: string; baseType?: string } {
  return baseType === undefined ? { cardinality } : { cardinality, baseType };
}

function responseToJson(variable: ResponseVariable): unknown {
  const { identifier, choiceSequence, correctResponse, candidateResponse } = variable;
  return {
    identifier,
    ...typeToJson(variable),
    choiceSequence,
    correctResponse: correctResponse && {
      interpretation: correctResponse.interpretation,
      value: valueToJson(correctResponse.value),
    },
    candidateResponse: { value: valueToJson(candidateResponse) },
  };
}

function outcomeToJson(variable: OutcomeVariable): unknown {
  const { identifier, view, interpretation, longInterpretation, normalMaximum, normalMinimum, masteryValue, value } =
    variable;
  return {
    identifier,
    ...typeToJson(variable),
    view,
    interpretation,
    longInterpretation,
    normalMaximum,
    normalMinimum,
    masteryValue,
    value: valueToJson(value),
  };
}

function templateToJson(variable: TemplateVariable): unknown {
  return { identifier: variable.identifier, ...typeToJson(variable), value: valueToJson(variable.value) };
}

/** Returns the three lists of variables of a result in the binding. The binding has no context variables. */
function variablesToJson(variables: readonly ResultVariable[]): {
  readonly responseVariables: unknown[];
  readonly templateVariables: unknown[];
  readonly outcomeVariables: unknown[];
} {
  return {
    responseVariables: variables.flatMap((variable) =>
      variable.kind === "response" ? [responseToJson(variable)] : [],
    ),
    templateVariables: variables.flatMap((variable) =>
      variable.kind === "template" ? [templateToJson(variable)] : [],
    ),
    outcomeVariables: variables.flatMap((variable) => (variable.kind === "outcome" ? [outcomeToJson(variable)] : [])),
  };
}

function itemResultToJson(result: ItemResult): unknown {
  const { identifier, sequenceIndex, datestamp, sessionStatus, candidateComment } = result;
  return {
    identifier,
    sequenceIndex,
    datestamp,
    // The binding has no term for a result that waits for external scoring; the response is not yet processed.
    sessionStatus: BINDING_STATUSES.includes(sessionStatus) ? sessionStatus : "pendingResponseProcessing",
    ...variablesToJson(result.variables),
    candidateComment,
  };
}

function testResultToJson({ identifier, datestamp, variables }: TestResult): unknown {
  return { identifier, datestamp, ...variablesToJson(variables) };
}

function contextToJson({ sourcedId, sessionIdentifiers }: ResultContext): unknown {
  return {
    sourcedId,
    sessionIdentifiers: sessionIdentifiers.map(({ sourceId, identifier }) => ({ sourceID: sourceId, identifier })),
  };
}

/**
 * Returns an assessment result in the JSON of the CAT binding.
 *
 * @remarks
 * The JSON has `context`, `testResult` and the array `itemResult`, whose variables are sorted into `responseVariables`,
 * `templateVariables` and `outcomeVariables`. Values are in lexical form, NULL is the absence of a value, and the
 * binding leaves out context variables, supports, the score and answered status of a response, and the `externalScored`
 * and `variableIdentifierRef` of an outcome. `JSON.stringify` leaves out the properties that are `undefined`.
 *
 * @param result - The assessment result.
 * @returns The JSON object, ready for `JSON.stringify`.
 * @throws `DataError` when the result is not an object with a context and an array of item results, or a value is not
 * of its base type. see
 * {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, JSON binding of the assessment result}
 */
export function writeResultsJson(result: AssessmentResult): unknown {
  checkRecord(result, "The assessmentResult must be an object");
  checkRecord(result.context, "The context of the assessmentResult must be an object");
  checkArray(result.itemResults, "The itemResults of the assessmentResult must be an array");
  return {
    context: contextToJson(result.context),
    testResult: result.testResult && testResultToJson(result.testResult),
    itemResult: result.itemResults.map(itemResultToJson),
  };
}
