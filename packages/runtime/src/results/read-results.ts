import { checkChoice } from "../checks.js";
import { DataError } from "../errors.js";
import { BASE_TYPES, CARDINALITIES, isXsdDateTime, parseIdentifierList, parsePrimitive } from "../values/index.js";
import type { XmlElement } from "../xml/index.js";
import { ElementReader, type ReaderRules } from "../xml/internal.js";
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
import { RESULTS_NAMESPACE } from "./namespace.js";
import { readValue, type VariableType, variableType } from "./value-elements.js";
import {
  ANSWERED_STATUSES,
  OUTCOME_SCORERS,
  OUTCOME_VIEWS,
  type OutcomeView,
  SCORE_STATUSES,
  SESSION_STATUSES,
  SUPPORT_ASSIGNMENTS,
} from "./vocabularies.js";

const RULES: ReaderRules = { module: "results", namespaces: [RESULTS_NAMESPACE] };

/** The names of the elements that report variables, in the order of the schema's choice. */
const VARIABLE_ELEMENTS = ["responseVariable", "templateVariable", "outcomeVariable", "contextVariable"];

const toIdentifier = (text: string): string => parsePrimitive(text, "identifier");
const toInteger = (text: string): number => parsePrimitive(text, "integer");
const toDouble = (text: string): number => parsePrimitive(text, "float");

/** Reads an `xs:dateTime`, whose white space is collapsed. */
function toDateTime(text: string): string {
  const collapsed = text.trim();
  if (!isXsdDateTime(collapsed)) {
    throw new DataError(`The text ${JSON.stringify(text)} is not a date and time such as 2020-08-25T18:19:20.`);
  }
  return collapsed;
}

function toViews(text: string): OutcomeView[] {
  return parseIdentifierList(text).map((view): OutcomeView => {
    checkChoice(view, "A view", OUTCOME_VIEWS);
    return view;
  });
}

/** Reads an element that contains text only. */
function readText(reader: ElementReader): string {
  const text = reader.text();
  reader.done();
  return text;
}

/** Reads the cardinality and base type of a variable; only a record may leave out the base type. */
function readType(reader: ElementReader): VariableType {
  const type = variableType(reader.requiredTerm("cardinality", CARDINALITIES), reader.term("baseType", BASE_TYPES));
  if (type === undefined) {
    const message = `The element ${reader.name} needs the attribute baseType, which only a variable of cardinality record may leave out.`;
    throw reader.fail("missing-attribute", message);
  }
  return type;
}

function readSessionIdentifier(reader: ElementReader): SessionIdentifier {
  const sourceId = reader.required("sourceID");
  const identifier = reader.required("identifier", toIdentifier);
  reader.done();
  return { sourceId, identifier };
}

function readContext(reader: ElementReader): ResultContext {
  const sourcedId = reader.attribute("sourcedId", toIdentifier);
  const sessionIdentifiers = reader.takeAll("sessionIdentifier").map(readSessionIdentifier);
  reader.done();
  return { ...(sourcedId !== undefined && { sourcedId }), sessionIdentifiers };
}

function readSupport(reader: ElementReader): SupportUse {
  const name = reader.required("name", toIdentifier);
  const assignment = reader.requiredTerm("assignment", SUPPORT_ASSIGNMENTS);
  const value = reader.attribute("value");
  const language = reader.language();
  reader.done();
  return { name, assignment, ...(value !== undefined && { value }), ...(language !== undefined && { language }) };
}

function readCorrectResponse(reader: ElementReader, type: VariableType): ResultCorrectResponse {
  const interpretation = reader.attribute("interpretation");
  const elements = reader.takeAll("value");
  if (elements.length === 0) throw reader.fail("missing-element", "The element correctResponse needs a value.");
  reader.done();
  const value = readValue(reader, elements, type);
  if (value === null) throw reader.fail("invalid-value", "The correct response of a variable is never NULL.");
  return { ...(interpretation !== undefined && { interpretation }), value };
}

function readResponseVariable(reader: ElementReader): ResponseVariable {
  const identifier = reader.required("identifier", toIdentifier);
  const type = readType(reader);
  const choiceSequence = reader.attribute("choiceSequence", parseIdentifierList);
  const scoreStatus = reader.term("scoreStatus", SCORE_STATUSES);
  const answeredStatus = reader.term("answeredStatus", ANSWERED_STATUSES);
  const correct = reader.take("correctResponse");
  const correctResponse = correct === undefined ? undefined : readCorrectResponse(correct, type);
  const candidate = reader.require("candidateResponse");
  const elements = candidate.takeAll("value");
  candidate.done();
  const candidateResponse = readValue(candidate, elements, type);
  const extensions = reader.takeForeign();
  reader.done();
  return {
    kind: "response",
    identifier,
    ...type,
    ...(correctResponse !== undefined && { correctResponse }),
    candidateResponse,
    ...(choiceSequence !== undefined && { choiceSequence }),
    ...(scoreStatus !== undefined && { scoreStatus }),
    ...(answeredStatus !== undefined && { answeredStatus }),
    extensions,
  };
}

function readOutcomeVariable(reader: ElementReader): OutcomeVariable {
  const identifier = reader.required("identifier", toIdentifier);
  const type = readType(reader);
  const view = reader.attribute("view", toViews);
  const interpretation = reader.attribute("interpretation");
  const longInterpretation = reader.attribute("longInterpretation");
  const normalMaximum = reader.attribute("normalMaximum", toDouble);
  const normalMinimum = reader.attribute("normalMinimum", toDouble);
  const masteryValue = reader.attribute("masteryValue", toDouble);
  const externalScored = reader.term("external-scored", OUTCOME_SCORERS);
  const variableIdentifierRef = reader.attribute("variable-identifier-ref", toIdentifier);
  const value = readValue(reader, reader.takeAll("value"), type);
  const information = reader.take("outcomeInformation");
  const outcomeInformation = information?.takeForeign();
  information?.done();
  reader.done();
  return {
    kind: "outcome",
    identifier,
    ...type,
    value,
    ...(view !== undefined && { view }),
    ...(interpretation !== undefined && { interpretation }),
    ...(longInterpretation !== undefined && { longInterpretation }),
    ...(normalMaximum !== undefined && { normalMaximum }),
    ...(normalMinimum !== undefined && { normalMinimum }),
    ...(masteryValue !== undefined && { masteryValue }),
    ...(externalScored !== undefined && { externalScored }),
    ...(variableIdentifierRef !== undefined && { variableIdentifierRef }),
    ...(outcomeInformation !== undefined && { outcomeInformation }),
  };
}

function readValuedVariable(reader: ElementReader, kind: "template"): TemplateVariable;
function readValuedVariable(reader: ElementReader, kind: "context"): ContextVariable;
function readValuedVariable(reader: ElementReader, kind: "template" | "context"): TemplateVariable | ContextVariable {
  const identifier = reader.required("identifier", toIdentifier);
  const type = readType(reader);
  const value = readValue(reader, reader.takeAll("value"), type);
  reader.done();
  return { kind, identifier, ...type, value };
}

function readVariable(reader: ElementReader): ResultVariable {
  switch (reader.name) {
    case "responseVariable":
      return readResponseVariable(reader);
    case "outcomeVariable":
      return readOutcomeVariable(reader);
    case "templateVariable":
      return readValuedVariable(reader, "template");
    default:
      return readValuedVariable(reader, "context");
  }
}

/** Reads the variables of a result, which the schema lets come in any order and mix. */
function readVariables(reader: ElementReader): ResultVariable[] {
  const variables: ResultVariable[] = [];
  for (let child = reader.takeAny(VARIABLE_ELEMENTS); child !== undefined; child = reader.takeAny(VARIABLE_ELEMENTS)) {
    variables.push(readVariable(child));
  }
  return variables;
}

function readTestResult(reader: ElementReader): TestResult {
  const identifier = reader.required("identifier", toIdentifier);
  const datestamp = reader.required("datestamp", toDateTime);
  const variables = readVariables(reader);
  const supports = reader.takeAll("support").map(readSupport);
  reader.done();
  return { identifier, datestamp, variables, supports };
}

function readItemResult(reader: ElementReader): ItemResult {
  const identifier = reader.required("identifier", toIdentifier);
  const sequenceIndex = reader.attribute("sequenceIndex", toInteger);
  const datestamp = reader.required("datestamp", toDateTime);
  const sessionStatus = reader.requiredTerm("sessionStatus", SESSION_STATUSES);
  const variables = readVariables(reader);
  const comment = reader.take("candidateComment");
  const candidateComment = comment === undefined ? undefined : readText(comment);
  const supports = reader.takeAll("support").map(readSupport);
  reader.done();
  return {
    identifier,
    ...(sequenceIndex !== undefined && { sequenceIndex }),
    datestamp,
    sessionStatus,
    variables,
    ...(candidateComment !== undefined && { candidateComment }),
    supports,
  };
}

/**
 * Reads a Results Reporting document into a model.
 *
 * @remarks
 * A `file` value becomes a reference with the content type `application/octet-stream`, because the XML form of a file is
 * its reference alone. A duration is read as seconds, or as an ISO 8601 duration without years and months, which
 * 1EdTech's own example writes. Elements in other namespaces are kept only where the schema allows them: after the
 * candidate response of a response variable and in `outcomeInformation`.
 *
 * @param input - The document as text or bytes, or the root element of a parsed document.
 * @returns The result; every optional field the document leaves out is absent.
 * @throws `DataError` when `input` is none of these.
 * @throws `ReadError` when the document is not well-formed, the root is not `assessmentResult` of the RR namespace, or the
 * document cannot be mapped to the model: a missing, unknown or misplaced element or attribute, a value that is not of the
 * variable's type, an `xs:integer` beyond the safe integers, or a date that is not an `xs:dateTime`.
 * @throws `SecurityError` when the text or bytes break a limit of `parseXml`.
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function readResults(input: string | Uint8Array | XmlElement): AssessmentResult {
  const reader = ElementReader.open(input, RULES, "The results");
  if (reader.foreign || reader.name !== "assessmentResult") {
    const message = `The root element must be assessmentResult in the namespace ${RESULTS_NAMESPACE}, found ${reader.qualifiedName}.`;
    throw reader.fail("not-results", message);
  }
  const context = readContext(reader.require("context"));
  const test = reader.take("testResult");
  const testResult = test === undefined ? undefined : readTestResult(test);
  const itemResults = reader.takeAll("itemResult").map(readItemResult);
  reader.done();
  return { context, ...(testResult !== undefined && { testResult }), itemResults };
}
