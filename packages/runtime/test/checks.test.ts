import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
  checkAbortSignal,
  checkArray,
  checkBoolean,
  checkBytes,
  checkChoice,
  checkFinite,
  checkFunction,
  checkNonEmptyString,
  checkNonNegative,
  checkNonNegativeInteger,
  checkOptions,
  checkPositiveInteger,
  checkProperties,
  checkRecord,
  checkSeed,
  checkString,
  checkSynchronous,
  definedSchema,
  describe as describeValue,
  finiteSchema,
  functionSchema,
  isRecord,
  issueText,
  looseRecord,
  mapSchema,
  methodsSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  nonNegativeSchema,
  parseWith,
  positiveIntegerSchema,
  positiveSchema,
  recordSchema,
  strictRecord,
  transformWith,
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

describe("checkSynchronous", () => {
  it("accepts any value that is not a promise", () => {
    for (const value of [{ resource: "a" }, [], "a", 1, null, undefined, JSON.parse('{"then":1}')]) {
      expect(() => checkSynchronous(value, "The resolver items")).not.toThrow();
    }
  });

  it("rejects a promise and any other thenable", () => {
    const message = "The resolver items must return its value synchronously, found a promise.";
    expect(() => checkSynchronous(Promise.resolve(1), "The resolver items")).toThrow(message);
    // biome-ignore lint/suspicious/noThenProperty: the test needs a thenable that is not a Promise.
    const thenable = { then: () => undefined };
    expect(() => checkSynchronous(thenable, "The resolver items")).toThrow(DataError);
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

describe("checkString", () => {
  it("accepts a string and rejects other values", () => {
    expect(() => checkString("", "The href")).not.toThrow();
    expect(() => checkString(JSON.parse("1"), "The href")).toThrow("The href must be a string, found 1.");
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

describe("checkAbortSignal", () => {
  it("accepts an AbortSignal and rejects other values", () => {
    expect(() => checkAbortSignal(new AbortController().signal, "The option signal")).not.toThrow();
    expect(() => checkAbortSignal(AbortSignal.abort(), "The option signal")).not.toThrow();
    expect(() => checkAbortSignal(JSON.parse('{"aborted":false}'), "The option signal")).toThrow(
      new DataError("The option signal must be an AbortSignal, found an object."),
    );
    expect(() => checkAbortSignal(JSON.parse("null"), "The option signal")).toThrow("found null.");
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

describe("parseWith", () => {
  const schema = v.strictObject({
    name: v.string(),
    count: nonNegativeIntegerSchema,
    kind: v.picklist(["a", "b", "c"]),
    items: v.array(v.strictObject({ id: v.string() })),
  });
  const valid = { name: "n", count: 2, kind: "a", items: [{ id: "x" }] };
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
    expect(message({ ...valid, count: -1 })).toBe(
      "The thing is invalid at count: expected a value of at least 0, found -1.",
    );
    expect(message({ ...valid, count: 1.5 })).toBe(
      "The thing is invalid at count: expected a safe integer, found 1.5.",
    );
    expect(message({ ...valid, kind: "z" })).toBe('The thing is invalid at kind: expected "a", "b" or "c", found "z".');
    expect(message({ ...valid, items: [{ id: 1 }] })).toBe(
      "The thing is invalid at items[0].id: expected a string, found 1.",
    );
    expect(message({ ...valid, items: {} })).toBe("The thing is invalid at items: expected an array, found an object.");
  });

  it("names a property that is missing or unexpected, at its object", () => {
    expect(message({ ...valid, count: undefined })).toBe(
      "The thing is invalid at count: expected a number, found undefined.",
    );
    expect(message({ name: "n", kind: "a", items: [] })).toBe('The thing is invalid: missing the property "count".');
    expect(message({ ...valid, extra: 1 })).toBe('The thing is invalid: unexpected property "extra".');
    expect(message({ ...valid, items: [{ id: "x", more: true }] })).toBe(
      'The thing is invalid at items[0]: unexpected property "more".',
    );
    const withProto: unknown = JSON.parse(JSON.stringify(valid).replace("{", '{"__proto__":1,'));
    expect(message(withProto)).toBe('The thing is invalid: unexpected property "__proto__".');
  });

  it("writes a name that is not an identifier in brackets, and uses the message of a rule", () => {
    const named = v.strictObject({
      "a b": v.pipe(
        v.string(),
        v.check((text) => text === "ok", "must be ok"),
      ),
    });
    expect(() => parseWith(named, { "a b": "no" }, "The input")).toThrow(
      new DataError('The input is invalid at ["a b"]: must be ok.'),
    );
  });

  it("refuses an array where the object has only optional entries, behind the record schema", () => {
    const options = v.pipe(recordSchema, v.object({ speed: v.optional(v.number()) }));
    expect(parseWith(options, {}, "The options")).toEqual({});
    expect(() => parseWith(options, [], "The options")).toThrow(
      new DataError("The options is invalid: expected an object, found an array."),
    );
  });
});

describe("transformWith", () => {
  const schema = v.object({
    value: v.pipe(
      v.number(),
      transformWith((number) => {
        if (number < 0) throw new DataError("A value cannot be negative");
        return number * 2;
      }),
    ),
  });

  it("applies the code to the output of the steps before it", () => {
    expect(parseWith(schema, { value: 2 }, "The input")).toEqual({ value: 4 });
  });

  it("turns a DataError of the code into an issue at the path of the value", () => {
    expect(() => parseWith(schema, { value: -1 }, "The input")).toThrow(
      new DataError("The input is invalid at value: A value cannot be negative."),
    );
  });

  it("lets any other error through", () => {
    const failing = v.pipe(
      v.string(),
      transformWith(() => {
        throw new RangeError("not a data error");
      }),
    );
    expect(() => parseWith(failing, "x", "The input")).toThrow(RangeError);
  });
});

describe("strictRecord and looseRecord", () => {
  it("refuse an array where the object has only optional entries", () => {
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
});

describe("issueText", () => {
  it("gives the text of an issue with its path", () => {
    const schema = v.strictObject({ items: v.array(v.strictObject({ id: v.string() })) });
    const [issue] = v.safeParse(schema, { items: [{ id: 1 }] }).issues ?? [];
    expect(issue === undefined ? "" : issueText(issue)).toBe("items[0].id: expected a string, found 1");
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

describe("positiveSchema and definedSchema", () => {
  it("accept a positive number and any value but undefined", () => {
    expect(parseWith(positiveSchema, 0.5, "The length")).toBe(0.5);
    expect(parseWith(definedSchema, null, "The action")).toBeNull();
  });

  it("refuse the rest", () => {
    expect(() => parseWith(positiveSchema, 0, "The length")).toThrow(
      new DataError("The length is invalid: expected a positive number, found 0."),
    );
    expect(() => parseWith(v.object({ action: definedSchema }), { action: undefined }, "The envelope")).toThrow(
      new DataError("The envelope is invalid at action: expected a value, found undefined."),
    );
  });
});

describe("mapSchema", () => {
  it("reads every property, a name such as __proto__ included, into a map in the order of the object", () => {
    const read = parseWith(mapSchema(v.string()), JSON.parse('{"b":"1","__proto__":"2","a":"3"}'), "The paths");
    expect([...read]).toEqual([
      ["b", "1"],
      ["__proto__", "2"],
      ["a", "3"],
    ]);
  });

  it("names the property that is not what the schema asks", () => {
    expect(() => parseWith(mapSchema(v.string()), JSON.parse('{"a":"1","__proto__":2}'), "The paths")).toThrow(
      new DataError('The paths is invalid: the property "__proto__" is invalid: expected a string, found 2.'),
    );
    expect(() => parseWith(mapSchema(v.string()), JSON.parse("[]"), "The paths")).toThrow(
      new DataError("The paths is invalid: expected an object, found an array."),
    );
  });
});

describe("the schemas of numbers and strings", () => {
  it("accept what the check functions accept", () => {
    expect(parseWith(finiteSchema, -1.5, "N")).toBe(-1.5);
    expect(parseWith(nonNegativeSchema, 0, "N")).toBe(0);
    expect(parseWith(nonNegativeIntegerSchema, 7, "N")).toBe(7);
    expect(parseWith(positiveIntegerSchema, 1, "N")).toBe(1);
    expect(parseWith(nonEmptyStringSchema, "x", "N")).toBe("x");
  });

  it("refuse what they refuse", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "1", null]) {
      expect(() => parseWith(finiteSchema, bad, "N")).toThrow(DataError);
    }
    expect(() => parseWith(nonNegativeSchema, -0.5, "N")).toThrow(DataError);
    expect(() => parseWith(nonNegativeIntegerSchema, 2 ** 53, "N")).toThrow(DataError);
    expect(() => parseWith(positiveIntegerSchema, 0, "N")).toThrow(DataError);
    expect(() => parseWith(nonEmptyStringSchema, "", "N")).toThrow(DataError);
  });
});
