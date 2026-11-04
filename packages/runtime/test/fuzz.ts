import fc from "fast-check";
import { expect } from "vitest";
import { DataError, ReadError, SecurityError } from "../src/errors.js";
import { mutateBytes, mutateText, mutations } from "./arbitraries/xml.js";

/**
 * The seed and the number of runs of every fuzz property, so that a run in CI is the run on a laptop. To search further,
 * set `FUZZ_SEED` and `FUZZ_RUNS`, and raise the timeout of the test: `FUZZ_RUNS=50000 pnpm exec vitest run --project the runtime --testTimeout=600000`.
 */
export const FUZZ = {
  seed: Number(process.env.FUZZ_SEED ?? 20_261_030),
  numRuns: Number(process.env.FUZZ_RUNS ?? 300),
} as const;

/** The classes of error that a reader may throw. */
type ErrorClass = abstract new (...args: never[]) => Error;

/**
 * Checks that a function returns or throws one of the allowed errors, whatever the input: anything else is a defect.
 * Default: `ReadError` and `SecurityError`.
 */
export function expectOutcome(run: () => unknown, allowed: readonly ErrorClass[] = [ReadError, SecurityError]): void {
  try {
    run();
  } catch (error) {
    expect(
      allowed.some((kind) => error instanceof kind),
      String(error instanceof Error ? error.stack : error),
    ).toBe(true);
  }
}

/** A DOCTYPE that declares an entity, and where a document may have one: before its root element. */
const DOCTYPE = '<!DOCTYPE x [<!ENTITY e "v">]>';

/**
 * Fuzzes a reader of documents: it gets mutated text and mutated bytes of valid documents (see `mutations`), and must
 * read them or refuse them with a `ReadError` or a `SecurityError`, and throw nothing else. It must also refuse a valid
 * document with a DOCTYPE before its root, as text and as bytes, with a `SecurityError` whose `limit` is `doctype`
 * (BPIG section 6.7).
 */
export function fuzzReader(documents: fc.Arbitrary<string>, read: (input: string | Uint8Array) => unknown): void {
  const encoder = new TextEncoder();
  fc.assert(
    fc.property(documents, mutations, fc.boolean(), (document, changes, asBytes) => {
      const mutated = asBytes ? mutateBytes(encoder.encode(document), changes) : mutateText(document, changes);
      expectOutcome(() => read(mutated));
      const declared = document.replace(/^(<\?xml[^>]*\?>\s*)?/, `$1${DOCTYPE}`);
      expect(() => read(asBytes ? encoder.encode(declared) : declared)).toThrow(
        expect.objectContaining({ limit: "doctype" }),
      );
    }),
    FUZZ,
  );
}

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
      expectOutcome(() => read(json), [DataError]);
    }),
    FUZZ,
  );
  if (examples.length === 0) return;
  const replacement = fc.option(fc.jsonValue(), { nil: undefined });
  fc.assert(
    fc.property(fc.constantFrom(...examples), fc.nat(), replacement, (example, index, value) => {
      const paths = pathsOf(example);
      const path = paths[index % paths.length] ?? [];
      expectOutcome(() => read(replaceAt(example, path, value)), [DataError]);
    }),
    FUZZ,
  );
}
