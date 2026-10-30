import { describe, expect, it } from "vitest";
import {
  checkArray,
  checkFinite,
  checkFunction,
  checkHttpsUrl,
  checkNonEmptyString,
  checkNonNegativeInteger,
  checkPositiveInteger,
  checkProperties,
  checkRecord,
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
  it("accepts an object and rejects null, arrays and other values", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(new Map())).toBe(true);
    for (const text of ["null", "[]", '"a"', "5", "true"]) expect(isRecord(JSON.parse(text)), text).toBe(false);
    expect(isRecord(undefined)).toBe(false);
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

describe("checkArray", () => {
  it("accepts an array, the empty one included, and rejects other values with the given message", () => {
    expect(() => checkArray([], "The origins must be an array")).not.toThrow();
    expect(() => checkArray(JSON.parse('{"0":"a"}'), "The origins must be an array")).toThrow(
      new DataError("The origins must be an array, found an object."),
    );
    expect(() => checkArray(JSON.parse('"a"'), "The origins must be an array")).toThrow('found "a".');
  });
});

describe("checkFunction", () => {
  it("accepts a function and rejects other values with the given message", () => {
    expect(() => checkFunction(() => 1, "The listener must be a function")).not.toThrow();
    expect(() => checkFunction(JSON.parse("null"), "The listener must be a function")).toThrow(
      new DataError("The listener must be a function, found null."),
    );
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

  it("names the one property that a record may have in the singular", () => {
    expect(() => checkProperties({ b: 1 }, "The options", ["a"])).toThrow(
      new DataError('The options has the property "a", found "b".'),
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

describe("checkHttpsUrl", () => {
  it("accepts an absolute https URL", () => {
    for (const url of ["https://example.edu", "https://example.edu:8443/path?q=1#f", "HTTPS://EXAMPLE.EDU/"]) {
      expect(() => checkHttpsUrl(url, "The option endpoint")).not.toThrow();
    }
  });

  it("rejects other schemes, relative references and other types", () => {
    for (const url of ["http://example.edu", "ftp://example.edu", "urn:uuid:1", "/path", "example.edu", ""]) {
      expect(() => checkHttpsUrl(url, "The option endpoint"), url).toThrow(
        new DataError(`The option endpoint must be an absolute https URL, found ${JSON.stringify(url)}.`),
      );
    }
    expect(() => checkHttpsUrl(JSON.parse("5"), "The option endpoint")).toThrow(
      "The option endpoint must be a string, found 5.",
    );
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

describe("checkPositiveInteger", () => {
  it("accepts the safe integers from 1", () => {
    for (const value of [1, 2, Number.MAX_SAFE_INTEGER]) {
      expect(() => checkPositiveInteger(value, "The option timeoutMs")).not.toThrow();
    }
  });

  it("rejects 0, negative numbers, fractions, unsafe integers, non-finite numbers and other types", () => {
    const bad = [0, -1, 1.5, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY, JSON.parse('"1"'), JSON.parse("null")];
    for (const value of bad) {
      expect(() => checkPositiveInteger(value, "The option timeoutMs")).toThrow(DataError);
    }
    expect(() => checkPositiveInteger(0, "The option timeoutMs")).toThrow(
      "The option timeoutMs must be a positive integer, found 0.",
    );
  });
});

describe("checkFinite", () => {
  it("accepts finite numbers of either sign", () => {
    for (const value of [0, -0.5, 12.25, Number.MAX_VALUE]) {
      expect(() => checkFinite(value, "The property scoreGiven")).not.toThrow();
    }
  });

  it("rejects NaN, infinities and other types", () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, JSON.parse('"1"'), JSON.parse("null")];
    for (const value of bad) expect(() => checkFinite(value, "The property scoreGiven")).toThrow(DataError);
    expect(() => checkFinite(Number.NaN, "The property scoreGiven")).toThrow(
      "The property scoreGiven must be a finite number, found NaN.",
    );
  });
});
