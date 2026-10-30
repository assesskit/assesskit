import { describe, expect, it } from "vitest";
import {
  checkArray,
  checkBoolean,
  checkChoice,
  checkFinite,
  checkFunction,
  checkNonNegative,
  checkNonNegativeInteger,
  checkOptions,
  checkPositiveInteger,
  checkRecord,
  checkSeed,
  checkString,
  describe as describeValue,
  isRecord,
} from "../src/checks.js";
import { DataError } from "../src/index.js";

describe("describe", () => {
  it("quotes strings and names arrays, functions and objects", () => {
    expect(describeValue("a")).toBe('"a"');
    expect(describeValue([1])).toBe("an array");
    expect(describeValue(() => 1)).toBe("a function");
    expect(describeValue({})).toBe("an object");
    expect(describeValue(null)).toBe("null");
    expect(describeValue(undefined)).toBe("undefined");
    expect(describeValue(1.5)).toBe("1.5");
  });
});

describe("isRecord", () => {
  it("accepts objects that are neither null nor arrays", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("a")).toBe(false);
  });
});

describe("checkRecord", () => {
  it("accepts a record and rejects other values with the given message", () => {
    expect(() => checkRecord({}, "The limits must be an object")).not.toThrow();
    expect(() => checkRecord(JSON.parse("null"), "The limits must be an object")).toThrow(
      new DataError("The limits must be an object, found null."),
    );
    expect(() => checkRecord(JSON.parse("[]"), "The limits must be an object")).toThrow(DataError);
  });
});

describe("checkArray", () => {
  it("accepts an array and rejects other values", () => {
    expect(() => checkArray([], "The issues must be an array")).not.toThrow();
    expect(() => checkArray(JSON.parse("{}"), "The issues must be an array")).toThrow(
      "The issues must be an array, found an object.",
    );
  });
});

describe("checkOptions", () => {
  it("accepts an object and rejects null", () => {
    expect(() => checkOptions({})).not.toThrow();
    expect(() => checkOptions(JSON.parse("null"))).toThrow("The options must be an object, found null.");
  });
});

describe("checkFunction", () => {
  it("accepts a function and rejects other values", () => {
    expect(() => checkFunction(() => 1, "The resolver must be a function")).not.toThrow();
    expect(() => checkFunction(JSON.parse('"x"'), "The resolver must be a function")).toThrow(
      'The resolver must be a function, found "x".',
    );
  });
});

describe("checkString", () => {
  it("accepts a string and rejects other values", () => {
    expect(() => checkString("", "The href")).not.toThrow();
    expect(() => checkString(JSON.parse("1"), "The href")).toThrow("The href must be a string, found 1.");
  });
});

describe("checkBoolean", () => {
  it("accepts a boolean and rejects other values", () => {
    expect(() => checkBoolean(false, "The option shuffle")).not.toThrow();
    expect(() => checkBoolean(JSON.parse('"true"'), "The option shuffle")).toThrow(
      'The option shuffle must be a boolean, found "true".',
    );
  });
});

describe("checkChoice", () => {
  it("accepts one of the choices and lists them otherwise", () => {
    expect(() => checkChoice("error", "The severity", ["error", "warning"])).not.toThrow();
    expect(() => checkChoice("info", "The severity", ["error", "warning"])).toThrow(
      'The severity must be "error" or "warning", found "info".',
    );
    expect(() => checkChoice("d", "The mode", ["a", "b", "c"])).toThrow('The mode must be "a", "b" or "c", found "d".');
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

describe("checkNonNegativeInteger", () => {
  it("accepts safe integers from 0", () => {
    expect(() => checkNonNegativeInteger(0, "The count")).not.toThrow();
    for (const value of [-1, 1.5, 2 ** 53, "1"])
      expect(() => checkNonNegativeInteger(value, "The count")).toThrow(DataError);
    expect(() => checkNonNegativeInteger(-1, "The count")).toThrow(
      "The count must be a non-negative integer, found -1.",
    );
  });
});

describe("checkPositiveInteger", () => {
  it("accepts safe integers from 1", () => {
    expect(() => checkPositiveInteger(1, "The option maxBytes")).not.toThrow();
    for (const value of [0, -1, 1.5, 2 ** 53, "1"]) {
      expect(() => checkPositiveInteger(value, "The option maxBytes")).toThrow(DataError);
    }
    expect(() => checkPositiveInteger(0, "The option maxBytes")).toThrow(
      "The option maxBytes must be a positive integer, found 0.",
    );
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
