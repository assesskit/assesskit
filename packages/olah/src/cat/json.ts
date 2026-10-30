// biome-ignore-all lint/style/useNamingConvention: The names of the JSON fields are those of the binding.
import * as v from "valibot";
import {
  checkArray,
  checkRecord,
  describe,
  finiteSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  parseWith,
  type Schema,
  transformWith,
} from "../checks.js";
import { DataError } from "../errors.js";
import {
  type AssessmentResult,
  type ItemResult,
  OUTCOME_VIEWS,
  type OutcomeVariable,
  type ResponseVariable,
  type ResultContext,
  type ResultVariable,
  type ResultVariableType,
  SESSION_STATUSES,
  type SessionStatus,
  type TemplateVariable,
  type TestResult,
} from "../results/index.js";
import { baseTypeSchema } from "../values/base-type.js";
import { cardinalitySchema } from "../values/cardinality.js";
import {
  type BaseType,
  container,
  formatPrimitive,
  isBaseType,
  parsePrimitive,
  record,
  type SingleValue,
  single,
  type Value,
} from "../values/index.js";
import { itemStageSchema } from "./item-stage.js";
import type { ItemStage } from "./model.js";

// The JSON of the public binding of CAT 1.0 (https://www.imsglobal.org/spec/cat/v1p0/bind, §5 and Appendix B1.2). Its
// field names differ from olah's model in `sourceID`, `itemResult` and the three lists of variables of a result.

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
 * Returns an assessment result in the JSON of the CAT binding: `context`, `testResult` and the array `itemResult`, whose
 * variables are sorted into `responseVariables`, `templateVariables` and `outcomeVariables`. Values are in lexical form,
 * NULL is the absence of a value, and the binding leaves out context variables, supports, the score and answered status
 * of a response, and the `externalScored` and `variableIdentifierRef` of an outcome. `JSON.stringify` leaves out the
 * properties that are `undefined`.
 *
 * @throws `DataError` when the result is not an object with a context and an array of item results, or a value is not of
 * its base type.
 */
export function assessmentResultToJson(result: AssessmentResult): unknown {
  checkRecord(result, "The assessmentResult must be an object");
  checkRecord(result.context, "The context of the assessmentResult must be an object");
  checkArray(result.itemResults, "The itemResults of the assessmentResult must be an array");
  return {
    context: contextToJson(result.context),
    testResult: result.testResult && testResultToJson(result.testResult),
    itemResult: result.itemResults.map(itemResultToJson),
  };
}

/** One value of a variable in the binding, with the parts that a record's field uses. */
interface ValueEntry {
  readonly value: string;
  readonly fieldIdentifier?: unknown;
  readonly baseType?: unknown;
}

const valueEntriesSchema = v.optional(
  v.array(v.object({ value: v.string(), fieldIdentifier: v.optional(v.unknown()), baseType: v.optional(v.unknown()) })),
  [],
);

const typeEntries = { cardinality: cardinalitySchema, baseType: v.optional(baseTypeSchema) };

function typeOf({ cardinality, baseType }: ResultVariableType): ResultVariableType {
  return baseType === undefined ? { cardinality } : { cardinality, baseType };
}

function labelOf(kind: string, identifier: string): string {
  return `the ${kind} variable ${describe(identifier)}`;
}

function readField(label: string): (entry: ValueEntry) => readonly [string, SingleValue] {
  return ({ value: text, fieldIdentifier, baseType }) => {
    const name = parseWith(nonEmptyStringSchema, fieldIdentifier, `The fieldIdentifier of a field of ${label}`);
    if (!isBaseType(baseType)) {
      throw new DataError(`The baseType of a field of ${label} must be a base type, found ${describe(baseType)}.`);
    }
    const field = single(baseType, parsePrimitive(text, baseType));
    if (field === null) throw new DataError(`A field of ${label} cannot be an empty string, which is NULL.`);
    return [name, field];
  };
}

/** Reads the values of a variable, which the binding lists apart from its type, as a value or NULL. */
function readValue(
  entries: readonly ValueEntry[],
  { cardinality, baseType }: ResultVariableType,
  label: string,
): Value | null {
  if (cardinality === "record") return record(entries.map(readField(label)));
  if (baseType === undefined)
    throw new DataError(`The baseType of ${label} is required unless its cardinality is record.`);
  const primitives = entries.map(({ value: text }) => parsePrimitive(text, baseType));
  if (cardinality !== "single") return container(cardinality, baseType, primitives);
  const [only, ...more] = primitives;
  if (more.length > 0) throw new DataError(`${label} has the cardinality single and ${primitives.length} values.`);
  return only === undefined ? null : single(baseType, only);
}

const responseVariableSchema: Schema<ResponseVariable> = v.pipe(
  v.object({
    identifier: nonEmptyStringSchema,
    ...typeEntries,
    candidateResponse: v.object({ value: valueEntriesSchema }),
    correctResponse: v.optional(v.object({ value: valueEntriesSchema, interpretation: v.optional(v.string()) })),
    choiceSequence: v.optional(v.array(v.string())),
  }),
  transformWith((json): ResponseVariable => {
    const label = labelOf("response", json.identifier);
    const type = typeOf(json);
    const { correctResponse, choiceSequence } = json;
    const correct =
      correctResponse === undefined ? null : readValue(correctResponse.value, type, `the correct response of ${label}`);
    const { interpretation } = correctResponse ?? {};
    return {
      kind: "response",
      identifier: json.identifier,
      ...type,
      candidateResponse: readValue(json.candidateResponse.value, type, label),
      ...(correct === null
        ? {}
        : { correctResponse: { value: correct, ...(interpretation === undefined ? {} : { interpretation }) } }),
      ...(choiceSequence === undefined ? {} : { choiceSequence }),
      extensions: [],
    };
  }),
);

const optionalString = v.optional(v.string());
const optionalNumber = v.optional(finiteSchema);

const outcomeVariableSchema: Schema<OutcomeVariable> = v.pipe(
  v.object({
    identifier: nonEmptyStringSchema,
    ...typeEntries,
    value: valueEntriesSchema,
    view: v.optional(v.array(v.picklist(OUTCOME_VIEWS))),
    interpretation: optionalString,
    longInterpretation: optionalString,
    normalMaximum: optionalNumber,
    normalMinimum: optionalNumber,
    masteryValue: optionalNumber,
  }),
  transformWith((json): OutcomeVariable => {
    const type = typeOf(json);
    const { view, interpretation, longInterpretation, normalMaximum, normalMinimum, masteryValue } = json;
    return {
      kind: "outcome",
      identifier: json.identifier,
      ...type,
      value: readValue(json.value, type, labelOf("outcome", json.identifier)),
      ...(view === undefined ? {} : { view }),
      ...(interpretation === undefined ? {} : { interpretation }),
      ...(longInterpretation === undefined ? {} : { longInterpretation }),
      ...(normalMaximum === undefined ? {} : { normalMaximum }),
      ...(normalMinimum === undefined ? {} : { normalMinimum }),
      ...(masteryValue === undefined ? {} : { masteryValue }),
    };
  }),
);

const templateVariableSchema: Schema<TemplateVariable> = v.pipe(
  v.object({ identifier: nonEmptyStringSchema, ...typeEntries, value: valueEntriesSchema }),
  transformWith((json): TemplateVariable => {
    const type = typeOf(json);
    return {
      kind: "template",
      identifier: json.identifier,
      ...type,
      value: readValue(json.value, type, labelOf("template", json.identifier)),
    };
  }),
);

/** The three lists of variables of a result in the binding, each absent when empty. */
const variableLists = {
  responseVariables: v.optional(v.array(responseVariableSchema), []),
  templateVariables: v.optional(v.array(templateVariableSchema), []),
  outcomeVariables: v.optional(v.array(outcomeVariableSchema), []),
};

function joinVariables(lists: {
  readonly responseVariables: readonly ResultVariable[];
  readonly templateVariables: readonly ResultVariable[];
  readonly outcomeVariables: readonly ResultVariable[];
}): ResultVariable[] {
  return [...lists.responseVariables, ...lists.templateVariables, ...lists.outcomeVariables];
}

const itemResultSchema: Schema<ItemResult> = v.pipe(
  v.object({
    identifier: nonEmptyStringSchema,
    sequenceIndex: v.optional(nonNegativeIntegerSchema),
    datestamp: v.string(),
    sessionStatus: v.picklist(SESSION_STATUSES),
    candidateComment: optionalString,
    ...variableLists,
  }),
  v.transform(
    (json): ItemResult => ({
      identifier: json.identifier,
      ...(json.sequenceIndex === undefined ? {} : { sequenceIndex: json.sequenceIndex }),
      datestamp: json.datestamp,
      sessionStatus: json.sessionStatus,
      variables: joinVariables(json),
      ...(json.candidateComment === undefined ? {} : { candidateComment: json.candidateComment }),
      supports: [],
    }),
  ),
);

const testResultSchema: Schema<TestResult> = v.pipe(
  v.object({ identifier: nonEmptyStringSchema, datestamp: v.string(), ...variableLists }),
  v.transform(
    (json): TestResult => ({
      identifier: json.identifier,
      datestamp: json.datestamp,
      variables: joinVariables(json),
      supports: [],
    }),
  ),
);

const contextSchema: Schema<ResultContext> = v.pipe(
  v.object({
    sourcedId: optionalString,
    sessionIdentifiers: v.optional(v.array(v.object({ sourceID: v.string(), identifier: v.string() })), []),
  }),
  v.transform(({ sourcedId, sessionIdentifiers }) => ({
    ...(sourcedId === undefined ? {} : { sourcedId }),
    sessionIdentifiers: sessionIdentifiers.map(({ sourceID, identifier }) => ({ sourceId: sourceID, identifier })),
  })),
);

// An engine may leave out the context, which the model requires: the result then has no session identifiers (CAT §4.3.2).
const assessmentResultSchema: Schema<AssessmentResult> = v.pipe(
  v.object({
    context: v.optional(contextSchema, { sessionIdentifiers: [] }),
    testResult: v.optional(testResultSchema),
    itemResult: v.optional(v.array(itemResultSchema), []),
  }),
  v.transform(({ context, testResult, itemResult }) => ({
    context,
    ...(testResult === undefined ? {} : { testResult }),
    itemResults: itemResult,
  })),
);

/**
 * Reads an assessment result that a CAT engine returned in the JSON of the binding, with the three lists of variables of a
 * result joined in the order responses, templates, outcomes. An engine may leave out the context, which the model requires:
 * the result then has no session identifiers (CAT §4.3.2).
 *
 * @throws `DataError` when the JSON is not an assessment result of the binding, or a value is not in the lexical form of
 * its base type.
 */
export function assessmentResultFromJson(json: unknown): AssessmentResult {
  return parseWith(assessmentResultSchema, json, "The assessmentResult");
}

/**
 * Reads an item stage that a CAT engine returned: `itemIdentifiers` and `stageLength`, each of which may be absent or
 * `null`, as CAT §4.2 allows for a stage that ends the session.
 *
 * @param noun - Names the stage in the error message, such as `nextItems of the answer` for `The nextItems of the answer
 * must be an object`.
 * @throws `DataError` when it is not an item stage.
 */
export function itemStageFromJson(json: unknown, noun: string): ItemStage {
  return parseWith(itemStageSchema, json, `The ${noun}`);
}
