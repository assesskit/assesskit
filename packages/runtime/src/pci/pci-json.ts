import { isRecord } from "../checks.js";
import type { JsonValue } from "../values/index.js";

/**
 * The JSON that a portable custom interaction exchanges for a variable: `{ "base": ... }` for a single value,
 * `{ "list": ... }` for a container and `{ "record": ... }` for a record.
 *
 * @remarks
 * A file is `{ "data", "mime", "name" }` with the bytes in `data` as base64.
 *
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, JSON binding of values}
 */
export type PciJson = JsonValue;

/** The properties that name the cardinality in the JSON of a value. */
const CARDINALITY_KEYS = ["base", "list", "record"];

/** Returns whether the JSON is an object with the property that names the cardinality: `base`, `list` or `record`. */
export function isPciJson(json: unknown): json is PciJson {
  return isRecord(json) && CARDINALITY_KEYS.some((key) => Object.hasOwn(json, key));
}
