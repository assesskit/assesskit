import { describe } from "../checks.js";
import { DataError } from "../errors.js";

/** Orders two property names by their UTF-16 code units, as RFC 8785 sorts them. */
function byCodeUnits([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Writes plain data as the JSON Canonicalization Scheme writes it: the properties of an object sorted by the UTF-16 code
 * units of their names, no white space, strings and numbers as ECMAScript's `JSON.stringify` writes them, so that equal
 * data gives equal text. A `Map` is written as the object of its entries.
 *
 * @throws `DataError` for a number that is not finite, or a value that JSON does not hold.
 * @see {@link https://www.rfc-editor.org/rfc/rfc8785 | RFC 8785, JSON Canonicalization Scheme}
 */
export function writeCanonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DataError(`The number ${value} has no JSON form.`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item: unknown) => writeCanonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = (value instanceof Map ? [...value] : Object.entries(value)).filter(
      ([, item]) => item !== undefined,
    );
    entries.sort(byCodeUnits);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${writeCanonicalJson(item)}`).join(",")}}`;
  }
  throw new DataError(`${describe(value)} has no JSON form.`);
}
