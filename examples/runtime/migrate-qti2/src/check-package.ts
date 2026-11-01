import { createEngine } from "@assesskit/runtime/delivery";
import { DataError, type Issue, ReadError, SecurityError } from "@assesskit/runtime/errors";
import { openPackage, type QtiPackage } from "@assesskit/runtime/package";
import { createItemVariables } from "@assesskit/runtime/processing";
import type { OutcomeVariable } from "@assesskit/runtime/results";
import { validatePackage } from "@assesskit/runtime/validate";
import type { Value } from "@assesskit/runtime/values";

/** The seed of the session that runs an item, which only items with templates or random order draw from. */
const SEED = 1;

/** The result of running an item with its correct responses. */
export type Run =
  | {
      /** The engine created the session, took the responses and closed the attempt. */
      readonly ok: true;
      /** Whether the item declares correct responses to answer with. */
      readonly answered: boolean;
      /** The outcome `SCORE` after the submission; `null` when the item has none, or nothing was answered. */
      readonly score: number | null;
    }
  | {
      /** The engine refused to create or run the session. */
      readonly ok: false;
      /** Why, in the engine's words. */
      readonly reason: string;
    };

/** What assesskit finds in a package. */
export interface Check {
  /** The issues of severity `error` that `validatePackage` reports, or why the package could not be read. */
  readonly errors: readonly Issue[];
  /** The number of issues of severity `warning`. */
  readonly warnings: number;
  /** The run of the item; absent when the package has errors. */
  readonly run?: Run;
}

/** The number a single outcome holds, or `null`. */
function numberOf(value: Value | null | undefined): number | null {
  return value?.cardinality === "single" && typeof value.value === "number" ? value.value : null;
}

/** Runs the item of a package once: the correct responses go in, the attempt ends, and the score is read. */
function run(pkg: QtiPackage, itemHref: string): Run {
  const document = pkg.document(itemHref);
  if (document.kind !== "item") return { ok: false, reason: `${itemHref} is not an item.` };
  const { item } = document;
  let engine: ReturnType<typeof createEngine>;
  try {
    // The engine checks everything a session can reach first, and refuses an item that has an error.
    engine = createEngine({ kind: "item", item, base: itemHref });
  } catch (error) {
    if (error instanceof DataError) return { ok: false, reason: error.message };
    throw error;
  }
  const started = engine.start({ seed: SEED, at: 0 });
  if (!started.ok) return { ok: false, reason: started.refusal.message };
  const key = { ref: item.identifier, instance: 1 };
  const responses = new Map([...createItemVariables(item).correctResponses].filter(([, value]) => value !== null));
  if (responses.size === 0) return { ok: true, answered: false, score: null };
  const answered = engine.apply(started.state, { type: "set-responses", item: key, responses, at: 1_000 });
  if (!answered.ok) return { ok: false, reason: answered.refusal.message };
  const submitted = engine.apply(answered.state, { type: "submit", item: key, at: 2_000 });
  if (!submitted.ok) return { ok: false, reason: submitted.refusal.message };
  const outcome = engine
    .results(submitted.state)
    .itemResults.flatMap(({ variables }) => variables)
    .find((variable): variable is OutcomeVariable => variable.kind === "outcome" && variable.identifier === "SCORE");
  return { ok: true, answered: true, score: numberOf(outcome?.value) };
}

/**
 * Reads a QTI 3 package, validates it, and runs its item with assesskit.
 *
 * @param files - The files of the package, by path, with `imsmanifest.xml`.
 * @param itemHref - The path of the item document.
 * @returns The errors and the number of warnings of the validation, and the run of the item when there is no error.
 */
export function checkPackage(files: ReadonlyMap<string, Uint8Array>, itemHref: string): Check {
  let pkg: QtiPackage;
  try {
    pkg = openPackage({ paths: [...files.keys()].sort(), read: (path) => files.get(path) });
  } catch (error) {
    if (!(error instanceof ReadError || error instanceof SecurityError)) throw error;
    return {
      errors: [{ severity: "error", code: "assesskit/example/unreadable", message: error.message }],
      warnings: 0,
    };
  }
  const issues = validatePackage(pkg);
  const errors = issues.filter(({ severity }) => severity === "error");
  const warnings = issues.length - errors.length;
  return errors.length > 0 ? { errors, warnings } : { errors, warnings, run: run(pkg, itemHref) };
}
