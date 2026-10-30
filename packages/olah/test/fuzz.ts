import fc from "fast-check";
import { expect } from "vitest";
import { ReadError, SecurityError } from "../src/index.js";
import { mutateBytes, mutateText, mutations } from "./arbitraries/xml.js";

/**
 * The seed and the number of runs of every fuzz property, so that a run in CI is the run on a laptop. To search further,
 * set `FUZZ_SEED` and `FUZZ_RUNS`, and raise the timeout of the test: `FUZZ_RUNS=50000 pnpm exec vitest run --project olah --testTimeout=600000`.
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
 * (BPIG §6.7).
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
