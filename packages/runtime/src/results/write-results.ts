import { checkArray, checkChoice, checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import {
  BASE_TYPES,
  type BaseType,
  CARDINALITIES,
  formatIdentifierList,
  formatPrimitive,
  isXsdDateTime,
  type Primitive,
} from "../values/index.js";
import { buildElement, serializeXml, type XmlElement } from "../xml/index.js";
import type {
  AssessmentResult,
  ContextVariable,
  ItemResult,
  OutcomeVariable,
  ResponseVariable,
  ResultContext,
  ResultCorrectResponse,
  ResultVariable,
  SessionIdentifier,
  SupportUse,
  TemplateVariable,
  TestResult,
} from "./model.js";
import { RESULTS_NAMESPACE, RESULTS_SCHEMA_LOCATION } from "./namespace.js";
import { type VariableType, valueElements, variableType } from "./value-elements.js";
import {
  ANSWERED_STATUSES,
  OUTCOME_SCORERS,
  OUTCOME_VIEWS,
  SCORE_STATUSES,
  SESSION_STATUSES,
  SUPPORT_ASSIGNMENTS,
} from "./vocabularies.js";

/** The name of the attribute that holds the system of a session identifier, spelled as the RR schema spells it. */
const SOURCE_ID = "sourceID";

type Attributes = Readonly<Record<string, string | undefined>>;

const element = (
  name: string,
  attributes: Attributes = {},
  children: readonly (XmlElement | string)[] = [],
): XmlElement => buildElement(RESULTS_NAMESPACE, name, attributes, children);

/** Writes a field of a base type, which `formatPrimitive` checks; a field that is absent is `undefined`. */
const optionalText = (value: Primitive | undefined, baseType: BaseType): string | undefined =>
  value === undefined ? undefined : formatPrimitive(value, baseType);

/** Applies a check to an optional field; `undefined` is absent and every other value, `null` included, is checked. */
function optional<T>(value: T | undefined, check: (value: T) => void): T | undefined {
  if (value !== undefined) check(value);
  return value;
}

function dateTimeText(value: unknown, label: string): string {
  checkString(value, label);
  if (!isXsdDateTime(value)) {
    throw new DataError(`${label} must be a date and time such as 2020-08-25T18:19:20, found ${describe(value)}.`);
  }
  return value;
}

function arrayOf<T>(value: readonly T[], label: string): readonly T[] {
  checkArray(value, `${label} must be an array`);
  return value;
}

/** Checks the elements that a schema wildcard lets a report carry: elements of another namespace than the report's. */
function extensionElements(value: readonly XmlElement[], label: string): readonly XmlElement[] {
  for (const extension of arrayOf(value, label)) {
    checkRecord(extension, `${label} must hold elements`);
    if (extension.kind !== "element" || extension.namespace === "" || extension.namespace === RESULTS_NAMESPACE) {
      throw new DataError(
        `${label} must hold elements of a namespace other than the report's, found ${describe(extension)}.`,
      );
    }
  }
  return value;
}

/** Checks the cardinality and base type of a variable; only a record may have no base type. */
function checkType(
  variable: { readonly cardinality: unknown; readonly baseType?: unknown },
  label: string,
): VariableType {
  const { cardinality, baseType } = variable;
  checkChoice(cardinality, `The cardinality of ${label}`, CARDINALITIES);
  if (baseType !== undefined) checkChoice(baseType, `The base type of ${label}`, BASE_TYPES);
  const type = variableType(cardinality, baseType);
  if (type === undefined) {
    throw new DataError(
      `The base type of ${label} is missing: only a variable of cardinality record may leave it out.`,
    );
  }
  return type;
}

function typeAttributes(type: VariableType): Attributes {
  return { cardinality: type.cardinality, baseType: type.baseType };
}

function writeSessionIdentifier(session: SessionIdentifier): XmlElement {
  checkRecord(session, "A session identifier must be an object");
  return element("sessionIdentifier", {
    [SOURCE_ID]: formatPrimitive(session.sourceId, "string"),
    identifier: formatPrimitive(session.identifier, "identifier"),
  });
}

function writeContext(context: ResultContext): XmlElement {
  checkRecord(context, "The context of a result must be an object");
  const sessions = arrayOf(context.sessionIdentifiers, "The sessionIdentifiers of the context");
  return element(
    "context",
    { sourcedId: optionalText(context.sourcedId, "identifier") },
    sessions.map(writeSessionIdentifier),
  );
}

function writeSupport(support: SupportUse): XmlElement {
  checkRecord(support, "A support must be an object");
  checkChoice(support.assignment, "The assignment of a support", SUPPORT_ASSIGNMENTS);
  return element("support", {
    name: formatPrimitive(support.name, "identifier"),
    assignment: support.assignment,
    value: optionalText(support.value, "string"),
    "xml:lang": optionalText(support.language, "string"),
  });
}

function writeCorrectResponse(correct: ResultCorrectResponse, type: VariableType, label: string): XmlElement {
  checkRecord(correct, `The correct response of ${label} must be an object`);
  if (correct.value === null || correct.value === undefined) {
    throw new DataError(`The correct response of ${label} needs a value; it is never NULL.`);
  }
  const values = valueElements(correct.value, type, `The correct response of ${label}`);
  return element("correctResponse", { interpretation: optionalText(correct.interpretation, "string") }, values);
}

function writeResponseVariable(variable: ResponseVariable): XmlElement {
  const label = `the response variable ${describe(variable.identifier)}`;
  const type = checkType(variable, label);
  const { choiceSequence, scoreStatus, answeredStatus, correctResponse } = variable;
  optional(scoreStatus, (term) => checkChoice(term, `The scoreStatus of ${label}`, SCORE_STATUSES));
  optional(answeredStatus, (term) => checkChoice(term, `The answeredStatus of ${label}`, ANSWERED_STATUSES));
  const correct = correctResponse === undefined ? [] : [writeCorrectResponse(correctResponse, type, label)];
  const candidate = element(
    "candidateResponse",
    {},
    valueElements(variable.candidateResponse, type, `The candidate response of ${label}`),
  );
  const attributes = {
    identifier: formatPrimitive(variable.identifier, "identifier"),
    ...typeAttributes(type),
    choiceSequence: choiceSequence === undefined ? undefined : formatIdentifierList(choiceSequence),
    scoreStatus,
    answeredStatus,
  };
  return element("responseVariable", attributes, [
    ...correct,
    candidate,
    ...extensionElements(variable.extensions, `The extensions of ${label}`),
  ]);
}

function viewAttribute(view: OutcomeVariable["view"], label: string): string | undefined {
  if (view === undefined) return undefined;
  for (const term of arrayOf(view, `The view of ${label}`)) checkChoice(term, `A view of ${label}`, OUTCOME_VIEWS);
  return view.join(" ");
}

function writeOutcomeVariable(variable: OutcomeVariable): XmlElement {
  const label = `the outcome variable ${describe(variable.identifier)}`;
  const type = checkType(variable, label);
  const { externalScored, outcomeInformation } = variable;
  optional(externalScored, (term) => checkChoice(term, `The externalScored of ${label}`, OUTCOME_SCORERS));
  const information =
    outcomeInformation === undefined
      ? []
      : [
          element(
            "outcomeInformation",
            {},
            extensionElements(outcomeInformation, `The outcomeInformation of ${label}`),
          ),
        ];
  const attributes = {
    identifier: formatPrimitive(variable.identifier, "identifier"),
    ...typeAttributes(type),
    view: viewAttribute(variable.view, label),
    interpretation: optionalText(variable.interpretation, "string"),
    longInterpretation: optionalText(variable.longInterpretation, "uri"),
    normalMaximum: optionalText(variable.normalMaximum, "float"),
    normalMinimum: optionalText(variable.normalMinimum, "float"),
    masteryValue: optionalText(variable.masteryValue, "float"),
    "external-scored": externalScored,
    "variable-identifier-ref": optionalText(variable.variableIdentifierRef, "identifier"),
  };
  return element("outcomeVariable", attributes, [
    ...valueElements(variable.value, type, `The value of ${label}`),
    ...information,
  ]);
}

function writeValuedVariable(variable: TemplateVariable | ContextVariable): XmlElement {
  const label = `the ${variable.kind} variable ${describe(variable.identifier)}`;
  const type = checkType(variable, label);
  const attributes = { identifier: formatPrimitive(variable.identifier, "identifier"), ...typeAttributes(type) };
  return element(`${variable.kind}Variable`, attributes, valueElements(variable.value, type, `The value of ${label}`));
}

function writeVariable(variable: ResultVariable): XmlElement {
  checkRecord(variable, "A variable must be an object");
  switch (variable.kind) {
    case "response":
      return writeResponseVariable(variable);
    case "outcome":
      return writeOutcomeVariable(variable);
    case "template":
    case "context":
      return writeValuedVariable(variable);
    default:
      throw new DataError(
        `The kind of a variable must be "response", "outcome", "template" or "context", found ${describe(Reflect.get(variable, "kind"))}.`,
      );
  }
}

function writeTestResult(result: TestResult): XmlElement {
  checkRecord(result, "The test result must be an object");
  const variables = arrayOf(result.variables, "The variables of the test result").map(writeVariable);
  const supports = arrayOf(result.supports, "The supports of the test result").map(writeSupport);
  const attributes = {
    identifier: formatPrimitive(result.identifier, "identifier"),
    datestamp: dateTimeText(result.datestamp, "The datestamp of the test result"),
  };
  return element("testResult", attributes, [...variables, ...supports]);
}

function writeItemResult(result: ItemResult): XmlElement {
  checkRecord(result, "An item result must be an object");
  const label = `the item result ${describe(result.identifier)}`;
  checkChoice(result.sessionStatus, `The sessionStatus of ${label}`, SESSION_STATUSES);
  const variables = arrayOf(result.variables, `The variables of ${label}`).map(writeVariable);
  const comment = optionalText(result.candidateComment, "string");
  const supports = arrayOf(result.supports, `The supports of ${label}`).map(writeSupport);
  const attributes = {
    identifier: formatPrimitive(result.identifier, "identifier"),
    sequenceIndex: optionalText(result.sequenceIndex, "integer"),
    datestamp: dateTimeText(result.datestamp, `The datestamp of ${label}`),
    sessionStatus: result.sessionStatus,
  };
  const commentElements = comment === undefined ? [] : [element("candidateComment", {}, [comment])];
  return element("itemResult", attributes, [...variables, ...commentElements, ...supports]);
}

/**
 * Writes a Results Reporting document in UTF-8, valid against the RR schema, which names it in `xsi:schemaLocation`.
 *
 * @remarks
 * The `context` is always written, empty when nothing is known, because the schema requires it. A `file` value is
 * written as its reference alone, a duration as seconds, and a NULL as a variable without `value` elements. Text is
 * written as given: the schema types a `value` as `xs:normalizedString`, so a consumer that applies the schema reads a
 * newline in an essay as a space.
 *
 * @param result - The result to write; it is checked deeply.
 * @returns The document.
 * @throws `DataError` when the model is not a result: a field of the wrong type, an identifier that is not one, a date that
 * is not an `xs:dateTime`, a value that is not of the type its variable declares, a term outside its vocabulary, or text
 * with a character that XML 1.0 does not allow.
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function writeResults(result: AssessmentResult): string {
  checkRecord(result, "The result must be an object");
  const context = writeContext(result.context);
  const test = result.testResult === undefined ? [] : [writeTestResult(result.testResult)];
  const items = arrayOf(result.itemResults, "The itemResults of the result").map(writeItemResult);
  const attributes = { "xsi:schemaLocation": `${RESULTS_NAMESPACE} ${RESULTS_SCHEMA_LOCATION}` };
  return serializeXml(element("assessmentResult", attributes, [context, ...test, ...items]));
}
