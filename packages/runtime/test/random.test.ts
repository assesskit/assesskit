import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRandom, DataError, type Random, restoreRandom } from "../src/index.js";
import { drawIndex, drawUniform, shuffle } from "../src/random.js";

const draws = (random: Random, count: number): number[] => Array.from({ length: count }, () => random.uniform());

describe("createRandom", () => {
  it("reproduces the same sequence for the same seed", () => {
    fc.assert(
      fc.property(fc.maxSafeInteger(), (seed) => {
        expect(draws(createRandom(seed), 20)).toEqual(draws(createRandom(seed), 20));
      }),
    );
  });

  it("gives different sequences for different seeds", () => {
    const first = (seed: number): number => createRandom(seed).uniform();
    expect(new Set([0, 1, 2, -1, 2 ** 32, 2 ** 40, Number.MAX_SAFE_INTEGER].map(first)).size).toBe(7);
  });

  it("draws uniform values in [0, 1) with mean 0.5", () => {
    const values = draws(createRandom(42), 100_000);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(values.reduce((sum, value) => sum + value, 0) / values.length).toBeCloseTo(0.5, 2);
  });

  it("gives the first draws that an independent implementation of the algorithm gives for known seeds", () => {
    const reference: readonly (readonly [number, readonly number[]])[] = [
      [0, [0.8868539502021594, 0.012474988946590604, 0.032522145755498943]],
      [1, [0.5686059948349658, 0.8893939367683266, 0.4705824180198359]],
      [42, [0.6606157208001621, 0.1117019639532224, 0.0791056456144914]],
      [2 ** 32, [0.6145274621428378, 0.8073018729084823, 0.4122337397154928]],
      [Number.MAX_SAFE_INTEGER, [0.13490872132119813, 0.9246935279164502, 0.03200266129860907]],
    ];
    for (const [seed, expected] of reference) expect(draws(createRandom(seed), 3), String(seed)).toEqual(expected);
  });

  it("is accepted where a Random is taken, as is any object with a uniform method", () => {
    const sources: Random[] = [createRandom(1), { uniform: () => 0.5 }];
    expect(sources.every((source) => source.uniform() < 1)).toBe(true);
  });

  it("rejects a seed that is not a safe integer", () => {
    expect(() => createRandom(1.5)).toThrow(DataError);
    expect(() => createRandom(2 ** 53)).toThrow(DataError);
    expect(() => createRandom(JSON.parse('"5"'))).toThrow('A seed must be a safe integer, found "5".');
  });
});

describe("state", () => {
  it("returns four 32-bit words that change with each draw", () => {
    const random = createRandom(7);
    const before = random.state();
    random.uniform();
    const after = random.state();
    expect(before).toHaveLength(4);
    expect(before.every((word) => Number.isInteger(word) && word >= 0 && word < 2 ** 32)).toBe(true);
    expect(after).not.toEqual(before);
    expect(random.state()).toEqual(after);
  });
});

describe("restoreRandom", () => {
  it("continues the sequence from a saved state", () => {
    fc.assert(
      fc.property(fc.maxSafeInteger(), fc.nat(40), (seed, skipped) => {
        const original = createRandom(seed);
        draws(original, skipped);
        const restored = restoreRandom(original.state());
        expect(restored.state()).toEqual(original.state());
        expect(draws(restored, 30)).toEqual(draws(original, 30));
      }),
    );
  });

  it("does not share the state with the generator it was taken from", () => {
    const original = createRandom(3);
    const restored = restoreRandom(original.state());
    restored.uniform();
    expect(restored.state()).not.toEqual(original.state());
  });

  it("rejects a state that is not four 32-bit integers, not all 0", () => {
    const invalid = [
      "[1, 2, 3]",
      "[1, 2, 3, 4, 5]",
      "[1, 2, 3, 1.5]",
      "[1, 2, 3, -1]",
      "[1, 2, 3, 4294967296]",
      "[0, 0, 0, 0]",
    ];
    for (const text of invalid) {
      expect(() => restoreRandom(JSON.parse(text)), text).toThrow(DataError);
    }
    expect(() => restoreRandom(JSON.parse('"abcd"'))).toThrow(
      'A random state must be an array of four integers, found "abcd".',
    );
    expect(() => restoreRandom(JSON.parse("[0, 0, 0, 0]"))).toThrow(
      "A random state must be four integers from 0 to 4294967295, not all 0, found an array.",
    );
  });
});

/** A source that returns the numbers given, in order. */
const scripted = (...draws: number[]): Random => {
  const queue = [...draws];
  return { uniform: () => queue.shift() ?? Number.NaN };
};

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
const json = <T = never>(text: string): T => JSON.parse(text);

describe("drawUniform and drawIndex", () => {
  it("draws floor(uniform × size) as the index", () => {
    expect([0, 0.25, 0.5, 0.75, 0.999].map((draw) => drawIndex(scripted(draw), 4))).toEqual([0, 1, 2, 3, 3]);
    expect(drawIndex(scripted(0.5), 1)).toBe(0);
  });

  it("keeps every index in [0, size) for any seed", () => {
    fc.assert(
      fc.property(fc.maxSafeInteger(), fc.integer({ min: 1, max: 1000 }), (seed, size) => {
        const index = drawIndex(createRandom(seed), size);
        expect(Number.isInteger(index) && index >= 0 && index < size).toBe(true);
      }),
    );
  });

  it("refuses a source that returns anything but a number in [0, 1)", () => {
    for (const draw of ["1", '"0.5"', "null", "-0.5", "2"]) {
      expect(() => drawUniform({ uniform: () => json<number>(draw) })).toThrow(DataError);
    }
    expect(() => drawIndex(scripted(), 3)).toThrow(
      "The function uniform of the option random must return a number in [0, 1), found NaN.",
    );
  });
});

describe("shuffle", () => {
  it("permutes by Fisher–Yates from the last index: the item at i swaps with the one at floor(uniform × (i + 1))", () => {
    // [a, b, c, d]: i = 3 swaps with floor(0.5 × 4) = 2, giving [a, b, d, c]; i = 2 swaps with floor(0.5 × 3) = 1,
    // giving [a, d, b, c]; i = 1 swaps with floor(0.5 × 2) = 1.
    expect(shuffle(["a", "b", "c", "d"], () => false, scripted(0.5, 0.5, 0.5))).toEqual(["a", "d", "b", "c"]);
  });

  it("keeps the items that are fixed in their places, and draws over the places that are not", () => {
    // The movable places of [a, b*, c, d] are 0, 2 and 3: i = 2 swaps the movable places 3 and 2, i = 1 swaps with itself.
    expect(shuffle(["a", "b", "c", "d"], (item) => item === "b", scripted(0.5, 0.5))).toEqual(["a", "b", "d", "c"]);
  });

  it("takes no draw for fewer than two movable items, and does not change the array it is given", () => {
    const items = ["a", "b", "c"];
    expect(shuffle(items, () => true, scripted())).toEqual(["a", "b", "c"]);
    expect(shuffle(items, (item) => item !== "b", scripted())).toEqual(["a", "b", "c"]);
    expect(shuffle([], () => false, scripted())).toEqual([]);
    shuffle(items, () => false, createRandom(1));
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("returns a permutation that leaves the fixed items where they are, for any seed", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(50), fc.boolean()), { maxLength: 12 }),
        fc.maxSafeInteger(),
        (pairs, seed) => {
          const items = pairs.map(([value, fixed], place) => ({ value, fixed, place }));
          const shuffled = shuffle(items, (item) => item.fixed, createRandom(seed));
          expect([...shuffled].sort((a, b) => a.place - b.place)).toEqual(items);
          shuffled.forEach((item, place) => {
            if (item.fixed) expect(place).toBe(item.place);
          });
        },
      ),
    );
  });

  it("gives every order of three items about equally often", () => {
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= 6000; seed++) {
      const order = shuffle(["a", "b", "c"], () => false, createRandom(seed)).join("");
      counts.set(order, (counts.get(order) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    // Chi-square against equal counts, at p = 0.001 for 5 degrees of freedom.
    const statistic = [...counts.values()].reduce((sum, observed) => sum + (observed - 1000) ** 2 / 1000, 0);
    expect(statistic).toBeLessThan(20.515);
  });
});
