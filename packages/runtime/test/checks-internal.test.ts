import { describe, expect, it } from "vitest";
import { parseWith } from "../src/checks.js";
import {
  checkBytes,
  checkFinite,
  checkNonNegative,
  checkOptions,
  checkSeed,
  nonNegativeSchema,
} from "../src/checks-internal.js";
import { DataError } from "../src/index.js";

describe("checkOptions", () => {
  it("accepts an object and rejects null", () => {
    expect(() => checkOptions({})).not.toThrow();
    expect(() => checkOptions(JSON.parse("null"))).toThrow("The options must be an object, found null.");
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
