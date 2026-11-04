/**
 * Checks of one value that throw `DataError` with a full sentence, and the schemas that read JSON with valibot, which the
 * runtime and the packages built on it share.
 *
 * @module @assesskit/runtime/checks
 */
import * as v from "valibot";
import { DataError } from "./errors.js";

/**
 * Describes a value in a message: strings quoted; arrays, functions and other objects as "an array", "a function" and
 * "an object"; other values as `String` prints them.
 */
export function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "an array";
  if (typeof value === "function") return "a function";
  if (typeof value === "object" && value !== null) return "an object";
  return String(value);
}

/** Returns whether a value is an object that is neither `null` nor an array. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks that a value is a record, such as a set of limits.
 *
 * @param message - Says what the value should be, such as `The limits must be an object`.
 * @throws `DataError` when it is not.
 */
export function checkRecord(value: unknown, message: string): asserts value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new DataError(`${message}, found ${describe(value)}.`);
}

/**
 * Checks that a value is an array without holes, such as a list of issues.
 *
 * @remarks
 * A hole, an index below the length that holds no element, as `new Array(3)` and `[1, , 2]` have, is no value of the array
 * that JSON gives, and `forEach`, `map` and `every` skip it unseen: it is refused.
 *
 * @param message - Says what the value should be, such as `The issues must be an array`.
 * @throws `DataError` when it is not an array, or has a hole.
 */
export function checkArray(value: unknown, message: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new DataError(`${message}, found ${describe(value)}.`);
  for (let index = 0; index < value.length; index++) {
    if (!(index in value)) throw new DataError(`${message}, found an array with a hole at index ${index}.`);
  }
}

/**
 * Applies a check to an optional field: `undefined` is absent, and every other value, `null` included, is checked.
 *
 * @param value - The field.
 * @param check - The check, which throws when the value is not valid.
 * @returns The field.
 */
export function checkOptional<T>(value: T | undefined, check: (value: T) => void): T | undefined {
  if (value !== undefined) check(value);
  return value;
}

/**
 * Checks that a record has no property but the given ones.
 *
 * @param label - Names the record in the error message, such as `An action envelope`.
 * @param known - The names of the properties it may have.
 * @throws `DataError` when it has another property.
 */
export function checkProperties(
  value: Readonly<Record<string, unknown>>,
  label: string,
  known: readonly string[],
): void {
  const unexpected = Object.keys(value).find((key) => !known.includes(key));
  if (unexpected === undefined) return;
  const quoted = known.map((key) => JSON.stringify(key));
  const names =
    quoted.length === 1
      ? `the property ${quoted[0]}`
      : `the properties ${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
  throw new DataError(`${label} has ${names}, found ${describe(unexpected)}.`);
}

/**
 * Checks that a value is a function, such as a resolver.
 *
 * @param message - Says what the value should be, such as `The option resolve must be a function of an href and a base`.
 * @throws `DataError` when it is not.
 */
export function checkFunction(value: unknown, message: string): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") throw new DataError(`${message}, found ${describe(value)}.`);
}

/**
 * Checks that a value is a string, such as an href.
 *
 * @param label - Names the value in the error message, such as `The option path`.
 * @throws `DataError` when it is not.
 */
export function checkString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new DataError(`${label} must be a string, found ${describe(value)}.`);
}

/**
 * Checks that a value is a string of at least one character, such as an identifier.
 *
 * @param label - Names the value in the error message, such as `The session of a caller`.
 * @throws `DataError` when it is not.
 */
export function checkNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value === "") {
    throw new DataError(`${label} must be a non-empty string, found ${describe(value)}.`);
  }
}

/**
 * Checks that a value is an `AbortSignal`, such as the option that ends a wait.
 *
 * @param label - Names the value in the error message, such as `The option signal`.
 * @throws `DataError` when it is not.
 */
export function checkAbortSignal(value: unknown, label: string): asserts value is AbortSignal {
  if (!(value instanceof AbortSignal))
    throw new DataError(`${label} must be an AbortSignal, found ${describe(value)}.`);
}

/**
 * Ends the wait for a promise when a signal aborts. The promise itself goes on.
 *
 * @param promise - What the caller waits for.
 * @param options - The `signal` of the caller. Without one the promise is returned as it is.
 * @returns The promise, or a promise that rejects with `signal.reason` as soon as the signal aborts.
 */
export function raceAbort<T>(promise: Promise<T>, options?: { readonly signal?: AbortSignal }): Promise<T> {
  const signal = options?.signal;
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Checks that a value is a boolean.
 *
 * @param label - Names the value in the error message, such as `The option allowLateSubmission`.
 * @throws `DataError` when it is not.
 */
export function checkBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new DataError(`${label} must be a boolean, found ${describe(value)}.`);
}

/**
 * Checks that a value is one of the given strings.
 *
 * @param label - Names the value in the error message, such as `The option severity`.
 * @throws `DataError` when it is not.
 */
export function checkChoice<T extends string>(
  value: unknown,
  label: string,
  choices: readonly T[],
): asserts value is T {
  if (!choices.some((choice) => choice === value)) {
    const quoted = choices.map((choice) => JSON.stringify(choice));
    const list = `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
    throw new DataError(`${label} must be ${list}, found ${describe(value)}.`);
  }
}

/**
 * Checks that a value is a safe integer of at least 0, such as a count.
 *
 * @param label - Names the value in the error message, such as `The option maxAttempts`.
 * @throws `DataError` when it is not.
 */
export function checkNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
    throw new DataError(`${label} must be a non-negative integer, found ${describe(value)}.`);
  }
}

/**
 * Checks that a value is a finite number greater than 0, such as a length.
 *
 * @param label - Names the value in the error message, such as `The property minimumLength`.
 * @throws `DataError` when it is not.
 */
export function checkPositive(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) {
    throw new DataError(`${label} must be a positive number, found ${describe(value)}.`);
  }
}

/**
 * Checks that a value is a safe integer of at least 1, such as a size limit.
 *
 * @param label - Names the value in the error message, such as `The option maxBytes`.
 * @throws `DataError` when it is not.
 */
export function checkPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isSafeInteger(value) && value >= 1)) {
    throw new DataError(`${label} must be a positive integer, found ${describe(value)}.`);
  }
}

/** A schema of unknown JSON whose output is `TOutput`. */
export type Schema<TOutput> = v.GenericSchema<unknown, TOutput>;

/** What a schema type expects, in the words of a message; a type not listed shows the `expected` that valibot gives. */
const EXPECTED_WORDS: ReadonlyMap<string, string> = new Map([
  ["string", "a string"],
  ["number", "a number"],
  ["boolean", "true or false"],
  ["array", "an array"],
  ["tuple", "an array"],
  ["strict_tuple", "an array"],
  ["object", "an object"],
  ["strict_object", "an object"],
  ["loose_object", "an object"],
  ["record", "an object"],
  ["safe_integer", "a safe integer"],
  ["integer", "an integer"],
  ["finite", "a finite number"],
  ["non_empty", "a length of at least 1"],
]);

/** What valibot calls an object, an array and a function in `expected` and `received`, in the words of a message. */
const CLASS_WORDS: ReadonlyMap<string, string> = new Map([
  ["Object", "an object"],
  ["Array", "an array"],
  ["Function", "a function"],
]);

/** The comparisons of the validations, with the words that stand for them. */
const COMPARISONS: ReadonlyMap<string, string> = new Map([
  ["min_value", "a value of at least"],
  ["max_value", "a value of at most"],
  ["min_length", "a length of at least"],
  ["max_length", "a length of at most"],
]);

/** The start of every message that valibot makes; a schema or an action given a message of its own has another start. */
const DEFAULT_MESSAGE = "Invalid ";

/** Returns the path of an issue as code writes it, such as `items[0].session.status`. */
function pathOf(path: readonly v.IssuePathItem[] | undefined): string {
  let text = "";
  for (const { key } of path ?? []) {
    if (typeof key === "number") text += `[${key}]`;
    else if (/^[A-Za-z_$][\w$]*$/u.test(String(key))) text += text === "" ? String(key) : `.${String(key)}`;
    else text += `[${JSON.stringify(key)}]`;
  }
  return text;
}

/** Returns what an issue expected, from its type or from the `expected` that valibot gives. */
function expectedOf(issue: v.BaseIssue<unknown>): string {
  const classWords = CLASS_WORDS.get(issue.expected ?? "");
  if (classWords !== undefined) return classWords;
  const comparison = COMPARISONS.get(issue.type);
  const operand = issue.expected?.replace(/^[<>=!]+/u, "");
  if (comparison !== undefined && operand !== undefined) return `${comparison} ${operand}`;
  const words = EXPECTED_WORDS.get(issue.type);
  if (words !== undefined) return words;
  const parts = (issue.expected ?? issue.message).replace(/[()]/gu, "").split(" | ");
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} or ${parts.at(-1)}`;
}

/** Returns what an issue found: valibot names an object and an array by their classes. */
function foundOf(issue: v.BaseIssue<unknown>): string {
  return CLASS_WORDS.get(issue.received) ?? issue.received;
}

/** The types of the schemas of objects, which make the issues of a missing and an unexpected property. */
const OBJECT_TYPES: ReadonlySet<string> = new Set(["object", "strict_object", "loose_object"]);

/** Returns the detail of an issue, and whether it is about a property, so that the path stops at the object. */
function detailOf(issue: v.BaseIssue<unknown>): { readonly text: string; readonly property: boolean } {
  if (!issue.message.startsWith(DEFAULT_MESSAGE)) return { text: issue.message.replace(/\.$/u, ""), property: false };
  // valibot reads an array as an object, and then finds its properties missing.
  const last = issue.path?.at(-1);
  if (OBJECT_TYPES.has(issue.type) && last?.type === "object" && Array.isArray(last.input)) {
    return { text: "expected an object, found an array", property: true };
  }
  if (OBJECT_TYPES.has(issue.type) && issue.expected === "never") {
    return { text: `unexpected property ${issue.received}`, property: true };
  }
  if (issue.type === "strict_tuple" && issue.expected === "never") {
    return { text: "unexpected element", property: false };
  }
  if (OBJECT_TYPES.has(issue.type) && issue.received === "undefined" && issue.expected === JSON.stringify(last?.key)) {
    return { text: `missing the property ${issue.expected}`, property: true };
  }
  return { text: `expected ${expectedOf(issue)}, found ${foundOf(issue)}`, property: false };
}

/** Returns where an issue is, as {@link pathOf} writes it, and what is wrong there. */
function locate(issue: v.BaseIssue<unknown>): { readonly path: string; readonly text: string } {
  const { text, property } = detailOf(issue);
  return { path: pathOf(property ? issue.path?.slice(0, -1) : issue.path), text };
}

/** Writes a `DataError` for the first issue of a parse. */
function toError(issue: v.BaseIssue<unknown>, label: string): DataError {
  const { path, text } = locate(issue);
  return new DataError(`${label} is invalid${path === "" ? "" : ` at ${path}`}: ${text}.`);
}

/** Returns what is wrong with a nested value for the message of an issue of the schema that parsed it, with its path. */
export function describeIssue(issue: v.BaseIssue<unknown>): string {
  const { path, text } = locate(issue);
  return path === "" ? text : `${path}: ${text}`;
}

/**
 * Parses untrusted data with a schema, and stops at the first issue.
 *
 * @param schema - What the data should be.
 * @param label - Names the data in the error message, such as `The action`.
 * @returns The data, as the schema reads it.
 * @throws `DataError` that names the path of the first issue and what was expected there.
 */
export function parseWith<TSchema extends v.GenericSchema>(
  schema: TSchema,
  input: unknown,
  label: string,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, input, { abortEarly: true });
  const [issue] = result.issues ?? [];
  if (issue !== undefined) throw toError(issue, label);
  return result.output;
}

/**
 * Reads data with code of the domain that throws `DataError`, in a step of a schema: the error becomes an issue at the
 * path of the data.
 *
 * @param read - Reads the data that the steps before it accept.
 */
export function transformWith<TInput, TOutput>(
  read: (input: TInput) => TOutput,
): v.RawTransformAction<TInput, TOutput> {
  return v.rawTransform(({ dataset, addIssue, NEVER }) => {
    try {
      return read(dataset.value);
    } catch (error) {
      if (!(error instanceof DataError)) throw error;
      addIssue({ message: error.message });
      return NEVER;
    }
  });
}

/**
 * The schema of a value that a guard accepts, which it passes on whole: a function, a host's object, a record.
 *
 * @param guard - Tells whether the value is one.
 * @param expected - Says what the value should be, such as `an object`.
 */
export function guardSchema<TOutput>(guard: (value: unknown) => value is TOutput, expected: string): Schema<TOutput> {
  return v.custom<TOutput>(guard, (issue) => `expected ${expected}, found ${foundOf(issue)}`);
}

/**
 * The schema of a record. In front of an object schema whose entries are all optional it refuses an array, which valibot
 * reads as an object.
 */
export const recordSchema = guardSchema(isRecord, "an object");

/**
 * The schema of an object with the given entries, that keeps the properties it does not know. Unlike the object of
 * valibot it refuses an array, whatever the entries.
 */
export function looseRecord<const TEntries extends v.ObjectEntries>(entries: TEntries) {
  return v.pipe(recordSchema, v.looseObject(entries));
}

/**
 * The schema of an object with the given entries and no other property. Unlike the object of valibot it refuses an array,
 * whatever the entries.
 */
export function strictRecord<const TEntries extends v.ObjectEntries>(entries: TEntries) {
  return v.pipe(recordSchema, v.strictObject(entries));
}

/**
 * The schema of an object whose property names are data, such as module ids or asset prefixes: every own property is read
 * into a map, `__proto__` included, which the record of valibot would skip.
 *
 * @param value - The schema of the value of a property.
 */
export function mapSchema<TOutput>(value: Schema<TOutput>): Schema<Map<string, TOutput>> {
  return v.pipe(
    recordSchema,
    v.rawTransform(({ dataset, addIssue, NEVER }) => {
      const entries = new Map<string, TOutput>();
      for (const [name, member] of Object.entries(dataset.value)) {
        const result = v.safeParse(value, member, { abortEarly: true });
        if (!result.success) {
          const { path, text } = locate(result.issues[0]);
          addIssue({
            message: `the property ${JSON.stringify(name)}${path === "" ? "" : ` at ${path}`} is invalid: ${text}`,
          });
          return NEVER;
        }
        entries.set(name, result.output);
      }
      return entries;
    }),
  );
}

/** A finite number. */
export const finiteSchema = v.pipe(v.number(), v.finite());

/** A safe integer of at least 0, such as a count. */
export const nonNegativeIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

/** A safe integer of at least 1, such as a size limit. */
export const positiveIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1));

/** A string of at least one character, such as an identifier. */
export const nonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());

/** A value that is not `undefined`: a property that must be present, whatever it holds. */
export const definedSchema = v.nonOptional(v.unknown(), "expected a value, found undefined");

/**
 * The schema of a function, such as a listener or a host's callback. Only that it is a function is checked: its
 * parameters and result are the host's to keep.
 *
 * @typeParam TFunction - The type of the function.
 */
export function functionSchema<TFunction extends (...args: never[]) => unknown>(): Schema<TFunction> {
  return guardSchema((value): value is TFunction => typeof value === "function", "a function");
}

/**
 * The schema of a host's object with functions, such as a store or an engine. Only that each is a function is checked:
 * the object passes on whole, so a class instance keeps its methods.
 *
 * @typeParam TObject - The type of the object.
 * @param names - The names of the functions it must have.
 */
export function methodsSchema<TObject extends object>(...names: readonly (keyof TObject & string)[]): Schema<TObject> {
  const list = `${names.slice(0, -1).join(", ")}${names.length > 1 ? " and " : ""}${names.at(-1)}`;
  return guardSchema(
    (value): value is TObject => isRecord(value) && names.every((name) => typeof value[name] === "function"),
    `an object with the function${names.length > 1 ? "s" : ""} ${list}`,
  );
}

/** A finite number greater than 0, such as a length. */
export const positiveSchema = v.pipe(
  v.number(),
  v.finite(),
  v.check(
    (number) => number > 0,
    (issue) => `expected a positive number, found ${issue.received}`,
  ),
);
