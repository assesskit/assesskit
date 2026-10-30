import { describe, expect, it } from "vitest";
import {
  checkNonEmptyString,
  checkNonNegativeInteger,
  checkProperties,
  checkRecord,
  checkString,
  describe as describeValue,
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

describe("checkRecord", () => {
  it("accepts a record and rejects other values with the given message", () => {
    expect(() => checkRecord({}, "The caller must be an object")).not.toThrow();
    expect(() => checkRecord(JSON.parse("null"), "The caller must be an object")).toThrow(
      new DataError("The caller must be an object, found null."),
    );
    expect(() => checkRecord(JSON.parse("[]"), "The caller must be an object")).toThrow(
      "The caller must be an object, found an array.",
    );
    expect(() => checkRecord(JSON.parse('"a"'), "The caller must be an object")).toThrow(DataError);
  });
});

describe("checkProperties", () => {
  it("accepts a record with some or all of the properties, and one with none", () => {
    expect(() => checkProperties({}, "An envelope", ["a", "b"])).not.toThrow();
    expect(() => checkProperties({ a: 1 }, "An envelope", ["a", "b"])).not.toThrow();
    expect(() => checkProperties({ a: 1, b: 2 }, "An envelope", ["a", "b"])).not.toThrow();
  });

  it("names the properties a record may have and the one it has too many", () => {
    expect(() => checkProperties({ a: 1, session: "s" }, "An envelope", ["a", "b"])).toThrow(
      new DataError('An envelope has the properties "a" and "b", found "session".'),
    );
    expect(() => checkProperties({ c: 1 }, "An envelope", ["a", "b", "d"])).toThrow(
      'An envelope has the properties "a", "b" and "d", found "c".',
    );
  });

  it("treats a property named __proto__ as data", () => {
    const record: Readonly<Record<string, unknown>> = JSON.parse('{"__proto__": 1}');
    expect(() => checkProperties(record, "An envelope", ["a", "b"])).toThrow('found "__proto__".');
  });
});

describe("checkString", () => {
  it("accepts a string, the empty one included, and rejects other values", () => {
    expect(() => checkString("", "The option language")).not.toThrow();
    expect(() => checkString(JSON.parse("5"), "The option language")).toThrow(
      new DataError("The option language must be a string, found 5."),
    );
    expect(() => checkString(JSON.parse("null"), "The option language")).toThrow("found null.");
  });
});

describe("checkNonEmptyString", () => {
  it("accepts a string of at least one character", () => {
    expect(() => checkNonEmptyString("s", "The session of a caller")).not.toThrow();
  });

  it("rejects the empty string and other values", () => {
    expect(() => checkNonEmptyString("", "The session of a caller")).toThrow(
      new DataError('The session of a caller must be a non-empty string, found "".'),
    );
    expect(() => checkNonEmptyString(JSON.parse("[]"), "The session of a caller")).toThrow("found an array.");
  });
});

describe("checkNonNegativeInteger", () => {
  it("accepts 0 and the safe integers above it", () => {
    for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(() => checkNonNegativeInteger(value, "The property seq")).not.toThrow();
    }
  });

  it("rejects negative numbers, fractions, unsafe integers, non-finite numbers and other types", () => {
    const bad = [-1, 1.5, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY, JSON.parse('"1"'), JSON.parse("null")];
    for (const value of bad) {
      expect(() => checkNonNegativeInteger(value, "The property seq")).toThrow(DataError);
    }
    expect(() => checkNonNegativeInteger(-1, "The property seq")).toThrow(
      "The property seq must be a non-negative integer, found -1.",
    );
  });
});
