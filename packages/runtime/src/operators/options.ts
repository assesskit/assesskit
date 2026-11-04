import * as v from "valibot";
import { parseWith, strictRecord } from "../checks.js";
import { DataError, SecurityError } from "../errors.js";
import type { CustomOperatorExpression } from "../processing/index.js";
import { OPERATOR_NAMESPACE, OPTIONS_ATTRIBUTE, type OperatorName } from "./definitions.js";
import {
  areasKeySchema,
  checkKeyLimits,
  expressionKeySchema,
  numberKeySchema,
  readableKeySchema,
  textKeySchema,
} from "./schemas.js";

/** A follow-through as the options carry it: its `from` is the second operand. */
const followThroughSchema = v.nullable(strictRecord({ expression: v.string(), variable: v.string() }));

/** The schema of each operator's options, every field present, as `buildOperatorCall` writes them. */
const OPTION_SCHEMAS = {
  "expression-equivalent": strictRecord({ key: expressionKeySchema, followThrough: followThroughSchema }),
  "number-equivalent": strictRecord({ key: numberKeySchema, followThrough: followThroughSchema }),
  "text-equivalent": strictRecord({ key: textKeySchema }),
  "hotspot-matching": strictRecord({ key: areasKeySchema }),
  readable: strictRecord({ key: readableKeySchema }),
} as const;

/** The options of an operator, as its schema reads them. */
export type OptionsOf<TName extends OperatorName> = v.InferOutput<(typeof OPTION_SCHEMAS)[TName]>;

/** The path of a part of the options: under `options` in an item, at the root in a call that `buildOperatorCall` checks. */
export function pathOf(prefix: string, rest: string): string {
  return prefix === "" ? rest : `${prefix}.${rest}`;
}

/** The path of a member of an object: `.name` for an identifier, else the name in brackets, as JSON writes it. */
export function memberPath(path: string, name: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(name) ? `${path}.${name}` : `${path}[${JSON.stringify(name)}]`;
}

/** A `DataError` about a part of the options, naming its path. */
export function optionsError(path: string, message: string, options?: ErrorOptions): DataError {
  return new DataError(`The options are invalid at ${path}: ${message}`, options);
}

/**
 * Parses an operator's options and checks them against the limits of a key.
 *
 * @param prefix - The path of the options: `options` in an item, empty in a call.
 */
export function parseOptions<TName extends OperatorName>(
  name: TName,
  input: unknown,
  prefix: string,
): OptionsOf<TName> {
  const schema = prefix === "" ? OPTION_SCHEMAS[name] : strictRecord({ [prefix]: OPTION_SCHEMAS[name] });
  const parsed = parseWith(schema, input, prefix === "" ? `The call of ${name}` : `The ${prefix} of ${name}`);
  // The schema of the name, which `OptionsOf` names, has read the options.
  const options = (prefix === "" ? parsed : (parsed as Readonly<Record<string, unknown>>)[prefix]) as OptionsOf<TName>;
  checkKeyLimits(options.key, pathOf(prefix, "key"));
  return options;
}

/**
 * Reads the options of an operator from its `qti-custom-operator`: the attribute `options` in `OPERATOR_NAMESPACE`, whatever
 * its prefix, as JSON with every field present.
 *
 * @throws `DataError` or `SecurityError` whose message names the path under `options`: a defect of the item, never of a
 *   response.
 */
export function readOptions<TName extends OperatorName>(
  expression: CustomOperatorExpression,
  name: TName,
): OptionsOf<TName> {
  const attribute = expression.extensions.find(
    (candidate) => candidate.namespace === OPERATOR_NAMESPACE && candidate.name === OPTIONS_ATTRIBUTE,
  );
  if (attribute === undefined)
    throw new DataError(
      `The qti-custom-operator of ${name} has no attribute ${OPTIONS_ATTRIBUTE} in the namespace ${OPERATOR_NAMESPACE}; write it with buildOperatorCall.`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(attribute.value);
  } catch (error) {
    throw optionsError("options", `the attribute is not JSON: ${(error as Error).message}`, { cause: error });
  }
  return parseOptions(name, { options: parsed }, "options");
}

/** An error of a part of a key, rethrown with the path of that part; a `SecurityError` stays one. */
export function atPath(error: unknown, path: string): Error {
  if (error instanceof SecurityError)
    return new SecurityError(`The key at ${path}: ${error.message}`, error.limit, error.maximum, { cause: error });
  if (error instanceof DataError) return optionsError(path, error.message, { cause: error });
  return error instanceof Error ? error : optionsError(path, String(error));
}
