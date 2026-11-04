import type { QtiMigrationOptions } from "@longsightgroup/qti3-migrator";
import { checkPackage } from "./check-package.ts";
import { migrateSample } from "./migrate-sample.ts";
import type { Sample } from "./samples.ts";

/** How far a sample got. */
export type Stage =
  /** The migrator refused the item, and says why. */
  | "refused"
  /** The migrator gave a package, and assesskit finds errors in it. */
  | "invalid"
  /** The package is valid, and assesskit cannot run the item. */
  | "not-running"
  /** The package is valid, and assesskit runs the item with its correct responses. */
  | "ran";

/** What happened to one sample. */
export interface Outcome {
  /** The identifier of the sample. */
  readonly identifier: string;
  /** How far it got. */
  readonly stage: Stage;
  /** The codes of the errors that stopped it: the migrator's for a refusal, assesskit's for an invalid package. */
  readonly codes: readonly string[];
  /** The `SCORE` after the correct responses, for a sample that ran with some; `null` otherwise. */
  readonly score: number | null;
  /** Whether the session was answered with correct responses. */
  readonly answered: boolean;
}

/**
 * Migrates each sample with the migrator and checks the result with assesskit.
 *
 * @param samples - The QTI 2.2 items.
 * @param options - The options of the migrator.
 * @returns One outcome per sample, in order.
 */
export async function migrateSamples(
  samples: readonly Sample[],
  options: QtiMigrationOptions = {},
): Promise<readonly Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const sample of samples) {
    const { identifier } = sample;
    const migration = await migrateSample(sample, options);
    if (!migration.ok) {
      // The package error says only that the item is missing, and the other errors say why.
      const codes = migration.diagnostics
        .filter(({ severity, code }) => severity === "error" && code !== "package_item_xml_missing")
        .map(({ code }) => code);
      outcomes.push({ identifier, stage: "refused", codes: [...new Set(codes)], score: null, answered: false });
      continue;
    }
    const { errors, run } = checkPackage(migration.files, migration.itemHref);
    if (run === undefined) {
      const codes = errors.map(({ rule }) => rule);
      outcomes.push({ identifier, stage: "invalid", codes: [...new Set(codes)], score: null, answered: false });
    } else if (!run.ok) {
      outcomes.push({ identifier, stage: "not-running", codes: [run.reason], score: null, answered: false });
    } else {
      outcomes.push({ identifier, stage: "ran", codes: [], score: run.score, answered: run.answered });
    }
  }
  return outcomes;
}
