import { checkArray, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { type BaseType, checkBaseType } from "./base-type.js";
import { checkCardinality } from "./cardinality.js";
import { isIdentifier } from "./identifier.js";
import { normalizePrimitive } from "./normalize-primitive.js";
import type { FileValue, Primitive } from "./primitive.js";

/**
 * A value of cardinality `single`: one value of a base type.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, cardinality}
 */
export interface SingleValue {
  /** The cardinality, `single`. */
  readonly cardinality: "single";
  /** The base type of the value. */
  readonly baseType: BaseType;
  /** The value. */
  readonly value: Primitive;
}

/** A value of cardinality `multiple` or `ordered`: values of one base type, never empty. */
export interface ContainerValue {
  /** The cardinality: an unordered or an ordered container. */
  readonly cardinality: "multiple" | "ordered";
  /** The base type of every value. */
  readonly baseType: BaseType;
  /** The values. An empty container is NULL, so there is at least one. */
  readonly values: readonly Primitive[];
}

/** A value of cardinality `record`: single values, each with its own base type. */
export interface RecordValue {
  /** The cardinality, `record`. */
  readonly cardinality: "record";
  /** The fields by their identifiers, in insertion order. An empty record is NULL, so there is at least one. */
  readonly fields: ReadonlyMap<string, SingleValue>;
}

/**
 * A value of a variable.
 *
 * @remarks
 * NULL, the absence of a value, is `null` and not a `Value`: no value is empty. Build values with {@link buildSingle},
 * {@link buildContainer} and {@link buildRecord}, which return `null` for what is NULL.
 */
export type Value = SingleValue | ContainerValue | RecordValue;

// The typed signatures of `buildSingle`, `buildContainer` and `buildRecord` serve callers that hold typed data. The readers
// of JSON and `normalizeValue` hold untrusted data, so they use the `buildUntrusted...` forms, which take `unknown` and
// check everything.

/** The empty string is NULL, so a value of base type `string` cannot be empty. */
const isNullString = (baseType: BaseType, primitive: Primitive): boolean => baseType === "string" && primitive === "";

/**
 * Builds a single value from untrusted arguments.
 *
 * @returns The value, or `null` for the empty string.
 * @throws `DataError` when `baseType` is not a base type or `value` is not a value of it.
 */
export function buildUntrustedSingle(baseType: unknown, value: unknown): SingleValue | null {
  checkBaseType(baseType);
  const primitive = normalizePrimitive(baseType, value);
  return isNullString(baseType, primitive) ? null : { cardinality: "single", baseType, value: primitive };
}

/**
 * Builds a value of cardinality `single`. The value is copied.
 *
 * @param baseType - The base type.
 * @param value - A value of the base type: a boolean; an integer as a safe integer; a float or a duration in seconds as
 * a number; a string, identifier or uri as a string; a point as `[x, y]`; a pair or directed pair as two identifiers; a
 * file as a {@link FileValue}.
 * @returns The value, or `null` when `baseType` is `string` and `value` is empty: the empty string is NULL.
 * @throws `DataError` when `baseType` is not a base type or `value` is not a value of it.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, NULL}
 */
export function buildSingle(baseType: Exclude<BaseType, "string">, value: Primitive): SingleValue;
export function buildSingle(baseType: BaseType, value: Primitive): SingleValue | null;
export function buildSingle(baseType: BaseType, value: Primitive): SingleValue | null {
  return buildUntrustedSingle(baseType, value);
}

/**
 * Builds a container from untrusted arguments.
 *
 * @returns The container, or `null` when there are no values.
 * @throws `DataError` when an argument is not valid.
 */
export function buildUntrustedContainer(
  cardinality: unknown,
  baseType: unknown,
  values: unknown,
): ContainerValue | null {
  if (cardinality !== "multiple" && cardinality !== "ordered") {
    throw new DataError(
      `The cardinality of a container must be "multiple" or "ordered", found ${describe(cardinality)}.`,
    );
  }
  checkBaseType(baseType);
  checkArray(values, "The values of a container must be an array");
  if (values.length === 0) return null;
  const copy = Array.from(values, (item) => {
    const primitive = normalizePrimitive(baseType, item);
    if (isNullString(baseType, primitive))
      throw new DataError("A container cannot hold an empty string, which is NULL.");
    return primitive;
  });
  return { cardinality, baseType, values: copy };
}

/**
 * Builds a value of cardinality `multiple` or `ordered`. The values are copied.
 *
 * @param cardinality - `multiple` or `ordered`.
 * @param baseType - The base type of every value.
 * @param values - The values, as {@link buildSingle} takes them. None may be an empty string, which is NULL.
 * @returns The container, or `null` when there are no values: an empty container is NULL.
 * @throws `DataError` when an argument is not valid.
 */
export function buildContainer(
  cardinality: "multiple" | "ordered",
  baseType: BaseType,
  values: readonly Primitive[],
): ContainerValue | null {
  return buildUntrustedContainer(cardinality, baseType, values);
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, Symbol.iterator) === "function";
}

/** Builds a single value that is a field of a record, or the value of `normalizeValue`, from untrusted data. */
function buildField(label: string, field: unknown): SingleValue {
  checkRecord(field, `${label} must be a single value`);
  if (field.cardinality !== "single") {
    throw new DataError(`${label} must be a single value, found the cardinality ${describe(field.cardinality)}.`);
  }
  const built = buildUntrustedSingle(field.baseType, field.value);
  if (built === null) throw new DataError(`${label} cannot be an empty string, which is NULL.`);
  return built;
}

/**
 * Builds a record from untrusted arguments.
 *
 * @returns The record, or `null` when there are no fields.
 * @throws `DataError` when `fields` is not an iterable of pairs of an identifier and a single value, or repeats an
 * identifier.
 */
export function buildUntrustedRecord(fields: unknown): RecordValue | null {
  if (!isIterable(fields)) {
    const expected = "an iterable of pairs of an identifier and a single value";
    throw new DataError(`The fields of a record must be ${expected}, found ${describe(fields)}.`);
  }
  const built = new Map<string, SingleValue>();
  for (const entry of fields) {
    if (!(Array.isArray(entry) && entry.length === 2 && isIdentifier(entry[0]))) {
      throw new DataError(
        `A field of a record must be an array of an identifier and a single value, found ${describe(entry)}.`,
      );
    }
    const name: string = entry[0];
    if (built.has(name)) throw new DataError(`A record cannot have the field ${describe(name)} twice.`);
    built.set(name, buildField(`The field ${describe(name)} of a record`, entry[1]));
  }
  return built.size === 0 ? null : { cardinality: "record", fields: built };
}

/**
 * Builds a value of cardinality `record`. The fields are copied and keep their order.
 *
 * @param fields - Pairs of a field identifier and its single value. Each identifier occurs once.
 * @returns The record, or `null` when there are no fields: an empty record is NULL.
 * @throws `DataError` when `fields` is not an iterable of such pairs.
 */
export function buildRecord(fields: Iterable<readonly [string, SingleValue]>): RecordValue | null {
  return buildUntrustedRecord(fields);
}

/**
 * Checks a value deeply and returns a copy of it.
 *
 * @param value - Untrusted data that should be a {@link Value}, such as a value that a host passes in.
 * @returns A copy that shares nothing with `value`.
 * @throws `DataError` when `value` is not a value, including a container or record with nothing in it.
 */
export function normalizeValue(value: unknown): Value {
  checkRecord(value, "A value must be an object");
  checkCardinality(value.cardinality);
  const built =
    value.cardinality === "single"
      ? buildField("A single value", value)
      : value.cardinality === "record"
        ? buildUntrustedRecord(value.fields instanceof Map ? value.fields : undefined)
        : buildUntrustedContainer(value.cardinality, value.baseType, value.values);
  if (built === null) throw new DataError("A value cannot be empty; the absence of a value is null.");
  return built;
}
