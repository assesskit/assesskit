// biome-ignore-all lint/style/useNamingConvention: The names of the JSON fields are those of the binding.
import * as v from "valibot";
import {
  describe,
  finiteSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  parseWith,
  recordSchema,
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
  type TemplateVariable,
  type TestResult,
} from "../results/index.js";
import {
  container,
  isBaseType,
  parsePrimitive,
  record,
  type SingleValue,
  single,
  type Value,
} from "../values/index.js";
import { baseTypeSchema, cardinalitySchema } from "../values/internal.js";

// The field names of the public binding differ from the runtime's model in `sourceID`, `itemResult` and the three lists
// of variables of a result.

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
  recordSchema,
  v.object({
    sourcedId: optionalString,
    sessionIdentifiers: v.optional(v.array(v.object({ sourceID: v.string(), identifier: v.string() })), []),
  }),
  v.transform(({ sourcedId, sessionIdentifiers }) => ({
    ...(sourcedId === undefined ? {} : { sourcedId }),
    sessionIdentifiers: sessionIdentifiers.map(({ sourceID, identifier }) => ({ sourceId: sourceID, identifier })),
  })),
);

// An engine may leave out the context, which the model requires: the result then has no session identifiers.
const assessmentResultSchema: Schema<AssessmentResult> = v.pipe(
  recordSchema,
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
 * Reads an assessment result that a CAT engine returned in the JSON of the binding.
 *
 * @remarks
 * The three lists of variables of a result are joined in the order responses, templates, outcomes. An engine may leave
 * out the context, which the model requires: the result then has no session identifiers.
 *
 * @param json - The parsed JSON, which is untrusted.
 * @returns The assessment result.
 * @throws `DataError` when the JSON is not an assessment result of the binding, or a value is not in the lexical form
 * of its base type. see
 * {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0, JSON binding of the assessment result}
 */
export function assessmentResultFromJson(json: unknown): AssessmentResult {
  return parseWith(assessmentResultSchema, json, "The assessmentResult");
}
