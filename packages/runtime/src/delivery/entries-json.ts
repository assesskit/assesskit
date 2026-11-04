import * as v from "valibot";
import { describe, type Schema } from "../checks.js";
import type { Value } from "../values/index.js";
import { type WireValue, writeWireValue } from "../values/index.js";
import { wireValueSchema } from "../values/internal.js";

/** A value in the JSON form of a session: its wire value, or `null` for NULL. */
export type ValueJson = WireValue | null;

/** Writes a value with its own type; NULL needs none, because its variable is declared. */
export function valueToJson(value: Value | null): ValueJson {
  if (value === null) return null;
  return writeWireValue(
    value,
    value.cardinality === "record"
      ? { cardinality: "record" }
      : { cardinality: value.cardinality, baseType: value.baseType },
  );
}

/** Writes values by identifier as entries `[identifier, value]`. */
export function valuesToJson(values: ReadonlyMap<string, Value | null>): (readonly [string, ValueJson])[] {
  return [...values].map(([identifier, value]) => [identifier, valueToJson(value)]);
}

/**
 * The schema of an array of entries `[identifier, value]` that reads into a map, each identifier once; an identifier
 * such as `__proto__` stays data.
 *
 * @param value - The schema of the value of an entry.
 */
export function entriesSchema<TOutput>(value: Schema<TOutput>): Schema<Map<string, TOutput>> {
  return v.pipe(
    v.array(v.strictTuple([v.string(), value])),
    v.rawTransform(({ dataset, addIssue, NEVER }) => {
      const entries = new Map<string, TOutput>();
      for (const [identifier, member] of dataset.value) {
        if (entries.has(identifier)) {
          addIssue({ message: `the identifier ${describe(identifier)} occurs twice` });
          return NEVER;
        }
        entries.set(identifier, member);
      }
      return entries;
    }),
  );
}

/** The schema of a value in the JSON form of a session: a wire value, or `null` for NULL. */
export const valueJsonSchema: Schema<Value | null> = v.nullable(wireValueSchema);

/** The schema of values by identifier that {@link valuesToJson} writes. */
export const valuesSchema: Schema<Map<string, Value | null>> = entriesSchema(valueJsonSchema);
