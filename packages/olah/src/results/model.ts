import type { BaseType, Cardinality, Value } from "../values/index.js";
import type { XmlElement } from "../xml/index.js";
import type {
  AnsweredStatus,
  OutcomeScorer,
  OutcomeView,
  ScoreStatus,
  SessionStatus,
  SupportAssignment,
} from "./vocabularies.js";

/** A session of the delivery system that produced the report (RR §2.6.3). */
export interface SessionIdentifier {
  /** The system that issued the identifier, as a URI. */
  readonly sourceId: string;
  /** The identifier of the session in that system. */
  readonly identifier: string;
}

/** What a report says about who took the assessment and in which sessions (RR §2.4.2). */
export interface ResultContext {
  /** The identifier of the candidate in the system of record. */
  readonly sourcedId?: string;
  /** The sessions of the delivery system. */
  readonly sessionIdentifiers: readonly SessionIdentifier[];
}

/** A support the candidate used (RR §2.6.4). */
export interface SupportUse {
  /** The name of the support, such as `spoken`: an `NCName`, so a custom support has no `ext:` prefix here. */
  readonly name: string;
  /** How the candidate came to use it. */
  readonly assignment: SupportAssignment;
  /** The setting of the support, free text. */
  readonly value?: string;
  /** The language of the support (`xml:lang`). */
  readonly language?: string;
}

/**
 * The type of a variable. A record has no base type, because each of its fields has its own; a base type given for
 * one is kept as it is.
 */
export interface ResultVariableType {
  /** The cardinality, taken from the declaration. */
  readonly cardinality: Cardinality;
  /** The base type, taken from the declaration; required unless the cardinality is `record` (RR §2.4.3). */
  readonly baseType?: BaseType;
}

/** The value a response variable should have (RR §2.4.4). */
export interface ResultCorrectResponse {
  /** What the correct response means, free text. */
  readonly interpretation?: string;
  /** The correct response; it is never NULL. */
  readonly value: Value;
}

/** A response variable of an item or a test (RR §2.4.8). */
export interface ResponseVariable extends ResultVariableType {
  /** Tells the four kinds of variable apart. */
  readonly kind: "response";
  /** The identifier of the variable; built-in ones are `numAttempts` and `duration`. */
  readonly identifier: string;
  /** The correct response, when the report discloses it. */
  readonly correctResponse?: ResultCorrectResponse;
  /** The candidate's last submitted response, or NULL (RR §2.4.1). */
  readonly candidateResponse: Value | null;
  /** The order in which the candidate saw the choices (RR §2.4.8). */
  readonly choiceSequence?: readonly string[];
  /** Whether the response is scored. */
  readonly scoreStatus?: ScoreStatus;
  /** Whether the candidate answered. */
  readonly answeredStatus?: AnsweredStatus;
  /** Elements in other namespaces after the candidate response, kept as they are. */
  readonly extensions: readonly XmlElement[];
}

/** An outcome variable of an item or a test (RR §2.4.7). */
export interface OutcomeVariable extends ResultVariableType {
  /** Tells the four kinds of variable apart. */
  readonly kind: "outcome";
  /** The identifier of the variable, such as `SCORE`. */
  readonly identifier: string;
  /** The value, or NULL. */
  readonly value: Value | null;
  /** Who the outcome is for, from the declaration. */
  readonly view?: readonly OutcomeView[];
  /** What the outcome means, free text. */
  readonly interpretation?: string;
  /** A URI that points to a longer description of the outcome. */
  readonly longInterpretation?: string;
  /** The greatest value of the outcome in normal use. */
  readonly normalMaximum?: number;
  /** The least value of the outcome in normal use. */
  readonly normalMinimum?: number;
  /** The value from which the outcome counts as mastery. */
  readonly masteryValue?: number;
  /** Who scores the outcome when processing does not (`external-scored`). */
  readonly externalScored?: OutcomeScorer;
  /** The identifier of the variable that the outcome reports on (`variable-identifier-ref`). */
  readonly variableIdentifierRef?: string;
  /** The elements of `outcomeInformation`, kept as they are; an empty array is an `outcomeInformation` without elements. */
  readonly outcomeInformation?: readonly XmlElement[];
}

/** A variable that has a value: a template variable or a context variable (RR §2.4.3). */
export interface ValuedResultVariable extends ResultVariableType {
  /** The identifier of the variable. */
  readonly identifier: string;
  /** The value, or NULL. */
  readonly value: Value | null;
}

/** A template variable of an item instance (RR §2.4.3). */
export interface TemplateVariable extends ValuedResultVariable {
  /** Tells the four kinds of variable apart. */
  readonly kind: "template";
}

/** A context variable that a test declares (RR §2.4.3). */
export interface ContextVariable extends ValuedResultVariable {
  /** Tells the four kinds of variable apart. */
  readonly kind: "context";
}

/** A variable in a result: a response, outcome, template or context variable. */
export type ResultVariable = ResponseVariable | OutcomeVariable | TemplateVariable | ContextVariable;

/** The result of one test (RR §2.4.9). */
export interface TestResult {
  /** The identifier of the test. */
  readonly identifier: string;
  /** When the result was reported, as an `xs:dateTime` such as `2020-08-25T18:19:20`. */
  readonly datestamp: string;
  /** The test-level variables, in document order. */
  readonly variables: readonly ResultVariable[];
  /** The supports used during the test. */
  readonly supports: readonly SupportUse[];
}

/** The result of one item instance (RR §2.4.5). */
export interface ItemResult {
  /** The identifier of the item reference, or of the item. */
  readonly identifier: string;
  /** The position of the item instance in the session, from 1. */
  readonly sequenceIndex?: number;
  /** When the result was reported, as an `xs:dateTime` such as `2020-08-25T18:19:20`. */
  readonly datestamp: string;
  /** The state of the item session. */
  readonly sessionStatus: SessionStatus;
  /** The variables of the item session, in document order. */
  readonly variables: readonly ResultVariable[];
  /** The comment that the candidate made. */
  readonly candidateComment?: string;
  /** The supports used during the item session. */
  readonly supports: readonly SupportUse[];
}

/** A Results Reporting document (RR §2.3.1). */
export interface AssessmentResult {
  /** Who took the assessment; the schema requires it, so a report always has one. */
  readonly context: ResultContext;
  /** The result of the test. */
  readonly testResult?: TestResult;
  /** The results of the item instances, in order. */
  readonly itemResults: readonly ItemResult[];
}
