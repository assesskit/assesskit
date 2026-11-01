import type { Outcome, Stage } from "./migrate-samples.ts";

/** The outcomes of a migration, counted. */
export interface Summary {
  /** The number of samples. */
  readonly total: number;
  /** The samples at each stage. */
  readonly stages: ReadonlyMap<Stage, number>;
  /** The number of samples that ran with their correct responses and scored above 0. */
  readonly scored: number;
  /** The identifiers of the samples that stopped for each code. */
  readonly codes: ReadonlyMap<string, readonly string[]>;
}

/** The stages in the order a sample passes them. */
const STAGES: readonly Stage[] = ["ran", "not-running", "invalid", "refused"];

/**
 * Counts the outcomes of a migration.
 *
 * @param outcomes - One outcome per sample.
 * @returns The counts by stage, the samples that scored, and the samples behind each code.
 */
export function summarize(outcomes: readonly Outcome[]): Summary {
  const codes = new Map<string, string[]>();
  for (const { identifier, codes: stopped } of outcomes) {
    for (const code of stopped) codes.set(code, [...(codes.get(code) ?? []), identifier]);
  }
  return {
    total: outcomes.length,
    stages: new Map(STAGES.map((stage) => [stage, outcomes.filter((outcome) => outcome.stage === stage).length])),
    scored: outcomes.filter(({ score }) => score !== null && score > 0).length,
    codes,
  };
}

/**
 * Writes a summary as the lines that the example prints.
 *
 * @param summary - The summary.
 * @returns The report.
 */
export function formatReport({ total, stages, scored, codes }: Summary): string {
  const lines = [`${total} items of QTI 2.2`];
  for (const stage of STAGES) lines.push(`${String(stages.get(stage) ?? 0).padStart(4)}  ${stage}`);
  lines.push(`${String(scored).padStart(4)}  scored above 0 with the correct responses`);
  for (const [code, identifiers] of [...codes].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${code}: ${identifiers.join(", ")}`);
  }
  return lines.join("\n");
}
