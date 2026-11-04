// cspell:ignore answr
import { expect, test } from "vitest";
import { buildOperatorCall, compareMathSteps, createScoringOperators, OPERATOR_DEFINITIONS } from "../src/index.js";
import type { Value } from "../src/values/index.js";
import { BENCH_OPTIONS, BUDGETS, expectWithin } from "./budgets.js";

// The operators score one response at a time, inside response processing; no library of JavaScript scores the same work, so
// the budgets hold the time alone. The comparator's reference, SymPy, is Python and decides symbolically.

const OPERATORS = createScoringOperators();
const text = (value: string): Value => ({ cardinality: "single", baseType: "string", value });

/** A sum of 1,000 terms: the most characters that a response holds, which the comparator evaluates at 24 points. */
const SUM = "x+".repeat(999).concat("x");

test("compares an expression with its key, the options read on each call, within its budget", async ({
  annotate,
  bench,
}) => {
  const score = OPERATORS.get(OPERATOR_DEFINITIONS["expression-equivalent"]);
  const call = buildOperatorCall(
    { operator: "expression-equivalent", key: { kind: "expression", expression: "\\frac{x^2-1}{x-1}" } },
    "RESPONSE",
  );
  const response = [text("x+1")];
  expect(score?.(response, call)).toStrictEqual({ cardinality: "single", baseType: "float", value: 1 });
  const result = await bench("compare an expression", () => score?.(response, call)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "compare an expression", result, BUDGETS.operatorExpression);
});

test("compares a sum of 1,000 terms with a key of as many within its budget", async ({ annotate, bench }) => {
  const score = OPERATORS.get(OPERATOR_DEFINITIONS["expression-equivalent"]);
  const call = buildOperatorCall(
    { operator: "expression-equivalent", key: { kind: "expression", expression: SUM } },
    "R",
  );
  const response = [text(SUM)];
  const result = await bench("compare a sum of 1,000 terms", () => score?.(response, call)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "compare a sum of 1,000 terms", result, BUDGETS.operatorLongest);
});

test("scores a text of 200 words against 50 answers with credit tiers within its budget", async ({
  annotate,
  bench,
}) => {
  const score = OPERATORS.get(OPERATOR_DEFINITIONS["text-equivalent"]);
  const answers = Array.from({ length: 50 }, (_, index) => ({ texts: [`answer${index}`] }));
  const call = buildOperatorCall(
    {
      operator: "text-equivalent",
      key: { kind: "text", answers, count: 50, scheme: "words", credit: [{ tolerance: { absolute: 2 }, share: 0.5 }] },
    },
    "R",
  );
  const response = [text(Array.from({ length: 200 }, (_, index) => `answr${index % 60}`).join(" "))];
  expect(score?.(response, call)).toStrictEqual({ cardinality: "single", baseType: "float", value: 0.5 });
  const result = await bench("score a text", () => score?.(response, call)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "score a text", result, BUDGETS.operatorText);
});

test("checks 60 lines of worked steps within its budget", async ({ annotate, bench }) => {
  const steps = Array.from({ length: 60 }, (_, index) => (index % 2 === 0 ? "(x+1)^2=4" : "x^2+2x-3=0"));
  const result = await bench("check 60 steps", () => compareMathSteps(steps)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "check 60 steps", result, BUDGETS.mathSteps);
});
