import { createRandom as createTakarRandom } from "@luthfanwakan/takar";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRandom, DataError, type Random, restoreRandom } from "../src/index.js";

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

  it("reproduces the uniform sequence of takar's createRandom", () => {
    fc.assert(
      fc.property(fc.maxSafeInteger(), (seed) => {
        expect(draws(createRandom(seed), 50)).toEqual(draws(createTakarRandom(seed), 50));
      }),
    );
  });

  it("is accepted where a Random is taken, as is takar's generator", () => {
    const sources: Random[] = [createRandom(1), createTakarRandom(1)];
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
