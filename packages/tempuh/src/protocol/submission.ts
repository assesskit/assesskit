import type { BodyNode } from "@luthfanwakan/olah/asi";
import type { ItemKey, Scorer, ScoringDeclaration } from "@luthfanwakan/olah/delivery";
import { BASE_TYPES, CARDINALITIES, type WireValue } from "@luthfanwakan/olah/values";
import {
  checkArray,
  checkBoolean,
  checkChoice,
  checkFinite,
  checkNonEmptyString,
  checkPositiveInteger,
  checkProperties,
  checkRecord,
  checkString,
  describe,
  isRecord,
} from "../checks.js";
import { DataError } from "../errors.js";

/** A value in a submission: olah's {@link WireValue}, which decodes without a declaration, or `null` for NULL. */
export type SubmissionValue = WireValue | null;

/** A variable of an item with its value, as an entry of a list so that an identifier such as `__proto__` stays data. */
export interface SubmissionVariable {
  /** The identifier of the variable. */
  readonly identifier: string;
  /** Its value. */
  readonly value: SubmissionValue;
}

/** One response that the outcome rates: a cover of the scoring request with what the candidate submitted. */
export interface SubmissionPart {
  /** The item instance the response belongs to; it names one of the `items` of the submission. */
  readonly item: ItemKey;
  /** The identifier of the response variable. */
  readonly responseIdentifier: string;
  /** The label of the cover in the test; absent when it has none. */
  readonly label?: string;
  /** Whether the candidate was presented the item; if not, `value` is NULL. */
  readonly presented: boolean;
  /** The kind of the interaction that binds the response, such as `extended-text-interaction`; absent when none does. */
  readonly interaction?: string;
  /** The last submitted response, exact. */
  readonly value: SubmissionValue;
}

/** An item instance that the outcome covers, as the candidate saw it and with what only a scorer sees. */
export interface SubmissionItem {
  /** The item instance. */
  readonly key: ItemKey;
  /** The title of the item. */
  readonly title: string;
  /** Whether the candidate was presented the item; if not, the body and the lists are empty. */
  readonly presented: boolean;
  /** The body after template processing, followed by the item's rubric blocks for the scorer. */
  readonly body: readonly BodyNode[];
  /** The template variables of the instance. */
  readonly templateValues: readonly SubmissionVariable[];
  /** The correct responses, one entry for each response variable of the item. */
  readonly correctResponses: readonly SubmissionVariable[];
}

/** The score that a scorer supplied before. */
export interface SubmissionSupplied {
  /** The value of the outcome, or NULL. */
  readonly value: SubmissionValue;
  /** When it was supplied, in epoch milliseconds. */
  readonly at: number;
  /** Who supplied it. */
  readonly scorer: Scorer;
}

/**
 * What a scorer needs to rate one externally scored outcome, in a form that is JSON text as it is (tempuh design §2.9): the
 * request, its declaration, the rubric, the responses that the outcome rates and the items they belong to. It holds the
 * correct responses of the items, so it goes only to authorized raters.
 */
export interface Submission {
  /** The identifier of the scoring request, which `toSupplyScores` answers. */
  readonly request: string;
  /** The identifier of the outcome. */
  readonly outcome: string;
  /** Who is to score it. */
  readonly mode: Scorer;
  /** The `variable-identifier-ref` of the outcome's declaration; absent when it has none. */
  readonly variableIdentifierRef?: string;
  /** `true` when the item is a link to a tool; absent otherwise. */
  readonly lti?: true;
  /** The declaration of the outcome. */
  readonly declaration: ScoringDeclaration;
  /** When the request was made, in epoch milliseconds. */
  readonly requestedAt: number;
  /** The score supplied earlier; absent while the request is pending. */
  readonly supplied?: SubmissionSupplied;
  /** The rubric of the scorer view. */
  readonly rubric: readonly BodyNode[];
  /** The responses the outcome rates, in the order of the covers. */
  readonly parts: readonly SubmissionPart[];
  /** The item instances the outcome covers, each once, in the order of the covers. */
  readonly items: readonly SubmissionItem[];
}

/** The scorers of a request (INFO §4.5.10). */
const SCORERS: readonly Scorer[] = ["human", "externalMachine"];

/**
 * The first and the last time that a submission may carry: `0001-01-01T00:00:00.000Z` and `9999-12-31T23:59:59.999Z` in
 * epoch milliseconds, the range of olah's times, so that every time has a four-digit year in a datestamp.
 */
const FIRST_INSTANT = -62_135_596_800_000;
const LAST_INSTANT = 253_402_300_799_999;

const SUBMISSION_PROPERTIES = [
  "request",
  "outcome",
  "mode",
  "variableIdentifierRef",
  "lti",
  "declaration",
  "requestedAt",
  "supplied",
  "rubric",
  "parts",
  "items",
];
const DECLARATION_PROPERTIES = [
  "cardinality",
  "baseType",
  "normalMinimum",
  "normalMaximum",
  "masteryValue",
  "interpretation",
  "longInterpretation",
];
const PART_PROPERTIES = ["item", "responseIdentifier", "label", "presented", "interaction", "value"];
const ITEM_PROPERTIES = ["key", "title", "presented", "body", "templateValues", "correctResponses"];

/** Checks a time of a submission: epoch milliseconds that a datestamp with a four-digit year can show. */
function checkInstant(value: unknown, label: string): asserts value is number {
  checkFinite(value, label);
  if (value < FIRST_INSTANT || value > LAST_INSTANT) {
    throw new DataError(
      `${label} must be epoch milliseconds from the year 1 to the year 9999, found ${describe(value)}.`,
    );
  }
}

/** Checks an optional string, and an optional finite number. */
function checkOptionalString(value: unknown, label: string): void {
  if (value !== undefined) checkString(value, label);
}

function checkOptionalFinite(value: unknown, label: string): void {
  if (value !== undefined) checkFinite(value, label);
}

/** Checks the key of an item instance; `name` says which, such as `key of an item of a submission`. */
function checkItemKey(key: unknown, name: string): asserts key is ItemKey {
  checkRecord(key, `The ${name} must be an object`);
  checkProperties(key, `The ${name}`, ["ref", "instance"]);
  checkNonEmptyString(key.ref, `The ref of the ${name}`);
  checkPositiveInteger(key.instance, `The instance of the ${name}`);
}

/** Checks a value: NULL or an object, which `fromWireValue` of olah reads when the value is shown. */
function checkValue(value: unknown, label: string): asserts value is SubmissionValue {
  if (value !== null && !isRecord(value)) {
    throw new DataError(`${label} must be a wire value or null, found ${describe(value)}.`);
  }
}

/** Checks the nodes of content: an array of objects that each have a `kind`. */
function checkNodes(nodes: unknown, label: string): asserts nodes is readonly BodyNode[] {
  checkArray(nodes, `${label} must be an array of nodes`);
  for (const node of nodes) {
    if (!isRecord(node) || typeof node.kind !== "string") {
      throw new DataError(`${label} must hold nodes, each an object with a string kind, found ${describe(node)}.`);
    }
  }
}

/**
 * Checks the declaration of an outcome as a scoring request carries it: its cardinality and base type, which a record
 * lacks, its numbers and its texts.
 *
 * @throws `DataError` when it is not.
 */
export function checkDeclaration(declaration: unknown): asserts declaration is ScoringDeclaration {
  checkRecord(declaration, "The property declaration of a submission must be an object");
  checkProperties(declaration, "The declaration of a submission", DECLARATION_PROPERTIES);
  checkChoice(declaration.cardinality, "The cardinality of the declaration of a submission", CARDINALITIES);
  if (declaration.cardinality === "record") {
    if (declaration.baseType !== undefined) {
      throw new DataError(`A record has no base type, found ${describe(declaration.baseType)}.`);
    }
  } else {
    checkChoice(declaration.baseType, "The base type of the declaration of a submission", BASE_TYPES);
  }
  checkOptionalFinite(declaration.normalMinimum, "The normalMinimum of the declaration of a submission");
  checkOptionalFinite(declaration.normalMaximum, "The normalMaximum of the declaration of a submission");
  checkOptionalFinite(declaration.masteryValue, "The masteryValue of the declaration of a submission");
  checkOptionalString(declaration.interpretation, "The interpretation of the declaration of a submission");
  checkOptionalString(declaration.longInterpretation, "The longInterpretation of the declaration of a submission");
}

/** Checks a list of variables; `name` says which, such as `correctResponses of an item of a submission`. */
function checkVariables(variables: unknown, name: string): asserts variables is readonly SubmissionVariable[] {
  checkArray(variables, `The ${name} must be an array`);
  for (const variable of variables) {
    checkRecord(variable, `An entry of the ${name} must be an object`);
    checkProperties(variable, `An entry of the ${name}`, ["identifier", "value"]);
    checkString(variable.identifier, `An identifier of the ${name}`);
    checkValue(variable.value, `The value of ${describe(variable.identifier)} in the ${name}`);
  }
}

function checkPart(part: unknown): asserts part is SubmissionPart {
  checkRecord(part, "A part of a submission must be an object");
  checkProperties(part, "A part of a submission", PART_PROPERTIES);
  checkItemKey(part.item, "item of a part of a submission");
  checkString(part.responseIdentifier, "The responseIdentifier of a part of a submission");
  checkOptionalString(part.label, "The label of a part of a submission");
  checkBoolean(part.presented, "The presented of a part of a submission");
  checkOptionalString(part.interaction, "The interaction of a part of a submission");
  checkValue(part.value, "The value of a part of a submission");
}

function checkItem(item: unknown): asserts item is SubmissionItem {
  checkRecord(item, "An item of a submission must be an object");
  checkProperties(item, "An item of a submission", ITEM_PROPERTIES);
  checkItemKey(item.key, "key of an item of a submission");
  checkString(item.title, "The title of an item of a submission");
  checkBoolean(item.presented, "The presented of an item of a submission");
  checkNodes(item.body, "The body of an item of a submission");
  checkVariables(item.templateValues, "templateValues of an item of a submission");
  checkVariables(item.correctResponses, "correctResponses of an item of a submission");
}

/** Whether two keys name the same item instance. */
const sameKey = (a: ItemKey, b: ItemKey): boolean => a.ref === b.ref && a.instance === b.instance;

/**
 * Checks a submission that arrived as JSON: every property of its form and no other, the type of every field, the content
 * as nodes, and that each part names an item the submission has, which it has once. A value is read when it is shown.
 *
 * @throws `DataError` when it is not a submission.
 */
export function checkSubmission(value: unknown): asserts value is Submission {
  checkRecord(value, "A submission must be an object");
  checkProperties(value, "A submission", SUBMISSION_PROPERTIES);
  checkNonEmptyString(value.request, "The request of a submission");
  checkNonEmptyString(value.outcome, "The outcome of a submission");
  checkChoice(value.mode, "The mode of a submission", SCORERS);
  checkOptionalString(value.variableIdentifierRef, "The variableIdentifierRef of a submission");
  if (value.lti !== undefined && value.lti !== true) {
    throw new DataError(`The lti of a submission must be true or absent, found ${describe(value.lti)}.`);
  }
  checkDeclaration(value.declaration);
  checkInstant(value.requestedAt, "The requestedAt of a submission");
  const { supplied } = value;
  if (supplied !== undefined) {
    checkRecord(supplied, "The supplied of a submission must be an object");
    checkProperties(supplied, "The supplied of a submission", ["value", "at", "scorer"]);
    checkValue(supplied.value, "The value of the supplied of a submission");
    checkInstant(supplied.at, "The time of the supplied of a submission");
    checkChoice(supplied.scorer, "The scorer of the supplied of a submission", SCORERS);
  }
  checkNodes(value.rubric, "The rubric of a submission");
  checkArray(value.parts, "The parts of a submission must be an array");
  checkArray(value.items, "The items of a submission must be an array");
  value.parts.forEach(checkPart);
  value.items.forEach(checkItem);
  const items = value.items as readonly SubmissionItem[];
  items.forEach(({ key }, index) => {
    if (items.slice(0, index).some((other) => sameKey(other.key, key))) {
      throw new DataError(`A submission has the item ${describe(key.ref)} instance ${key.instance} twice.`);
    }
  });
  for (const { item } of value.parts as readonly SubmissionPart[]) {
    if (!items.some(({ key }) => sameKey(key, item))) {
      throw new DataError(
        `A part of a submission names the item ${describe(item.ref)} instance ${item.instance}, which the submission lacks.`,
      );
    }
  }
}
