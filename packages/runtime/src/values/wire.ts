import * as v from "valibot";
import { parseWith, type Schema, transformWith } from "../checks.js";
import { type BaseType, baseTypeSchema } from "./base-type.js";
import type { Cardinality } from "./cardinality.js";
import { fromJsonValue, type JsonValue, toJsonValue, type ValueDeclaration } from "./json.js";
import type { Value } from "./value.js";

/**
 * A value in the runtime's own JSON form, for state, views and actions: the App. C JSON of the value in an envelope that names
 * its cardinality and base type, so that it decodes without a declaration and loses nothing. It tells `multiple` from
 * `ordered`, and the NULL of one type from the NULL of another.
 */
export interface WireValue {
  /** The cardinality. */
  readonly cardinality: Cardinality;
  /** The base type; a record has none. */
  readonly baseType?: BaseType;
  /** The App. C JSON of the value, or `null` for NULL. */
  readonly value: JsonValue | null;
}

/**
 * Writes a value, or NULL, as a {@link WireValue}. Durations are `PT<seconds>S` and files are references, as in
 * {@link toJsonValue}.
 *
 * @param value - The value, or `null` for NULL.
 * @param declaration - The cardinality and base type of the variable; they type a NULL, and a value must have them.
 * @throws `DataError` when `value` is not a value or `null`, `declaration` is not a declaration, or they differ.
 */
export function toWireValue(value: Value | null, declaration: ValueDeclaration): WireValue {
  const json = toJsonValue(value, declaration);
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
    return fromJsonValue(wire.value, wire.cardinality === "record" ? { cardinality: "record" } : wire);
  }),
);

/**
 * Reads a value, or NULL, from a {@link WireValue} that `toWireValue` writes.
 *
 * @param json - The parsed JSON.
 * @returns The value, or `null` for NULL.
 * @throws `DataError` when `json` is not a wire value, or its value is not one of its cardinality and base type, or has a
 * duration with years or months (G14).
 */
export function fromWireValue(json: unknown): Value | null {
  return parseWith(wireValueSchema, json, "A wire value");
}
