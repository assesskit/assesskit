import type { ValueElement } from "../asi/index.js";
import { describe } from "../checks.js";
import { DataError, ProcessingError } from "../errors.js";
import {
  type BaseType,
  container,
  type Primitive,
  parsePrimitive,
  record,
  type SingleValue,
  single,
  type Value,
} from "../values/index.js";
import type { VariableType } from "./assign.js";

/**
 * Reads the text of a value of a base type.
 *
 * @param text - The text.
 * @param baseType - The base type.
 * @param what - Names the text in the message, such as `The base value`.
 * @returns The primitive.
 * @throws `ProcessingError` when the text is not in the lexical form of the base type.
 */
export function readPrimitive(text: string, baseType: BaseType, what: string): Primitive {
  try {
    return parsePrimitive(text, baseType);
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    throw new ProcessingError(`${what} has the text ${describe(text)}, which is not a value of base type ${baseType}.`);
  }
}

/**
 * Reads a single value from its text, NULL for an empty string.
 *
 * @throws `ProcessingError` when the text is not in the lexical form of the base type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function readSingle(text: string, baseType: BaseType, what: string): SingleValue | null {
  return single(baseType, readPrimitive(text, baseType, what));
}

function readField(element: ValueElement, what: string): readonly [string, SingleValue] | undefined {
  const { fieldIdentifier, baseType } = element;
  if (fieldIdentifier === undefined || baseType === undefined) {
    throw new ProcessingError(`${what} is a record, so each of its values needs a field-identifier and a base-type.`);
  }
  const field = readSingle(element.value, baseType, what);
  return field === null ? undefined : [fieldIdentifier, field];
}

/**
 * Builds the value that the `qti-value` elements of a default value or correct response give a variable: one value for
 * a single variable, a container of them, or a record of fields.
 *
 * @remarks
 * Empty strings are NULL and are left out of containers and records.
 *
 * @param type - The cardinality and base type of the variable.
 * @param elements - The values; `undefined` when the declaration gives none, which is NULL.
 * @param what - Names the values in messages, such as `The default value of SCORE`.
 * @returns The value, or `null` for NULL.
 * @throws `ProcessingError` when a text is not in the lexical form of its base type, a single variable has more than
 * one value, or a field of a record lacks its identifier or base type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-value}
 */
export function declaredValue(
  elements: readonly ValueElement[] | undefined,
  type: VariableType,
  what: string,
): Value | null {
  if (elements === undefined) return null;
  if (type.cardinality === "record") {
    return record(elements.map((element) => readField(element, what)).filter((field) => field !== undefined));
  }
  const { baseType } = type;
  if (baseType === undefined) throw new ProcessingError(`${what} belongs to a variable without a base type.`);
  const primitives = elements
    .map((element) => readPrimitive(element.value, baseType, what))
    .filter((primitive) => !(baseType === "string" && primitive === ""));
  if (type.cardinality !== "single") return container(type.cardinality, baseType, primitives);
  if (elements.length > 1) {
    throw new ProcessingError(`${what} has ${elements.length} values, but its variable is single.`);
  }
  const [primitive] = primitives;
  return primitive === undefined ? null : single(baseType, primitive);
}
