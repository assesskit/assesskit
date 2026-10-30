// biome-ignore-all lint/style/useNamingConvention: The names of the JSON fields are those of the binding.
import type { ItemStage } from "@luthfanwakan/olah/cat";
import {
  type AssessmentResult,
  type ItemResult,
  OUTCOME_VIEWS,
  type OutcomeVariable,
  type OutcomeView,
  type ResponseVariable,
  type ResultContext,
  type ResultVariable,
  type ResultVariableType,
  SESSION_STATUSES,
  type SessionStatus,
  type TemplateVariable,
  type TestResult,
} from "@luthfanwakan/olah/results";
import {
  type BaseType,
  container,
  formatPrimitive,
  isBaseType,
  isCardinality,
  parsePrimitive,
  record,
  type SingleValue,
  single,
  type Value,
} from "@luthfanwakan/olah/values";
import {
  checkArray,
  checkNonEmptyString,
  checkNonNegativeInteger,
  checkRecord,
  checkString,
  describe,
} from "../checks.js";
import { DataError } from "../errors.js";

// The REST/JSON binding of CAT 1.0 (https://www.imsglobal.org/spec/cat/v1p0/bind, §5 and Appendix B). Its field names
// differ from olah's model in `sourceID`, `itemResult` and the three lists of variables of a result.

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

type Json = Readonly<Record<string, unknown>>;

/** One value of a variable in the binding, with the parts that a record's field uses. */
interface ValueEntry {
  readonly text: string;
  readonly fieldIdentifier: unknown;
  readonly baseType: unknown;
}

function readEntries(entries: unknown, label: string): ValueEntry[] {
  const list = entries === undefined ? [] : entries;
  checkArray(list, `The value of ${label} must be an array`);
  return list.map((entry) => {
    checkRecord(entry, `A value of ${label} must be an object`);
    checkString(entry.value, `A value of ${label}`);
    return { text: entry.value, fieldIdentifier: entry.fieldIdentifier, baseType: entry.baseType };
  });
}

function readField(label: string): (entry: ValueEntry) => readonly [string, SingleValue] {
  return ({ text, fieldIdentifier, baseType }) => {
    checkNonEmptyString(fieldIdentifier, `The fieldIdentifier of a field of ${label}`);
    if (!isBaseType(baseType)) {
      throw new DataError(`The baseType of a field of ${label} must be a base type, found ${describe(baseType)}.`);
    }
    const field = single(baseType, parsePrimitive(text, baseType));
    if (field === null) throw new DataError(`A field of ${label} cannot be an empty string, which is NULL.`);
    return [fieldIdentifier, field];
  };
}

/** Reads the values of a variable, which the binding lists apart from its type, as a value or NULL. */
function readValue(entries: unknown, { cardinality, baseType }: ResultVariableType, label: string): Value | null {
  const list = readEntries(entries, label);
  if (cardinality === "record") return record(list.map(readField(label)));
  if (baseType === undefined)
    throw new DataError(`The baseType of ${label} is required unless its cardinality is record.`);
  const primitives = list.map(({ text }) => parsePrimitive(text, baseType));
  if (cardinality !== "single") return container(cardinality, baseType, primitives);
  const [only, ...more] = primitives;
  if (more.length > 0) throw new DataError(`${label} has the cardinality single and ${primitives.length} values.`);
  return only === undefined ? null : single(baseType, only);
}

function readType(json: Json, label: string): ResultVariableType {
  const { cardinality, baseType } = json;
  if (!isCardinality(cardinality)) {
    throw new DataError(
      `The cardinality of ${label} must be single, multiple, ordered or record, found ${describe(cardinality)}.`,
    );
  }
  if (baseType === undefined) return { cardinality };
  if (!isBaseType(baseType))
    throw new DataError(`The baseType of ${label} must be a base type, found ${describe(baseType)}.`);
  return { cardinality, baseType };
}

/** Checks that the value is a variable and returns it with the words that name it in messages. */
function readVariable(json: unknown, kind: string): { readonly variable: Json; readonly label: string } {
  checkRecord(json, `The ${kind} variables must be objects`);
  checkNonEmptyString(json.identifier, `The identifier of every ${kind} variable`);
  return { variable: json, label: `the ${kind} variable ${describe(json.identifier)}` };
}

function readStrings(value: unknown, label: string, itemLabel: string): string[] {
  checkArray(value, `${label} must be an array`);
  return value.map((item) => {
    checkString(item, itemLabel);
    return item;
  });
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value !== undefined) checkString(value, label);
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value !== undefined && !(typeof value === "number" && Number.isFinite(value))) {
    throw new DataError(`${label} must be a number, found ${describe(value)}.`);
  }
  return value;
}

function readResponseVariable(json: unknown): ResponseVariable {
  const { variable, label } = readVariable(json, "response");
  const type = readType(variable, label);
  checkRecord(variable.candidateResponse, `The candidateResponse of ${label} must be an object`);
  const { choiceSequence, correctResponse } = variable;
  const correct = correctResponse === undefined ? null : readCorrectResponse(correctResponse, type, label);
  return {
    kind: "response",
    identifier: String(variable.identifier),
    ...type,
    candidateResponse: readValue(variable.candidateResponse.value, type, label),
    ...(correct === null ? {} : { correctResponse: correct }),
    ...(choiceSequence === undefined
      ? {}
      : { choiceSequence: readStrings(choiceSequence, `The choiceSequence of ${label}`, `A choice of ${label}`) }),
    extensions: [],
  };
}

function readCorrectResponse(
  json: unknown,
  type: ResultVariableType,
  label: string,
): ResponseVariable["correctResponse"] | null {
  checkRecord(json, `The correctResponse of ${label} must be an object`);
  const value = readValue(json.value, type, `the correct response of ${label}`);
  const interpretation = optionalString(json.interpretation, `The interpretation of the correct response of ${label}`);
  return value === null ? null : { value, ...(interpretation === undefined ? {} : { interpretation }) };
}

function isOutcomeView(value: unknown): value is OutcomeView {
  return OUTCOME_VIEWS.some((view) => view === value);
}

function readViews(value: unknown, label: string): OutcomeView[] {
  checkArray(value, `The view of ${label} must be an array`);
  return value.map((term) => {
    if (!isOutcomeView(term)) {
      throw new DataError(`A view of ${label} must be one of ${OUTCOME_VIEWS.join(", ")}, found ${describe(term)}.`);
    }
    return term;
  });
}

function readOutcomeVariable(json: unknown): OutcomeVariable {
  const { variable, label } = readVariable(json, "outcome");
  const type = readType(variable, label);
  const interpretation = optionalString(variable.interpretation, `The interpretation of ${label}`);
  const longInterpretation = optionalString(variable.longInterpretation, `The longInterpretation of ${label}`);
  const normalMaximum = optionalNumber(variable.normalMaximum, `The normalMaximum of ${label}`);
  const normalMinimum = optionalNumber(variable.normalMinimum, `The normalMinimum of ${label}`);
  const masteryValue = optionalNumber(variable.masteryValue, `The masteryValue of ${label}`);
  return {
    kind: "outcome",
    identifier: String(variable.identifier),
    ...type,
    value: readValue(variable.value, type, label),
    ...(variable.view === undefined ? {} : { view: readViews(variable.view, label) }),
    ...(interpretation === undefined ? {} : { interpretation }),
    ...(longInterpretation === undefined ? {} : { longInterpretation }),
    ...(normalMaximum === undefined ? {} : { normalMaximum }),
    ...(normalMinimum === undefined ? {} : { normalMinimum }),
    ...(masteryValue === undefined ? {} : { masteryValue }),
  };
}

function readTemplateVariable(json: unknown): TemplateVariable {
  const { variable, label } = readVariable(json, "template");
  const type = readType(variable, label);
  return {
    kind: "template",
    identifier: String(variable.identifier),
    ...type,
    value: readValue(variable.value, type, label),
  };
}

function readList<T>(json: Json, name: string, read: (item: unknown) => T): T[] {
  const list = json[name] === undefined ? [] : json[name];
  checkArray(list, `The ${name} of a result must be an array`);
  return list.map(read);
}

function readVariables(json: Json): ResultVariable[] {
  return [
    ...readList(json, "responseVariables", readResponseVariable),
    ...readList(json, "templateVariables", readTemplateVariable),
    ...readList(json, "outcomeVariables", readOutcomeVariable),
  ];
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return SESSION_STATUSES.some((status) => status === value);
}

function readItemResult(json: unknown): ItemResult {
  checkRecord(json, "An itemResult must be an object");
  const { identifier, sequenceIndex, datestamp, sessionStatus, candidateComment } = json;
  checkNonEmptyString(identifier, "The identifier of an itemResult");
  checkString(datestamp, "The datestamp of an itemResult");
  if (!isSessionStatus(sessionStatus)) {
    throw new DataError(
      `The sessionStatus of an itemResult must be one of ${SESSION_STATUSES.join(", ")}, found ${describe(sessionStatus)}.`,
    );
  }
  const comment = optionalString(candidateComment, "The candidateComment of an itemResult");
  return {
    identifier,
    ...(sequenceIndex === undefined ? {} : { sequenceIndex: readIndex(sequenceIndex) }),
    datestamp,
    sessionStatus,
    variables: readVariables(json),
    ...(comment === undefined ? {} : { candidateComment: comment }),
    supports: [],
  };
}

function readIndex(value: unknown): number {
  checkNonNegativeInteger(value, "The sequenceIndex of an itemResult");
  return value;
}

function readTestResult(json: unknown): TestResult {
  checkRecord(json, "The testResult must be an object");
  checkNonEmptyString(json.identifier, "The identifier of the testResult");
  checkString(json.datestamp, "The datestamp of the testResult");
  return { identifier: json.identifier, datestamp: json.datestamp, variables: readVariables(json), supports: [] };
}

function readContext(json: unknown): ResultContext {
  checkRecord(json, "The context must be an object");
  const sourcedId = optionalString(json.sourcedId, "The sourcedId of the context");
  const identifiers = json.sessionIdentifiers === undefined ? [] : json.sessionIdentifiers;
  checkArray(identifiers, "The sessionIdentifiers of the context must be an array");
  return {
    ...(sourcedId === undefined ? {} : { sourcedId }),
    sessionIdentifiers: identifiers.map((entry) => {
      checkRecord(entry, "A session identifier of the context must be an object");
      checkString(entry.sourceID, "The sourceID of a session identifier");
      checkString(entry.identifier, "The identifier of a session identifier");
      return { sourceId: entry.sourceID, identifier: entry.identifier };
    }),
  };
}

/**
 * Reads an assessment result that a CAT engine returned in the JSON of the binding, with the three lists of variables of a
 * result joined in the order responses, templates, outcomes. An engine may leave out the context, which the model requires:
 * the result then has no session identifiers (CAT §4.3.2).
 *
 * @throws `DataError` when the JSON is not an assessment result of the binding, or a value is not in the lexical form of
 * its base type.
 */
export function assessmentResultFromJson(json: unknown): AssessmentResult {
  checkRecord(json, "The assessmentResult must be an object");
  const { context, testResult } = json;
  return {
    context: context === undefined ? { sessionIdentifiers: [] } : readContext(context),
    ...(testResult === undefined ? {} : { testResult: readTestResult(testResult) }),
    itemResults: readList(json, "itemResult", readItemResult),
  };
}

/**
 * Reads an item stage that a CAT engine returned: `itemIdentifiers` and `stageLength`, each of which may be absent or
 * `null`, as CAT §4.2 allows for a stage that ends the session.
 *
 * @param noun - Names the stage in the error message, such as `nextItems of the answer` for `The nextItems of the answer must
 * be an object`.
 * @throws `DataError` when it is not an item stage.
 */
export function readStage(json: unknown, noun: string): ItemStage {
  checkRecord(json, `The ${noun} must be an object`);
  const { itemIdentifiers = null, stageLength = null } = json;
  if (stageLength !== null) checkNonNegativeInteger(stageLength, `The stageLength of the ${noun}`);
  return {
    itemIdentifiers:
      itemIdentifiers === null
        ? null
        : readStrings(itemIdentifiers, `The itemIdentifiers of the ${noun}`, `An item identifier of the ${noun}`),
    stageLength,
  };
}
