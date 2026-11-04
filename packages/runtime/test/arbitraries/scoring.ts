import fc from "fast-check";
import type { Key, ScoredResponse } from "../../src/keys/index.js";
import { buildContainer, buildSingle, type Value } from "../../src/values/index.js";

/** The choices that the keys and the responses draw from. */
const CHOICES = ["A", "B", "C", "D", "E"];

/** A key that QTI or an operator scores, with an arbitrary response to it. */
const keyed: fc.Arbitrary<{ readonly key: Key; readonly answer: fc.Arbitrary<Value | null> }> = fc.oneof(
  fc
    .record({
      keys: fc.uniqueArray(fc.constantFrom(...CHOICES), { minLength: 1, maxLength: 3 }),
      scheme: fc.constantFrom("all-or-nothing", "partial", "per-key"),
    })
    .map(({ keys, scheme }) => ({
      key: { kind: "choice", keys, scheme, maxChoices: scheme === "all-or-nothing" ? keys.length : 5 } as const,
      answer: fc.option(
        fc
          .uniqueArray(fc.constantFrom(...CHOICES), {
            minLength: 1,
            maxLength: scheme === "all-or-nothing" ? keys.length : 5,
          })
          .map((chosen) =>
            scheme !== "all-or-nothing" || keys.length > 1
              ? buildContainer("multiple", "identifier", chosen)
              : buildSingle("identifier", chosen[0] ?? "A"),
          ),
      ),
    })),
  fc
    .record({
      keys: fc.uniqueArray(fc.constantFrom(...CHOICES), { minLength: 1, maxLength: 2 }),
      wrong: fc.constantFrom(-1, -0.25, 0),
      blank: fc.constantFrom(0, 0.5),
    })
    .map(({ keys, wrong, blank }) => ({
      key: { kind: "choice-marking", keys, correct: 1, wrong, blank, maxChoices: 2 } as const,
      answer: fc.option(
        fc
          .uniqueArray(fc.constantFrom(...CHOICES), { minLength: 1, maxLength: 2 })
          .map((chosen) => buildContainer("multiple", "identifier", chosen)),
      ),
    })),
  fc.uniqueArray(fc.constantFrom(...CHOICES), { minLength: 2, maxLength: 5 }).map((order) => ({
    key: { kind: "order", order, scheme: "adjacent-pairs" } as const,
    answer: fc.option(
      fc.shuffledSubarray(order, { minLength: 1 }).map((given) => buildContainer("ordered", "identifier", given)),
    ),
  })),
  fc.constant({
    key: {
      kind: "pairs",
      pairs: [
        ["A", "B"],
        ["C", "D"],
      ],
      scheme: "per-pair",
      maxPairs: 4,
      surplus: 0.5,
    } as const,
    answer: fc.option(
      fc
        .uniqueArray(fc.tuple(fc.constantFrom("A", "C", "E"), fc.constantFrom("B", "D")), {
          minLength: 1,
          maxLength: 4,
          selector: ([a, b]) => `${a} ${b}`,
        })
        .map((made) => buildContainer("multiple", "directedPair", made)),
    ),
  }),
  fc.constant({
    key: { kind: "number", value: 2.5, tolerance: { absolute: 0.25 } } as const,
    answer: fc.option(fc.double({ min: -10, max: 10, noNaN: true }).map((value) => buildSingle("float", value))),
  }),
  fc.constant({
    key: {
      kind: "text",
      answers: [{ texts: ["Jakarta"], points: 2 }, { texts: ["Batavia"] }],
      credit: [{ tolerance: { absolute: 1 }, share: 0.5 }],
    } as const,
    answer: fc.option(fc.string({ maxLength: 12 }).map((text) => buildSingle("string", text))),
  }),
);

/** One to three scored responses with arbitrary points and weights, and an answer to each. */
export function scoredResponsesOf(): fc.Arbitrary<{
  readonly responses: readonly ScoredResponse[];
  readonly answers: Readonly<Record<string, Value | null>>;
}> {
  return fc
    .array(
      fc.record({
        keyed,
        maxPoints: fc.option(fc.constantFrom(0.5, 1, 3), { nil: undefined }),
        weight: fc.option(fc.constantFrom(0.5, 2), { nil: undefined }),
      }),
      { minLength: 1, maxLength: 3 },
    )
    .chain((parts) =>
      fc.tuple(...parts.map(({ keyed: { answer } }) => answer)).map((answers) => {
        const responses = parts.map(
          ({ keyed: { key }, maxPoints, weight }, at): ScoredResponse => ({
            identifier: `R${at + 1}`,
            key,
            ...(maxPoints === undefined ? {} : { maxPoints }),
            ...(weight === undefined ? {} : { weight }),
          }),
        );
        return {
          responses,
          answers: Object.fromEntries(responses.map(({ identifier }, at) => [identifier, answers[at] ?? null])),
        };
      }),
    );
}
