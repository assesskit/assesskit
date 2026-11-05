import { DEFAULT_KEY_LIMITS, type ScoredResponse } from "@assesskit/runtime/keys";
import { compileScoring } from "@assesskit/runtime/scoring";
import { expect, test } from "vitest";
import { BENCH_OPTIONS, BUDGETS, expectWithin } from "./budgets.js";

// compileScoring writes an item's scoring once, when the item is authored; no library compiles keys into QTI, so the budgets
// hold the time alone. The benchmarks time the build, by name, which `pnpm bench` makes first.

/** An item of four responses: a choice, pairs, an order and a text, as an author writes one. */
const ITEM: readonly ScoredResponse[] = [
  { identifier: "R1", key: { kind: "choice", keys: ["A", "C"], scheme: "partial", maxChoices: 4 } },
  {
    identifier: "R2",
    key: {
      kind: "pairs",
      pairs: [
        ["S1", "T1"],
        ["S2", "T2"],
        ["S3", "T3"],
      ],
      scheme: "per-pair",
    },
  },
  { identifier: "R3", key: { kind: "order", order: ["A", "B", "C", "D", "E"], scheme: "adjacent-pairs" } },
  { identifier: "R4", key: { kind: "text", answers: [{ texts: ["Jakarta"] }, { texts: ["Batavia"], points: 0.5 }] } },
];

/**
 * The most that the limits of keys allow, for the keys whose rules grow with their entries: 256 orders of 1,000 choices
 * scored per position, a condition for each.
 */
const LIMITS: readonly ScoredResponse[] = Array.from({ length: DEFAULT_KEY_LIMITS.responses }, (_, at) => ({
  identifier: `R${at}`,
  key: {
    kind: "order",
    order: Array.from({ length: DEFAULT_KEY_LIMITS.entries }, (_, choice) => `C${choice}`),
    scheme: "per-position",
  },
}));

test("compiles an item of four responses within its budget", async ({ annotate, bench }) => {
  expect(compileScoring(ITEM).operators).toHaveLength(1);
  const result = await bench("compile an item", () => compileScoring(ITEM)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "compile an item", result, BUDGETS.compileItem);
});

test("compiles 256 orders of 1,000 choices, the limits of keys, within its budget", async ({ annotate, bench }) => {
  expect(compileScoring(LIMITS).responseDeclarations).toHaveLength(DEFAULT_KEY_LIMITS.responses);
  const result = await bench("compile at the limits", () => compileScoring(LIMITS)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "compile at the limits", result, BUDGETS.compileLimits);
});
