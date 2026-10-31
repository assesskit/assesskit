import { describe, expect, it } from "vitest";
import printf from "./fixtures/printf.json" with { type: "json" };
import rounding from "./fixtures/rounding.json" with { type: "json" };

const SPECIFICATION = /^%([-+ #0]*)(\d*)(?:\.(\d+))?([a-zA-Z])$/;

describe("printf fixtures", () => {
  const specifications = [...printf.floats, ...printf.integers].map(({ format }) => SPECIFICATION.exec(format));

  it("are conversion specifications that cover every conversion and every flag", () => {
    expect(specifications.every((match) => match !== null)).toBe(true);
    const conversions = new Set(specifications.map((match) => match?.[4]));
    expect([...conversions].sort()).toEqual(["E", "G", "X", "d", "e", "f", "g", "i", "o", "x"]);
    const flags = new Set(specifications.flatMap((match) => [...(match?.[1] ?? "")]));
    expect([...flags].sort().join("")).toBe(" #+-0");
  });

  it("hold numbers and the strings that Python printed", () => {
    for (const { value, expected } of [...printf.floats, ...printf.integers]) {
      expect(typeof value).toBe("number");
      expect(typeof expected).toBe("string");
    }
    expect(printf.integers.every(({ value }) => Number.isSafeInteger(value))).toBe(true);
  });
});

describe("rounding fixtures", () => {
  it("cover both rounding modes and keep the figures in range", () => {
    expect(new Set(rounding.roundTo.map(({ mode }) => mode))).toEqual(new Set(["decimalPlaces", "significantFigures"]));
    for (const { mode, figures } of [...rounding.roundTo, ...rounding.equalRounded]) {
      expect(figures).toBeGreaterThanOrEqual(mode === "decimalPlaces" ? 0 : 1);
    }
  });

  it("hold the rounded value in plain decimal notation", () => {
    expect(rounding.roundTo.every(({ expected }) => /^-?\d+(\.\d+)?$/.test(expected))).toBe(true);
  });

  it("hold pairs that rounding makes equal and pairs that it keeps apart", () => {
    const outcomes = new Set(rounding.equalRounded.map(({ expected }) => expected));
    expect(outcomes).toEqual(new Set([true, false]));
  });
});
