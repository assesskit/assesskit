/** A type guard for the value of a field. */
export type Guard<T> = (value: unknown) => value is T;

/** Reads the fields of one object of a data file, recording what is wrong with them. */
export interface FieldReader {
  /** Returns the field when the guard accepts it; otherwise records that it should be `expected`. */
  required<T>(key: string, guard: Guard<T>, expected: string): T | undefined;
  /** Returns the field when it is absent or the guard accepts it; otherwise records that it should be `expected`. */
  optional<T>(key: string, guard: Guard<T>, expected: string): T | undefined;
  /** Records that the object has none of the fields, such as the fields of another kind of object. */
  absent(keys: readonly string[], reason: string): void;
}

/** Returns whether a value is an object that is neither `null` nor an array. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns whether a value is a string of at least one character. */
export function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** Builds a guard for the given strings. */
export function oneOf<T extends string>(values: readonly T[]): Guard<T> {
  return (value): value is T => values.some((candidate) => candidate === value);
}

/** Builds a guard for an array of values that a guard accepts. */
export function listOf<T>(guard: Guard<T>): Guard<readonly T[]> {
  return (value): value is readonly T[] => Array.isArray(value) && value.every(guard);
}

/** Builds a reader for an object of a data file; `label` names the object in the problems. */
export function fieldReader(label: string, object: Readonly<Record<string, unknown>>, problems: string[]): FieldReader {
  const record = (key: string, expected: string): void => {
    problems.push(`${label}: ${key} should be ${expected}.`);
  };
  return {
    required: (key, guard, expected) => {
      const value = object[key];
      if (guard(value)) return value;
      record(key, expected);
      return undefined;
    },
    optional: (key, guard, expected) => {
      const value = object[key];
      if (value === undefined || guard(value)) return value;
      record(key, expected);
      return undefined;
    },
    absent: (keys, reason) => {
      for (const key of keys)
        if (object[key] !== undefined) problems.push(`${label}: ${key} should be absent, ${reason}.`);
    },
  };
}

/** Raises the problems found in a data file as one error. */
export function failOnProblems(file: string, problems: readonly string[]): void {
  if (problems.length > 0) throw new Error(`${file} is invalid:\n- ${problems.join("\n- ")}`);
}
