import { DataError } from "@assesskit/runtime/errors";
import fc from "fast-check";
import { expect } from "vitest";

/**
 * The seed and the number of runs of every fuzz property, so that a run in CI is the run on a laptop. To search further,
 * set `FUZZ_SEED` and `FUZZ_RUNS`, and raise the timeout of the test.
 */
const FUZZ = {
  seed: Number(process.env.FUZZ_SEED ?? 20_261_030),
  numRuns: Number(process.env.FUZZ_RUNS ?? 300),
} as const;

/** The paths of every value inside JSON, the root included, as the keys and indexes that lead to it. */
function pathsOf(json: unknown, path: readonly (string | number)[] = []): (readonly (string | number)[])[] {
  const children: (readonly (string | number)[])[] =
    typeof json === "object" && json !== null
      ? Object.entries(json).flatMap(([key, member]) =>
          pathsOf(member, [...path, Array.isArray(json) ? Number(key) : key]),
        )
      : [];
  return [path, ...children];
}

/** Returns a copy of JSON with the value at the path replaced; `undefined` takes the value away. */
function replaceAt(json: unknown, path: readonly (string | number)[], replacement: unknown): unknown {
  const [key, ...rest] = path;
  if (key === undefined) return replacement;
  if (Array.isArray(json)) {
    const copy: unknown[] = [...json];
    if (rest.length === 0 && replacement === undefined) copy.splice(Number(key), 1);
    else copy[Number(key)] = replaceAt(copy[Number(key)], rest, replacement);
    return copy;
  }
  const copy: Record<string, unknown> = { ...(json as Record<string, unknown>) };
  if (rest.length === 0 && replacement === undefined) Reflect.deleteProperty(copy, String(key));
  else copy[String(key)] = replaceAt(copy[String(key)], rest, replacement);
  return copy;
}

/** Checks that a function returns, or throws a `DataError`, and nothing else. */
function expectOutcome(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error instanceof DataError, String(error instanceof Error ? error.stack : error)).toBe(true);
  }
}

/**
 * Fuzzes a reader of untrusted JSON: it reads each valid example, and for arbitrary JSON, and for an example with one value
 * replaced by arbitrary JSON or taken away, it returns a value or throws a `DataError`, and throws nothing else.
 *
 * @param read - The reader, which takes the parsed JSON.
 * @param examples - Valid JSON for the reader. Default: none.
 */
export function fuzzJson(read: (json: unknown) => unknown, examples: readonly unknown[] = []): void {
  for (const example of examples) expect(() => read(example)).not.toThrow();
  fc.assert(
    fc.property(fc.jsonValue(), (json) => {
      expectOutcome(() => read(json));
    }),
    FUZZ,
  );
  if (examples.length === 0) return;
  const replacement = fc.option(fc.jsonValue(), { nil: undefined });
  fc.assert(
    fc.property(fc.constantFrom(...examples), fc.nat(), replacement, (example, index, value) => {
      const paths = pathsOf(example);
      const path = paths[index % paths.length] ?? [];
      expectOutcome(() => read(replaceAt(example, path, value)));
    }),
    FUZZ,
  );
}
