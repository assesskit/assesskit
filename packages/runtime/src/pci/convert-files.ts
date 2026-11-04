import { isRecord } from "../checks.js";
import type { JsonValue } from "../values/index.js";

type Convert = (file: unknown) => unknown;

/** Applies `convert` to the content of a typed object `{ "<base type>": ... }` when it holds a file. */
function convertTyped(typed: unknown, convert: Convert): unknown {
  return isRecord(typed) && Object.hasOwn(typed, "file") ? { ...typed, file: convert(typed.file) } : typed;
}

/** Applies `convert` to every file of a list `{ "file": [...] }`. */
function convertList(typed: unknown, convert: Convert): unknown {
  return isRecord(typed) && Array.isArray(typed.file) ? { ...typed, file: typed.file.map(convert) } : typed;
}

/** Applies `convert` to the file of every field of a record `[{ "name", "base" }, ...]` that has one. */
function convertFields(fields: unknown, convert: Convert): unknown {
  if (!Array.isArray(fields)) return fields;
  return fields.map((field) => (isRecord(field) ? { ...field, base: convertTyped(field.base, convert) } : field));
}

/**
 * Applies `convert` to every file in the JSON of a value, wherever the binding puts one.
 *
 * @remarks
 * Other properties are kept.
 *
 * @param json - The JSON of a value.
 * @param convert - Turns the JSON of one file into the JSON of another form of it.
 * @returns A copy of `json` with each file converted.
 */
export function convertFiles(json: JsonValue, convert: Convert): JsonValue {
  if ("base" in json) return { ...json, base: convertTyped(json.base, convert) };
  if ("list" in json) return { ...json, list: convertList(json.list, convert) };
  return { ...json, record: convertFields(json.record, convert) };
}
