import { describe, isRecord } from "../checks.js";
import { DataError } from "../errors.js";
import type { CustomOperatorExpression } from "../processing/index.js";
import { isIdentifier } from "../values/index.js";
import { writeCanonicalJson } from "./canonical-json.js";
import {
  OPERATOR_DEFINITIONS,
  OPERATOR_NAMES,
  OPERATOR_NAMESPACE,
  OPTIONS_ATTRIBUTE,
  OPTIONS_PREFIX,
  type OperatorName,
} from "./definitions.js";
import { prepareExpression } from "./expression-equivalent.js";
import { prepareAreas } from "./hotspot-matching.js";
import type { ExpressionKey, FollowThrough, KeyedAreasKey, NumberKey, TextKey } from "./keys.js";
import { DEFAULT_OPERATOR_LIMITS } from "./limits.js";
import { prepareNumber } from "./number-equivalent.js";
import { parseOptions } from "./options.js";
import { prepareReadable } from "./readable.js";
import { resolveKeyDefaults } from "./schemas.js";
import { prepareText } from "./text-equivalent.js";

/** The call of `expression-equivalent`. */
export interface ExpressionCall {
  /** The operator. */
  readonly operator: "expression-equivalent";
  /** The key. */
  readonly key: ExpressionKey;
  /**
   * Credit for an answer that follows from an earlier response.
   *
   * @defaultValue none
   */
  readonly followThrough?: FollowThrough;
}

/** The call of `number-equivalent`. */
export interface NumberCall {
  /** The operator. */
  readonly operator: "number-equivalent";
  /** The key. */
  readonly key: NumberKey;
  /**
   * Credit for an answer that follows from an earlier response.
   *
   * @defaultValue none
   */
  readonly followThrough?: FollowThrough;
}

/** The call of `text-equivalent`. */
export interface TextCall {
  /** The operator. */
  readonly operator: "text-equivalent";
  /** The key. */
  readonly key: TextKey;
}

/** The call of `hotspot-matching`, on an `areas` key of the scheme `keyed`. */
export interface HotspotCall {
  /** The operator. */
  readonly operator: "hotspot-matching";
  /** The key. */
  readonly key: KeyedAreasKey;
}

/** The call of `readable`, on the key that the response is scored by. */
export interface ReadableCall {
  /** The operator. */
  readonly operator: "readable";
  /** The key. */
  readonly key: ExpressionKey | NumberKey | TextKey;
}

/** One call of an operator: which operator, the key it scores by, and for an expression or a number, its follow-through. */
export type OperatorCall = ExpressionCall | NumberCall | TextCall | HotspotCall | ReadableCall;

/** The name of the operator of a call, checked. */
function operatorOf(call: Readonly<Record<string, unknown>>): OperatorName {
  const name = call.operator;
  const found = OPERATOR_NAMES.find((candidate) => candidate === name);
  if (found === undefined)
    throw new DataError(`The option operator must be one of ${OPERATOR_NAMES.join(", ")}, found ${describe(name)}.`);
  return found;
}

/** Checks an identifier of a response, which a `qti-variable` names. */
function checkResponseIdentifier(identifier: unknown, label: string): string {
  if (typeof identifier !== "string" || !isIdentifier(identifier))
    throw new DataError(`${label} must be a QTI identifier, found ${describe(identifier)}.`);
  return identifier;
}

/** The options of a call with every default resolved, and the identifier of its earlier response, if any. */
function resolveCall(name: OperatorName, call: Readonly<Record<string, unknown>>): { options: unknown; from?: string } {
  const key = resolveKeyDefaults(call.key);
  const { followThrough } = call;
  if (name !== "expression-equivalent" && name !== "number-equivalent") {
    if (followThrough !== undefined)
      throw new DataError("The option followThrough is for expression-equivalent and number-equivalent alone.");
    return { options: { key } };
  }
  if (followThrough === undefined || followThrough === null) return { options: { key, followThrough: null } };
  if (!isRecord(followThrough))
    throw new DataError(
      `The option followThrough must be an object of from, expression and variable, found ${describe(followThrough)}.`,
    );
  const from = checkResponseIdentifier(followThrough.from, "The option followThrough.from");
  const variable = followThrough.variable === undefined ? "r" : followThrough.variable;
  return { options: { key, followThrough: { expression: followThrough.expression, variable } }, from };
}

/**
 * Reads and checks the options of a call as its operator reads them, at their defaults' limits, so that an item that
 * `compileScoring` writes never fails in processing.
 */
function checkOptions(name: OperatorName, options: unknown): unknown {
  const limits = DEFAULT_OPERATOR_LIMITS;
  switch (name) {
    case "expression-equivalent": {
      const read = parseOptions(name, options, "");
      prepareExpression(read, limits, "");
      return read;
    }
    case "number-equivalent": {
      const read = parseOptions(name, options, "");
      prepareNumber(read, limits, "");
      return read;
    }
    case "text-equivalent": {
      const read = parseOptions(name, options, "");
      prepareText(read, "");
      return read;
    }
    case "hotspot-matching": {
      const read = parseOptions(name, options, "");
      prepareAreas(read, "");
      return read;
    }
    case "readable":
      return prepareReadable(parseOptions(name, options, ""), limits, "");
  }
}

/**
 * Builds the `qti-custom-operator` that scores a response by the calling convention, which every item that calls an operator
 * fixes: the operator's name as `class` and its `urn:uuid:` as `definition`; the response as the first operand, a
 * `qti-variable`, and the earlier response of a follow-through as the second; the key, and the follow-through's expression and
 * variable, as RFC 8785 canonical JSON with every default resolved, in the attribute `options` of `OPERATOR_NAMESPACE`.
 *
 * @param call - The operator and its key.
 * @param response - The identifier of the response the operator scores.
 * @returns The expression, for an item's response processing; a writer gives its attribute the prefix `operator`.
 * @throws `DataError` for a key the operator refuses, read by the schema and the checks that the operator runs, a response or
 *   a `followThrough.from` that is not an identifier, or a follow-through on another operator or from the response itself.
 * @throws `SecurityError` past the limits of a key, or past the default limits of the operators.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-custom-operator}
 * @see {@link https://www.rfc-editor.org/rfc/rfc8785 | RFC 8785, JSON Canonicalization Scheme}
 */
export function buildOperatorCall(call: OperatorCall, response: string): CustomOperatorExpression {
  const given: unknown = call;
  if (!isRecord(given))
    throw new DataError(`The call must be an object of operator and key, found ${describe(given)}.`);
  const name = operatorOf(given);
  const identifier = checkResponseIdentifier(response, "The response");
  const { options, from } = resolveCall(name, given);
  if (from === identifier)
    throw new DataError("The option followThrough.from names an earlier response, never the response itself.");
  const checked = checkOptions(name, options);
  const variable = (id: string) => ({ kind: "variable", identifier: id }) as const;
  return {
    kind: "custom-operator",
    class: name,
    definition: OPERATOR_DEFINITIONS[name],
    operands: from === undefined ? [variable(identifier)] : [variable(identifier), variable(from)],
    extensions: [
      {
        namespace: OPERATOR_NAMESPACE,
        prefix: OPTIONS_PREFIX,
        name: OPTIONS_ATTRIBUTE,
        value: writeCanonicalJson(checked),
      },
    ],
    extensionElements: [],
  };
}
