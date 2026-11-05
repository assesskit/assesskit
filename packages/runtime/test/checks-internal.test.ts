import { describe, expect, it } from "vitest";
import { parseWith } from "../src/checks.js";
import {
  checkBytes,
  checkFinite,
  checkNonNegative,
  checkSeed,
  limitsSchema,
  nonNegativeSchema,
} from "../src/checks-internal.js";
import { DataError } from "../src/errors.js";

describe("limitsSchema", () => {
  const defaults = { maxBytes: 10, maxDepth: 4 };
  const schema = limitsSchema(defaults, { maxDepth: 8 });

  it("gives every limit, a limit left out at its default, and freezes the result", () => {
    expect(parseWith(schema, {}, "The limits")).toEqual(defaults);
    expect(parseWith(schema, { maxBytes: 20, maxDepth: undefined }, "The limits")).toEqual({
      maxBytes: 20,
      maxDepth: 4,
    });
    expect(Object.isFrozen(parseWith(schema, {}, "The limits"))).toBe(true);
  });

  it("refuses a name that is not a limit, so that a misspelled limit never passes", () => {
    expect(() => parseWith(schema, { maxByte: 20 }, "The limits")).toThrow(
      'The limits is invalid: unexpected property "maxByte"',
    );
  });

  it("refuses a limit that is not a positive integer or is past its cap, and a value that is not an object", () => {
    for (const bad of [0, 1.5, -1, "9", null, Number.NaN]) {
      expect(() => parseWith(schema, { maxBytes: bad }, "The limits")).toThrow("The limits is invalid at maxBytes");
    }
    expect(() => parseWith(schema, { maxDepth: 9 }, "The limits")).toThrow(
      "The limits is invalid at maxDepth: expected a value of at most 8, found 9",
    );
    expect(parseWith(schema, { maxDepth: 8 }, "The limits").maxDepth).toBe(8);
    for (const bad of [null, [], "x"]) expect(() => parseWith(schema, bad, "The limits")).toThrow("expected an object");
  });

  it("takes only the names it is given, as a writer takes maxAnswers alone", () => {
    const some = limitsSchema(defaults, {}, ["maxDepth"]);
    expect(parseWith(some, { maxDepth: 2 }, "The limits")).toEqual({ maxBytes: 10, maxDepth: 2 });
    expect(() => parseWith(some, { maxBytes: 2 }, "The limits")).toThrow(
      'The limits is invalid: unexpected property "maxBytes"',
    );
  });
});

describe("checkBytes", () => {
  it("accepts a Uint8Array and rejects other values", () => {
    expect(() => checkBytes(new Uint8Array(), "The file settings")).not.toThrow();
    expect(() => checkBytes(JSON.parse("[1]"), "The file settings")).toThrow(
      "The file settings must be a Uint8Array, found an array.",
    );
    expect(() => checkBytes("text", "The file settings")).toThrow(DataError);
  });
});

describe("checkFinite", () => {
  it("accepts finite numbers and rejects NaN, infinities and other types", () => {
    expect(() => checkFinite(-1.5, "The tolerance")).not.toThrow();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, "1", null]) {
      expect(() => checkFinite(value, "The tolerance")).toThrow(DataError);
    }
    expect(() => checkFinite(Number.NaN, "The tolerance")).toThrow("The tolerance must be a finite number, found NaN.");
  });
});

describe("checkNonNegative", () => {
  it("accepts 0 and above", () => {
    expect(() => checkNonNegative(0, "The minimum")).not.toThrow();
    expect(() => checkNonNegative(-1, "The minimum")).toThrow("The minimum must be a non-negative number, found -1.");
    expect(() => checkNonNegative(Number.POSITIVE_INFINITY, "The minimum")).toThrow(DataError);
  });
});

describe("checkSeed", () => {
  it("accepts safe integers of either sign", () => {
    expect(() => checkSeed(0)).not.toThrow();
    expect(() => checkSeed(-7)).not.toThrow();
    expect(() => checkSeed(1.5)).toThrow("A seed must be a safe integer, found 1.5.");
    expect(() => checkSeed(JSON.parse('"5"'))).toThrow('A seed must be a safe integer, found "5".');
  });
});

describe("nonNegativeSchema", () => {
  it("accepts a finite number of at least 0 and refuses another", () => {
    expect(parseWith(nonNegativeSchema, 0, "N")).toBe(0);
    expect(() => parseWith(nonNegativeSchema, -0.5, "N")).toThrow(DataError);
    expect(() => parseWith(nonNegativeSchema, Number.POSITIVE_INFINITY, "N")).toThrow(DataError);
  });
});
