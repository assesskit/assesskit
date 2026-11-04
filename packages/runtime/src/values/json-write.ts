import { DataError } from "../errors.js";
import type { BaseType } from "./base-type.js";
import type { Cardinality } from "./cardinality.js";
import { type Declared, readDeclaration, type ValueDeclaration } from "./declaration.js";
import { formatIsoDuration } from "./duration.js";
import type { JsonValue } from "./json-value.js";
import { formatDouble } from "./lexical.js";
import { isFileValue, isTuple, type Primitive } from "./primitive.js";
import { type ContainerValue, normalizeValue, type RecordValue, type SingleValue, type Value } from "./value.js";

const isPlainNumber = (value: number): boolean => Number.isFinite(value) && !Object.is(value, -0);

function encodePrimitive(baseType: BaseType, primitive: Primitive): unknown {
  if (typeof primitive === "number") {
    if (isPlainNumber(primitive)) return baseType === "duration" ? formatIsoDuration(primitive) : primitive;
    // JSON has no NaN or infinity, and `JSON.stringify` writes them as `null` and `-0` as `0`.
    return formatDouble(primitive);
  }
  if (isTuple(primitive)) return [...primitive];
  if (isFileValue(primitive)) {
    const { reference, mimeType, fileName } = primitive;
    return fileName === undefined ? { reference, mime: mimeType } : { reference, mime: mimeType, name: fileName };
  }
  return primitive;
}

function encodeSingle(value: SingleValue): unknown {
  return { [value.baseType]: encodePrimitive(value.baseType, value.value) };
}

function encodeContainer(value: ContainerValue): unknown {
  return { [value.baseType]: value.values.map((primitive) => encodePrimitive(value.baseType, primitive)) };
}

function encodeRecord(value: RecordValue): unknown {
  return [...value.fields].map(([name, field]) => ({ name, base: encodeSingle(field) }));
}

/** The JSON of NULL for a cardinality: the JSON alone does not say which of the three it is. */
function nullJson(cardinality: Cardinality): JsonValue {
  if (cardinality === "single") return { base: null };
  return cardinality === "record" ? { record: null } : { list: null };
}

function describeKind(value: Declared | Value): string {
  return value.cardinality === "record" ? "a record" : `${value.cardinality} ${value.baseType}`;
}

/**
 * Writes a value in the JSON binding of the best practices guide, which portable custom interactions use.
 *
 * @remarks
 * The binding is that of the guide with these differences:
 *
 * - A `file` is `{ "reference", "mime", "name" }`, a reference to the bytes, instead of `{ "data", "mime", "name" }` with
 *   the bytes inline. `name` is left out when the file has none.
 * - A `duration` is `PT<seconds>S` with the shortest decimal for the seconds, never with years or months.
 * - A `float` or `duration` that JSON cannot carry, `NaN`, `INF`, `-INF` and `-0`, is the string with that spelling.
 * - NULL needs the declaration, as `{ "base": null }`, `{ "list": null }` and `{ "record": null }` differ by cardinality.
 *
 * @param value - The value, or `null` for NULL.
 * @param declaration - The cardinality and base type of the variable; the value must have them.
 * @returns The JSON.
 * @throws `DataError` when `value` is not a value or `null`, `declaration` is not a declaration, or they differ.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, JSON binding}
 */
export function writeJsonValue(value: Value | null, declaration: ValueDeclaration): JsonValue {
  const declared = readDeclaration(declaration);
  if (value === null) return nullJson(declared.cardinality);
  const checked = normalizeValue(value);
  const differs =
    checked.cardinality !== declared.cardinality ||
    (checked.cardinality !== "record" && declared.cardinality !== "record" && checked.baseType !== declared.baseType);
  if (differs) {
    throw new DataError(`The value is ${describeKind(checked)}, but the declaration says ${describeKind(declared)}.`);
  }
  if (checked.cardinality === "single") return { base: encodeSingle(checked) };
  return checked.cardinality === "record" ? { record: encodeRecord(checked) } : { list: encodeContainer(checked) };
}
