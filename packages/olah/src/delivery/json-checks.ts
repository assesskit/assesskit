import { checkArray, checkRecord, describe, isRecord } from "../checks.js";
import { DataError } from "../errors.js";

/** The depth of nesting that JSON content may have: the depth the XML reader allows (`DEFAULT_XML_LIMITS.maxDepth`). */
const MAX_JSON_DEPTH = 256;

/** Returns the list of names for a message: `"a"`, `"a" and "b"`, or `"a", "b" and "c"`. */
function listOf(names: readonly string[]): string {
  const quoted = names.map((name) => JSON.stringify(name));
  return quoted.length < 2 ? quoted.join("") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/**
 * Checks that JSON is an object with the properties of its form: every required one, and no other than the optional
 * ones, so that nothing is smuggled in beside what the form carries.
 *
 * @param label - Names the object in the message, such as `The view`.
 * @throws `DataError` when it is not.
 */
export function checkShape(
  json: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): asserts json is Readonly<Record<string, unknown>> {
  checkRecord(json, `${label} must be an object`);
  const unexpected = Object.keys(json).find((key) => !required.includes(key) && !optional.includes(key));
  if (unexpected !== undefined) {
    const names = [...required, ...optional];
    throw new DataError(
      `${label} has the ${names.length === 1 ? "property" : "properties"} ${listOf(names)}, found ${describe(unexpected)}.`,
    );
  }
  const missing = required.find((key) => json[key] === undefined);
  if (missing !== undefined) throw new DataError(`${label} must have the property ${describe(missing)}.`);
}

/** Whether a value is an object that `JSON.parse` makes: a prototype of `Object` or none. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Checks that a value is JSON data that survives `JSON.stringify` and `JSON.parse` as it is: strings, finite numbers,
 * booleans, arrays and plain objects, nested at most {@link MAX_JSON_DEPTH} levels. A property that is `undefined` is
 * absent in JSON, so it passes; `null` does not, because the content of a view has no NULL.
 *
 * @param label - Names the data in the message.
 * @throws `DataError` when it is not.
 */
export function checkPlain(value: unknown, label: string, depth = 0): void {
  if (value === undefined || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DataError(`${label} holds ${String(value)}, which JSON cannot carry.`);
    return;
  }
  if (depth >= MAX_JSON_DEPTH) throw new DataError(`${label} nests deeper than ${MAX_JSON_DEPTH} levels.`);
  if (Array.isArray(value)) {
    for (const entry of value) checkPlain(entry, label, depth + 1);
    return;
  }
  if (isPlainObject(value)) {
    if (Object.hasOwn(value, "__proto__")) throw new DataError(`${label} holds an object with a property "__proto__".`);
    for (const entry of Object.values(value)) checkPlain(entry, label, depth + 1);
    return;
  }
  throw new DataError(
    `${label} must hold only strings, finite numbers, booleans, arrays and objects, found ${describe(value)}.`,
  );
}

/**
 * Checks content that a view carries: an array of nodes of the content model, each an object with a `kind`, whose
 * properties are plain JSON data.
 *
 * @param label - Names the content in the message, such as `The body of the item`.
 * @throws `DataError` when it is not.
 */
export function checkNodes(nodes: unknown, label: string): void {
  checkArray(nodes, `${label} must be an array of nodes`);
  for (const node of nodes) {
    if (!isRecord(node) || typeof node.kind !== "string") {
      throw new DataError(`${label} must hold nodes, each an object with a string kind, found ${describe(node)}.`);
    }
  }
  checkPlain(nodes, label);
}
