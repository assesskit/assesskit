// The checks of one value that only the runtime uses, and the message of a thrown value. `checks.ts` holds the checks that the
// player shares.
import * as v from "valibot";
import { checkProperties, checkRecord, describe, positiveIntegerSchema, type Schema, strictRecord } from "./checks.js";
import { DataError } from "./errors.js";

/**
 * Checks that options are an object that has no property but the given ones.
 *
 * @remarks
 * A function that every item, node or element goes through reads its options with this and not with a schema, which takes
 * three to five times as long: the budgets of the benchmarks hold the work of one item to a few microseconds.
 *
 * @param options - The options, as a caller passes them from JavaScript.
 * @param known - The names of the options that the function takes.
 * @throws `DataError` when they are not an object, or have another property.
 */
export function checkOptionNames(options: unknown, known: readonly string[]): void {
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", known);
}

/**
 * Checks that a value is bytes, such as the content of a file.
 *
 * @param label - Names the value in the error message, such as `The file settings`.
 * @throws `DataError` when it is not a `Uint8Array`.
 */
export function checkBytes(value: unknown, label: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) throw new DataError(`${label} must be a Uint8Array, found ${describe(value)}.`);
}

/**
 * Checks that a value is a finite number.
 *
 * @param label - Names the value in the error message, such as `The option tolerance`.
 * @throws `DataError` when it is not.
 */
export function checkFinite(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isFinite(value))) {
    throw new DataError(`${label} must be a finite number, found ${describe(value)}.`);
  }
}

/**
 * Checks that a value is a finite number of at least 0.
 *
 * @param label - Names the value in the error message, such as `The option minTime`.
 * @throws `DataError` when it is not.
 */
export function checkNonNegative(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isFinite(value) && value >= 0)) {
    throw new DataError(`${label} must be a non-negative number, found ${describe(value)}.`);
  }
}

/**
 * Returns what an error says, or the text of a thrown value that is no `Error`, such as a string that a host function throws.
 *
 * @param error - What a `catch` clause caught.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Checks a seed.
 *
 * @throws `DataError` when it is not a safe integer.
 */
export function checkSeed(seed: unknown): asserts seed is number {
  if (!(typeof seed === "number" && Number.isSafeInteger(seed))) {
    throw new DataError(`A seed must be a safe integer, found ${describe(seed)}.`);
  }
}

/** A seed: a safe integer. */
export const seedSchema = v.pipe(v.number(), v.safeInteger());

/** A finite number of at least 0. */
export const nonNegativeSchema = v.pipe(v.number(), v.finite(), v.minValue(0));

/**
 * The schema of the limits that a caller sets: each a positive integer of at most its cap. A name that is not a limit is
 * refused, so that a misspelled limit never passes unseen.
 *
 * @remarks
 * A limit left out has its default in the output, and the limits of a caller who sets none are one frozen object, so that the
 * options that hold them read quickly: a reader that sits on the path of every item, or of every element, would otherwise
 * build the limits at each call. An option that holds the limits is `v.optional(schema)`, whose absence a transform of the
 * options turns into the defaults.
 *
 * @param defaults - The limits as they are when the caller sets none; its names are the limits.
 * @param caps - The most a caller may set for a limit; a limit not named has no cap.
 * @param names - The limits that the caller may set, if not all of them.
 * @returns A schema whose output is every limit, frozen.
 */
export function limitsSchema<TLimits extends Readonly<Record<keyof TLimits, number>>>(
  defaults: TLimits,
  caps?: Readonly<Partial<Record<keyof TLimits, number>>>,
  names: readonly string[] = Object.keys(defaults),
): Schema<Readonly<TLimits>> {
  const entries: Record<string, v.GenericSchema> = {};
  for (const name of names) {
    const cap: unknown = caps === undefined ? undefined : Reflect.get(caps, name);
    entries[name] = v.optional(
      typeof cap === "number" ? v.pipe(positiveIntegerSchema, v.maxValue(cap)) : positiveIntegerSchema,
    );
  }
  const unset: Readonly<TLimits> = Object.freeze({ ...defaults });
  return v.pipe(
    strictRecord(entries),
    v.transform((given): Readonly<TLimits> => {
      const set: Record<string, number> = {};
      let any = false;
      for (const name of names) {
        const value: unknown = given[name];
        if (typeof value === "number") {
          set[name] = value;
          any = true;
        }
      }
      return any ? Object.freeze({ ...defaults, ...set }) : unset;
    }),
  );
}
