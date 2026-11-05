import * as v from "valibot";
import { describe, parseWith, strictRecord } from "../checks.js";
import { DataError } from "../errors.js";
import type { ExpressionKey, FollowThrough, Key, KeyedAreasKey, NumberKey, TextKey } from "../keys/index.js";
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
import { DEFAULT_OPERATOR_LIMITS } from "./limits.js";
import { prepareNumber } from "./number-equivalent.js";
import { type EarlierReading, parseOptions } from "./options.js";
import { prepareReadable } from "./readable.js";
import type { AreasKeyData, ExpressionKeyData, NumberKeyData } from "./schemas.js";
import { type PreparedText, prepareText } from "./text-equivalent.js";

/**
 * One call of an operator: which operator, the key it scores by, and for an expression or a number, its follow-through.
 *
 * @remarks
 * `hotspot-matching` takes an `areas` key of the scheme `keyed`, and `readable` the key that the response is scored by.
 */
export type OperatorCall =
  | {
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
  | {
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
  | {
      /** The operator. */
      readonly operator: "text-equivalent";
      /** The key. */
      readonly key: TextKey;
    }
  | {
      /** The operator. */
      readonly operator: "hotspot-matching";
      /** The key. */
      readonly key: KeyedAreasKey;
    }
  | {
      /** The operator. */
      readonly operator: "readable";
      /** The key. */
      readonly key: ExpressionKey | NumberKey | TextKey;
    };

/** The properties of a call and no other; its operator's schema reads the key and the expression of its follow-through. */
const callSchema = strictRecord({
  operator: v.picklist(OPERATOR_NAMES),
  key: v.optional(v.unknown()),
  followThrough: v.optional(v.unknown()),
});

/** The properties of a follow-through and no other. */
const followThroughSchema = strictRecord({
  from: v.optional(v.unknown()),
  expression: v.optional(v.unknown()),
  variable: v.optional(v.unknown()),
});

/** Checks an identifier of a response, which a `qti-variable` names. */
function checkResponseIdentifier(identifier: unknown, label: string): string {
  if (typeof identifier !== "string" || !isIdentifier(identifier))
    throw new DataError(`${label} must be a QTI identifier, found ${describe(identifier)}.`);
  return identifier;
}

/**
 * The options of a call, whose schema resolves every default, and the identifier of its earlier response, if any.
 *
 * @param reading - How the earlier response reads, from its own key, or `null` when the call does not know that key.
 */
function resolveCall(
  name: OperatorName,
  { key, followThrough }: { readonly key: unknown; readonly followThrough?: unknown },
  reading: EarlierReading | null = null,
): { options: unknown; from?: string } {
  if (name !== "expression-equivalent" && name !== "number-equivalent") {
    if (followThrough !== undefined)
      throw new DataError("The option followThrough is for expression-equivalent and number-equivalent alone.");
    return { options: { key } };
  }
  if (followThrough === undefined || followThrough === null) return { options: { key, followThrough: null } };
  const {
    from: origin,
    expression,
    variable = "r",
  } = parseWith(followThroughSchema, followThrough, "The option followThrough");
  const from = checkResponseIdentifier(origin, "The option followThrough.from");
  return { options: { key, followThrough: { expression, variable, reading } }, from };
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

/** Reads the key of a call of `number-equivalent` as `buildOperatorCall` reads it, every default resolved and checked. */
export function readNumberKey(key: unknown, followThrough: unknown): NumberKeyData {
  const { options } = resolveCall("number-equivalent", { key, followThrough });
  const read = parseOptions("number-equivalent", options, "");
  prepareNumber(read, DEFAULT_OPERATOR_LIMITS, "");
  return read.key;
}

/** Reads the key of a call of `expression-equivalent` as `buildOperatorCall` reads it, every default resolved and checked. */
function readExpressionKey(key: unknown): ExpressionKeyData {
  const { options } = resolveCall("expression-equivalent", { key });
  const read = parseOptions("expression-equivalent", options, "");
  prepareExpression(read, DEFAULT_OPERATOR_LIMITS, "");
  return read.key;
}

/**
 * Derives how the response of a key reads, for a later follow-through from it: a number with its decimal mark and fractions,
 * an expression with its decimal mark, or `null` for a key of another kind, whose response no follow-through reads.
 */
export function deriveEarlierReading(key: Key): EarlierReading | null {
  if (key.kind === "number") {
    const { decimalSeparator, fractions } = readNumberKey(key, undefined);
    return { kind: "number", decimalSeparator, fractions };
  }
  if (key.kind === "expression")
    return { kind: "expression", decimalSeparator: readExpressionKey(key).decimalSeparator };
  return null;
}

/** Reads the key of a call of `text-equivalent` as `buildOperatorCall` reads it, with the points of its `count` highest answers. */
export function readTextKey(key: unknown): PreparedText {
  const { options } = resolveCall("text-equivalent", { key });
  return prepareText(parseOptions("text-equivalent", options, ""), "");
}

/** Reads the key of a call of `hotspot-matching` as `buildOperatorCall` reads it. */
export function readAreasKey(key: unknown): AreasKeyData {
  const { options } = resolveCall("hotspot-matching", { key });
  return prepareAreas(parseOptions("hotspot-matching", options, ""), "");
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
 * @throws `DataError` for a call or a follow-through with a property that it does not have, a key the operator refuses, read
 *   by the schema and the checks that the operator runs, a response or a `followThrough.from` that is not an identifier, or a
 *   follow-through on another operator or from the response itself.
 * @throws `SecurityError` past the limits of a key, or past the default limits of the operators.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-custom-operator}
 * @see {@link https://www.rfc-editor.org/rfc/rfc8785 | RFC 8785, JSON Canonicalization Scheme}
 */
export function buildOperatorCall(call: OperatorCall, response: string): CustomOperatorExpression {
  return buildCallReading(call, response, null);
}

/**
 * Builds a call as {@link buildOperatorCall} does, its follow-through reading the earlier response as that response's own key
 * reads it, which `compileScoring` derives.
 */
export function buildCallReading(
  call: OperatorCall,
  response: string,
  reading: EarlierReading | null,
): CustomOperatorExpression {
  const { operator: name, key, followThrough } = parseWith(callSchema, call, "The call");
  const identifier = checkResponseIdentifier(response, "The response");
  const { options, from } = resolveCall(name, { key, followThrough }, reading);
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
