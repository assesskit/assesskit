import * as v from "valibot";
import { describe, isRecord, parseWith, type Schema, transformWith } from "../checks.js";
import { checkOptions } from "../checks-internal.js";
import { DataError } from "../errors.js";
import { type BaseType, baseTypeSchema, isBaseType } from "./base-type.js";
import { type Cardinality, isCardinality } from "./cardinality.js";
import type { ValueDeclaration } from "./declaration.js";
import { readJsonValue } from "./json-read.js";
import type { JsonValue } from "./json-value.js";
import { writeJsonValue } from "./json-write.js";
import type { Value } from "./value.js";

/**
 * A value in the runtime's own JSON form, for state, views and actions.
 *
 * @remarks
 * It is the JSON of the value in an envelope that names its cardinality and base type, so that it decodes without a
 * declaration and loses nothing. It tells `multiple` from `ordered`, and the NULL of one type from the NULL of another.
 */
export interface WireValue {
  /** The cardinality. */
  readonly cardinality: Cardinality;
  /** The base type. A record has none. */
  readonly baseType?: BaseType;
  /** The JSON of the value as {@link writeJsonValue} writes it, or `null` for NULL. */
  readonly value: JsonValue | null;
}

/** The options of {@link writeWireValue}. */
export interface WriteWireValueOptions {
  /**
   * The cardinality and base type of the variable. They type a NULL, and a value must have them.
   *
   * @defaultValue the cardinality and base type that the value names itself, so that a NULL needs the declaration
   */
  readonly declaration?: ValueDeclaration;
}

/** Returns the declaration that a value names itself; a NULL names none. */
function ownDeclaration(value: unknown): ValueDeclaration {
  if (value === null) {
    throw new DataError("A NULL has no cardinality or base type of its own: pass the option declaration to write it.");
  }
  if (isRecord(value) && value.cardinality === "record") return { cardinality: "record" };
  if (isRecord(value) && isCardinality(value.cardinality) && isBaseType(value.baseType)) {
    return { cardinality: value.cardinality, baseType: value.baseType };
  }
  throw new DataError(`The value must be a value or NULL, found ${describe(value)}.`);
}

/**
 * Writes a value, or NULL, as a {@link WireValue}.
 *
 * @remarks
 * Durations are `PT<seconds>S` and files are references, as in {@link writeJsonValue}. A value names its own cardinality and
 * base type, so it needs no declaration; a NULL needs one.
 *
 * @param value - The value, or `null` for NULL.
 * @param options - See {@link WriteWireValueOptions}.
 * @returns The wire value.
 * @throws `DataError` when `value` is not a value or `null`, the declaration is not one or differs from the value, or
 * `value` is NULL and there is no declaration.
 */
export function writeWireValue(value: Value | null, options: WriteWireValueOptions = {}): WireValue {
  checkOptions(options);
  const { declaration = ownDeclaration(value) } = options;
  const json = writeJsonValue(value, declaration);
  const { cardinality, baseType } = declaration;
  const typed = cardinality === "record" ? { cardinality } : { cardinality, baseType };
  return { ...typed, value: value === null ? null : json };
}

// A record has no base type, so the property is not allowed beside it.
const wireSchema = v.variant("cardinality", [
  v.strictObject({ cardinality: v.literal("record"), value: v.unknown() }),
  v.strictObject({
    cardinality: v.picklist(["multiple", "ordered", "single"]),
    baseType: baseTypeSchema,
    value: v.unknown(),
  }),
]);

/** The schema of a {@link WireValue}, which reads it into a value, or `null` for NULL. */
export const wireValueSchema: Schema<Value | null> = v.pipe(
  wireSchema,
  transformWith((wire) => {
    if (wire.value === null) return null;
    return readJsonValue(wire.value, wire.cardinality === "record" ? { cardinality: "record" } : wire);
  }),
);

/**
 * Reads a value, or NULL, from a {@link WireValue} that {@link writeWireValue} writes.
 *
 * @param json - The parsed JSON.
 * @returns The value, or `null` for NULL.
 * @throws `DataError` when `json` is not a wire value, its value is not one of its cardinality and base type, or it has a
 * duration with years or months.
 */
export function readWireValue(json: unknown): Value | null {
  return parseWith(wireValueSchema, json, "A wire value");
}
