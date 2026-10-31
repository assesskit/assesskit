import { DataError } from "@assesskit/runtime/errors";
import * as v from "valibot";
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
  definedSchema,
  describe as describeValue,
  functionSchema,
  httpsUrlSchema,
  isRecord,
  issueText,
  looseRecord,
  mapSchema,
  methodsSchema,
  nonNegativeIntegerSchema,
  parseWith,
  positiveSchema,
  strictRecord,
} from "../src/checks.js";

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

describe("parseWith", () => {
  const schema = v.strictObject({
    name: v.string(),
    seq: nonNegativeIntegerSchema,
    kind: v.picklist(["a", "b", "c"]),
    items: v.array(v.strictObject({ id: v.string() })),
  });
  const valid = { name: "n", seq: 2, kind: "a", items: [{ id: "x" }] };
  const message = (input: unknown): string => {
    try {
      parseWith(schema, input, "The thing");
    } catch (error) {
      if (error instanceof DataError) return error.message;
      throw error;
    }
    return "";
  };

  it("returns the output of the schema", () => {
    expect(parseWith(schema, valid, "The thing")).toEqual(valid);
  });

  it("names the path and what was expected and found, in a full sentence", () => {
    expect(message(JSON.parse("null"))).toBe("The thing is invalid: expected an object, found null.");
    expect(message({ ...valid, name: 5 })).toBe("The thing is invalid at name: expected a string, found 5.");
    expect(message({ ...valid, seq: -1 })).toBe(
      "The thing is invalid at seq: expected a value of at least 0, found -1.",
    );
    expect(message({ ...valid, kind: "z" })).toBe('The thing is invalid at kind: expected "a", "b" or "c", found "z".');
    expect(message({ ...valid, items: [{ id: 1 }] })).toBe(
      "The thing is invalid at items[0].id: expected a string, found 1.",
    );
  });

  it("names a property that is missing or unexpected, at its object", () => {
    expect(message({ name: "n", kind: "a", items: [] })).toBe('The thing is invalid: missing the property "seq".');
    expect(message({ ...valid, extra: 1 })).toBe('The thing is invalid: unexpected property "extra".');
    expect(message({ ...valid, items: [{ id: "x", more: true }] })).toBe(
      'The thing is invalid at items[0]: unexpected property "more".',
    );
    const withProto: unknown = JSON.parse(JSON.stringify(valid).replace("{", '{"__proto__":1,'));
    expect(message(withProto)).toBe('The thing is invalid: unexpected property "__proto__".');
  });

  it("refuses an array where the object has only optional entries, with strictRecord and looseRecord", () => {
    for (const options of [
      strictRecord({ speed: v.optional(v.number()) }),
      looseRecord({ speed: v.optional(v.number()) }),
    ]) {
      expect(parseWith(options, {}, "The options")).toEqual({});
      expect(() => parseWith(options, [], "The options")).toThrow(
        new DataError("The options is invalid: expected an object, found an array."),
      );
    }
  });

  it("gives the text of an issue with its path to the message of an issue of the schema that ran it", () => {
    const result = v.safeParse(schema, { ...valid, items: [{ id: 1 }] });
    const [issue] = result.issues ?? [];
    expect(issue === undefined ? "" : issueText(issue)).toBe("items[0].id: expected a string, found 1");
  });
});

describe("mapSchema", () => {
  it("reads every property, a name such as __proto__ included, into a map in the order of the object", () => {
    const read = parseWith(mapSchema(v.string()), JSON.parse('{"b":"1","__proto__":"2","a":"3"}'), "The assets");
    expect([...read]).toEqual([
      ["b", "1"],
      ["__proto__", "2"],
      ["a", "3"],
    ]);
  });

  it("names the property that is not what the schema asks", () => {
    expect(() => parseWith(mapSchema(v.string()), JSON.parse('{"a":"1","__proto__":2}'), "The assets")).toThrow(
      new DataError('The assets is invalid: the property "__proto__" is invalid: expected a string, found 2.'),
    );
  });
});

describe("the schemas of functions and objects with functions", () => {
  it("accept a function and an object that has the functions, a class instance included", () => {
    class Store {
      load(): void {}
      save(): void {}
    }
    expect(parseWith(functionSchema(), () => 1, "The option")).toBeTypeOf("function");
    const store = new Store();
    expect(parseWith(methodsSchema<Store>("load", "save"), store, "The store")).toBe(store);
  });

  it("refuse the rest, and say which functions an object needs", () => {
    expect(() => parseWith(functionSchema(), 5, "The option fetch")).toThrow(
      new DataError("The option fetch is invalid: expected a function, found 5."),
    );
    expect(() =>
      parseWith(methodsSchema<{ load(): void; save(): void }>("load", "save"), { load: 1 }, "The store"),
    ).toThrow(
      new DataError("The store is invalid: expected an object with the functions load and save, found an object."),
    );
  });
});

describe("httpsUrlSchema, positiveSchema and definedSchema", () => {
  it("accept an absolute https URL, a positive number and any value but undefined", () => {
    expect(parseWith(httpsUrlSchema, "https://a.example/b", "The URL")).toBe("https://a.example/b");
    expect(parseWith(positiveSchema, 0.5, "The length")).toBe(0.5);
    expect(parseWith(definedSchema, null, "The action")).toBeNull();
  });

  it("refuse the rest", () => {
    expect(() => parseWith(httpsUrlSchema, "http://a.example", "The URL")).toThrow(
      new DataError('The URL is invalid: expected an absolute https URL, found "http://a.example".'),
    );
    expect(() => parseWith(positiveSchema, 0, "The length")).toThrow(
      new DataError("The length is invalid: expected a positive number, found 0."),
    );
    expect(() => parseWith(v.object({ action: definedSchema }), { action: undefined }, "The envelope")).toThrow(
      new DataError("The envelope is invalid at action: expected a value, found undefined."),
    );
  });
});
