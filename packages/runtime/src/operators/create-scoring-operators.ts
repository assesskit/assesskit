import * as v from "valibot";
import { parseWith, strictRecord } from "../checks.js";
import type { CustomOperator } from "../processing/index.js";
import { OPERATOR_DEFINITIONS } from "./definitions.js";
import { prepareExpression, scoreExpression } from "./expression-equivalent.js";
import { prepareAreas, scoreAreas } from "./hotspot-matching.js";
import { DEFAULT_OPERATOR_LIMITS, type OperatorLimits, operatorLimitsSchema } from "./limits.js";
import { prepareNumber, scoreNumber } from "./number-equivalent.js";
import { readOptions } from "./options.js";
import { prepareReadable, scoreReadable } from "./readable.js";
import { prepareText, scoreText } from "./text-equivalent.js";

const createScoringOperatorsOptionsSchema = strictRecord({ limits: v.optional(operatorLimitsSchema) });

/** The options of {@link createScoringOperators}. */
export interface CreateScoringOperatorsOptions {
  /**
   * The limits of what the operators read from a response, each one a positive integer up to its cap. Set them alike wherever
   * an item is scored, on the server, in a device's local session and in a replay, so that a verdict does not depend on
   * where it is made.
   *
   * @defaultValue the values of `DEFAULT_OPERATOR_LIMITS`
   */
  readonly limits?: Partial<OperatorLimits>;
}

/**
 * Creates the five scoring operators by their definitions, for the `customOperators` of processing, an engine and
 * validation: `expression-equivalent`, `number-equivalent`, `text-equivalent`, `hotspot-matching` and `readable`.
 *
 * @remarks
 * Each is pure and synchronous, and reads its key from the attribute `options` that {@link buildOperatorCall} writes. A
 * response that is blank, past a limit or unreadable scores NULL, and `readable` false: a candidate's input never makes an
 * operator throw. Options that do not parse or that an operator refuses throw `DataError` or `SecurityError`, whose message
 * names the path under `options`; processing reports it as a `ProcessingError`, a defect of the item.
 *
 * @param options - The limits.
 * @returns A map from each operator's `definition` to the operator; processing looks a `qti-custom-operator` up by its
 *   `definition` first.
 * @throws `DataError` for options that are not an object or hold another property, or a limit that is not a positive integer
 *   or is past its cap: 20,000, 128, 64 and 256.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-custom-operator}
 * @example
 * ```ts
 * import { buildOperatorCall, createScoringOperators, OPERATOR_DEFINITIONS } from "@assesskit/runtime/operators";
 *
 * const call = buildOperatorCall(
 *   { operator: "expression-equivalent", key: { kind: "expression", expression: "2(x+1)" } },
 *   "RESPONSE",
 * );
 * const score = createScoringOperators().get(OPERATOR_DEFINITIONS["expression-equivalent"]);
 * score([{ cardinality: "single", baseType: "string", value: "2x+2" }], call); // => { cardinality: "single", baseType: "float", value: 1 }
 * score([{ cardinality: "single", baseType: "string", value: "2x+1" }], call); // => { cardinality: "single", baseType: "float", value: 0 }
 * ```
 */
export function createScoringOperators(
  options: CreateScoringOperatorsOptions = {},
): ReadonlyMap<string, CustomOperator> {
  const { limits = DEFAULT_OPERATOR_LIMITS } = parseWith(
    createScoringOperatorsOptionsSchema,
    options,
    "The options object",
  );
  const operators: [string, CustomOperator][] = [
    [
      OPERATOR_DEFINITIONS["expression-equivalent"],
      (operands, expression) =>
        scoreExpression(
          prepareExpression(readOptions(expression, "expression-equivalent"), limits, "options"),
          operands,
          limits,
        ),
    ],
    [
      OPERATOR_DEFINITIONS["number-equivalent"],
      (operands, expression) =>
        scoreNumber(prepareNumber(readOptions(expression, "number-equivalent"), limits, "options"), operands, limits),
    ],
    [
      OPERATOR_DEFINITIONS["text-equivalent"],
      (operands, expression) =>
        scoreText(prepareText(readOptions(expression, "text-equivalent"), "options"), operands, limits),
    ],
    [
      OPERATOR_DEFINITIONS["hotspot-matching"],
      (operands, expression) =>
        scoreAreas(prepareAreas(readOptions(expression, "hotspot-matching"), "options"), operands),
    ],
    [
      OPERATOR_DEFINITIONS.readable,
      (operands, expression) =>
        scoreReadable(prepareReadable(readOptions(expression, "readable"), limits, "options"), operands, limits),
    ],
  ];
  return new Map(operators);
}
