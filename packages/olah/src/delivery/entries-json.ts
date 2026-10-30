import { checkArray, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { fromWireValue, toWireValue, type Value, type WireValue } from "../values/index.js";

/** A value in the JSON form of a session: its wire value, or `null` for NULL. */
export type ValueJson = WireValue | null;

/** Writes a value with its own type; NULL needs none, because its variable is declared. */
function valueToJson(value: Value | null): ValueJson {
  if (value === null) return null;
  return toWireValue(
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
 * Reads an array of entries `[identifier, value]` into a map, each identifier once.
 *
 * @throws `DataError` when the data is not such an array, or an identifier repeats.
 */
export function readEntries<T>(
  json: unknown,
  label: string,
  read: (value: unknown, identifier: string) => T,
): Map<string, T> {
  checkArray(json, `${label} must be an array of entries`);
  const entries = new Map<string, T>();
  for (const entry of json) {
    checkArray(entry, `An entry of ${label} must be an array of an identifier and a value`);
    const [identifier, value] = entry;
    checkString(identifier, `An identifier of ${label}`);
    if (entry.length !== 2) throw new DataError(`An entry of ${label} must have 2 elements, found ${entry.length}.`);
    if (entries.has(identifier)) throw new DataError(`${label} has the identifier ${describe(identifier)} twice.`);
    entries.set(identifier, read(value, identifier));
  }
  return entries;
}

/**
 * Reads entries that {@link valuesToJson} wrote.
 *
 * @throws `DataError` when the data is not such entries.
 */
export function readValues(json: unknown, label: string): Map<string, Value | null> {
  return readEntries(json, label, (value) => (value === null ? null : fromWireValue(value)));
}
