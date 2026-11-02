// cspell:ignore directedpair xabc Marksfor ffffd fffd ffffe Isbasic letrec Approximative
import { Buffer } from "node:buffer";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DataError } from "../src/index.js";
import {
  BASE_TYPES,
  type BaseType,
  CARDINALITIES,
  type Cardinality,
  compileXsdRegex,
  container,
  DEFAULT_XSD_REGEX_LIMITS,
  decodeBase64,
  decodeBase64Url,
  encodeBase64,
  encodeBase64Url,
  formatIdentifierList,
  formatIntegerList,
  formatPrimitive,
  fromJsonValue,
  fromWireValue,
  isBaseType,
  isCardinality,
  isIdentifier,
  isXsdDate,
  isXsdDateTime,
  matchValues,
  normalizeValue,
  type Primitive,
  parseIdentifierList,
  parseIntegerList,
  parseIsoDuration,
  parsePrimitive,
  promote,
  record,
  single,
  toJsonValue,
  toWireValue,
  type Value,
  type ValueDeclaration,
  type XsdPattern,
} from "../src/values/index.js";
import { mutateText, mutationsOf } from "./arbitraries/xml.js";
import { FUZZ, fuzzJson } from "./fuzz.js";
import { runGuideSamples } from "./guide-samples.js";

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

/** Returns a value that the test knows is not NULL. */
function nonNull<T>(value: T | null): T {
  if (value === null) throw new Error("The test builds a NULL.");
  return value;
}

/** The terms of `BaseTypeEnum`. */
const BASE_TYPE_TERMS = [
  "boolean",
  "directedPair",
  "duration",
  "file",
  "float",
  "identifier",
  "integer",
  "pair",
  "point",
  "string",
  "uri",
];

/** The terms of `CardinalityEnum`. */
const CARDINALITY_TERMS = ["multiple", "ordered", "record", "single"];

const NOT_TERMS = [
  "",
  "Boolean",
  "directedpair",
  "int",
  "intOrIdentifier",
  " string",
  "string ",
  "__proto__",
  "constructor",
];
const NOT_STRINGS = [null, undefined, 1, true, [], {}, ["string"]];

const declarationOf = (value: Value): ValueDeclaration =>
  value.cardinality === "record"
    ? { cardinality: "record" }
    : { cardinality: value.cardinality, baseType: value.baseType };

describe("base types and cardinalities", () => {
  const kinds = [
    { name: "base type", all: BASE_TYPES, terms: BASE_TYPE_TERMS, accepts: isBaseType, others: NOT_TERMS },
    {
      name: "cardinality",
      all: CARDINALITIES,
      terms: CARDINALITY_TERMS,
      accepts: isCardinality,
      others: [...NOT_TERMS, "Single", "list", "base"],
    },
  ];

  describe.each(kinds)("$name", ({ all, terms, accepts, others }) => {
    it("lists the terms of the enumeration in alphabetical order", () => {
      expect([...all]).toEqual(terms);
    });

    it("accepts every term and no other text", () => {
      for (const term of terms) expect(accepts(term), term).toBe(true);
      for (const other of others) expect(accepts(other), other).toBe(false);
    });

    it("rejects values that are not strings", () => {
      for (const other of NOT_STRINGS) expect(accepts(other)).toBe(false);
    });
  });
});

describe("identifiers", () => {
  // A letter or an underscore first; then letters, underscores, hyphens, periods, digits, combining characters and
  // extenders; never a colon.
  const accepted = ["a", "_", "A1", "item-1.b", "Q01.SCORE", "_identifier", "ID3", "é", "a\u0301", "a\u00b7", "日本語"];
  const rejected = ["", "1a", "-a", ".a", "a b", "a:b", ":a", "a/b", "a\n", "a@b", "\u0301a", "a\ud800"];

  it("accepts a letter or an underscore followed by letters, digits, hyphens, periods, combining characters and extenders", () => {
    for (const text of accepted) expect(isIdentifier(text), text).toBe(true);
  });

  it("rejects a digit, hyphen or period first, a colon, white space and other characters", () => {
    for (const text of rejected) expect(isIdentifier(text), JSON.stringify(text)).toBe(false);
  });

  it("does not limit the length: 32 characters are only recommended", () => {
    expect(isIdentifier("a".repeat(100))).toBe(true);
  });

  it("tells identifiers that differ in case apart, as they are compared case-sensitively", () => {
    expect(isIdentifier("id")).toBe(true);
    expect(isIdentifier("ID")).toBe(true);
    expect(matchValues(single("identifier", "id"), single("identifier", "ID"))).toBe(false);
  });

  it("rejects values that are not strings", () => {
    for (const other of NOT_STRINGS) expect(isIdentifier(other)).toBe(false);
  });
});

describe("building values", () => {
  it("builds a single value", () => {
    expect(single("integer", 5)).toEqual({ cardinality: "single", baseType: "integer", value: 5 });
    expect(single("identifier", "a")).toEqual({ cardinality: "single", baseType: "identifier", value: "a" });
    expect(single("point", [1, 2])).toEqual({ cardinality: "single", baseType: "point", value: [1, 2] });
  });

  it("builds a multiple container that keeps repeated values", () => {
    expect(container("multiple", "string", ["b", "a", "b"])).toEqual({
      cardinality: "multiple",
      baseType: "string",
      values: ["b", "a", "b"],
    });
  });

  it("builds an ordered container that keeps the order", () => {
    expect(container("ordered", "integer", [3, 1, 2])).toEqual({
      cardinality: "ordered",
      baseType: "integer",
      values: [3, 1, 2],
    });
  });

  it("builds a record whose fields have their own base types, in insertion order", () => {
    const built = record([
      ["rock", single("boolean", true)],
      ["paper", nonNull(single("string", "Four score"))],
    ]);
    expect(built?.cardinality).toBe("record");
    expect([...(built?.fields ?? [])]).toEqual([
      ["rock", { cardinality: "single", baseType: "boolean", value: true }],
      ["paper", { cardinality: "single", baseType: "string", value: "Four score" }],
    ]);
  });

  it("keeps a field named like a property of Object.prototype as data", () => {
    const built = record([["__proto__", single("integer", 1)]]);
    expect(built?.fields.get("__proto__")).toEqual(single("integer", 1));
    expect(Object.getPrototypeOf(built?.fields)).toBe(Map.prototype);
    expect(({} as Record<string, unknown>).integer).toBeUndefined();
  });

  it("rejects a field that is not an identifier, a field twice and a field that is not a single value", () => {
    expect(() => record([["not an identifier", single("integer", 1)]])).toThrow(DataError);
    expect(() =>
      record([
        ["a", single("integer", 1)],
        ["a", single("integer", 2)],
      ]),
    ).toThrow("twice");
    expect(() => record([["a", json('{"cardinality":"single","baseType":"integer","value":1.5}')]])).toThrow(DataError);
    expect(() => record([["a", json('{"cardinality":"multiple","baseType":"integer","values":[1]}')]])).toThrow(
      "must be a single value",
    );
    expect(() => record([["a", nonNull(single("string", "x"))], json('["b"]')])).toThrow(DataError);
  });

  it("represents NULL as null: an empty string, an empty container and an empty record", () => {
    expect(single("string", "")).toBeNull();
    expect(container("multiple", "integer", [])).toBeNull();
    expect(container("ordered", "string", [])).toBeNull();
    expect(record([])).toBeNull();
  });

  it("treats the empty string as NULL for string only", () => {
    expect(single("uri", "")).toEqual({ cardinality: "single", baseType: "uri", value: "" });
    expect(() => single("identifier", "")).toThrow(DataError);
    expect(() => container("multiple", "string", ["a", ""])).toThrow("empty string");
  });

  it("keeps white space in a string", () => {
    expect(nonNull(single("string", " a  b ")).value).toBe(" a  b ");
  });

  it("turns an integer -0 into 0 and keeps the sign of a float", () => {
    expect(Object.is(single("integer", -0).value, 0)).toBe(true);
    expect(Object.is(single("float", -0).value, -0)).toBe(true);
    expect(single("point", [-0, 0]).value).toEqual([0, 0]);
  });

  it("copies a file to its reference, content type and name", () => {
    const given = { reference: "files/1", mimeType: "text/plain", fileName: "a.txt", bytes: "AAAA" };
    expect(single("file", given).value).toEqual({ reference: "files/1", mimeType: "text/plain", fileName: "a.txt" });
    expect(single("file", { reference: "files/2", mimeType: "image/png", fileName: undefined }).value).toStrictEqual({
      reference: "files/2",
      mimeType: "image/png",
    });
  });

  it("copies what it is given, so that later changes do not reach the value", () => {
    const point = [1, 2];
    const values = [3, 4];
    const built = single("point", point as unknown as Primitive);
    const list = container("ordered", "integer", values);
    point[0] = 99;
    values[0] = 99;
    expect(built.value).toEqual([1, 2]);
    expect(list?.values).toEqual([3, 4]);
  });

  it("rejects an integer that is not a safe integer", () => {
    expect(() => single("integer", 2 ** 53)).toThrow(
      "A value of base type integer must be a safe integer, found 9007199254740992.",
    );
    expect(() => single("integer", 1.5)).toThrow(DataError);
    expect(() => single("integer", Number.NaN)).toThrow(DataError);
    expect(() => container("ordered", "integer", [1, 2 ** 60])).toThrow(DataError);
  });

  it("rejects an identifier that is not one", () => {
    expect(() => single("identifier", "1a")).toThrow("A value of base type identifier must be an identifier");
    expect(() => single("pair", ["a", "b c"])).toThrow(DataError);
  });

  it("rejects a value that is not of the base type", () => {
    for (const [baseType, value] of [
      ["boolean", "true"],
      ["float", "1"],
      ["duration", null],
      ["string", 1],
      ["uri", ["a"]],
      ["point", [1.5, 2]],
      ["point", [1, 2, 3]],
      ["directedPair", ["a"]],
      ["file", { reference: "", mimeType: "a/b" }],
      ["file", { reference: "r", mimeType: 1 }],
      ["file", { reference: "r", mimeType: "a/b", fileName: 1 }],
      ["file", "r"],
    ] as const) {
      expect(() => single(baseType, json(JSON.stringify(value))), `${baseType} ${JSON.stringify(value)}`).toThrow(
        DataError,
      );
    }
  });

  it("checks a value deeply and returns a copy of it", () => {
    const values = [
      nonNull(single("integer", 5)),
      nonNull(container("ordered", "string", ["a", "b"])),
      nonNull(record([["x", nonNull(single("boolean", true))]])),
    ];
    for (const value of values) {
      const copy = normalizeValue(value);
      expect(copy).toEqual(value);
      expect(copy).not.toBe(value);
    }
  });

  it("refuses what is not a value", () => {
    expect(() => normalizeValue(json("null"))).toThrow("A value must be an object, found null.");
    expect(() => normalizeValue(json('{"cardinality":"single","baseType":"integer","value":"5"}'))).toThrow(DataError);
    expect(() => normalizeValue(json('{"cardinality":"multiple","baseType":"integer","values":[]}'))).toThrow(
      "A value cannot be empty; the absence of a value is null.",
    );
  });

  it("rejects arguments of other types", () => {
    expect(() => single(json('"unknown"'), json("1"))).toThrow('The base type must be "boolean"');
    expect(() => single(json("null"), json("1"))).toThrow(DataError);
    expect(() => container(json('"single"'), "integer", [1])).toThrow(
      'The cardinality of a container must be "multiple" or "ordered", found "single".',
    );
    expect(() => container("multiple", json('"unknown"'), [1])).toThrow(DataError);
    expect(() => container("multiple", "integer", json('{"0":1}'))).toThrow(
      "The values of a container must be an array, found an object.",
    );
    expect(() => container("multiple", "integer", json("null"))).toThrow(DataError);
    expect(() => record(json("null"))).toThrow("The fields of a record must be an iterable");
    expect(() => record(json("5"))).toThrow(DataError);
    expect(() => record(json("[1]"))).toThrow("A field of a record must be an array");
  });
});

describe("lexical forms", () => {
  it("reads true, false, 1 and 0, the lexical forms of xs:boolean", () => {
    expect(parsePrimitive("true", "boolean")).toBe(true);
    expect(parsePrimitive("1", "boolean")).toBe(true);
    expect(parsePrimitive("false", "boolean")).toBe(false);
    expect(parsePrimitive(" 0\n", "boolean")).toBe(false);
    for (const text of ["", "TRUE", "yes", "2", "true false"])
      expect(() => parsePrimitive(text, "boolean"), text).toThrow(DataError);
  });

  it("writes true and false", () => {
    expect(formatPrimitive(true, "boolean")).toBe("true");
    expect(formatPrimitive(false, "boolean")).toBe("false");
  });

  it("reads xs:integer with an optional sign and leading zeros", () => {
    expect(parsePrimitive("123", "integer")).toBe(123);
    expect(parsePrimitive("+5", "integer")).toBe(5);
    expect(parsePrimitive("-7", "integer")).toBe(-7);
    expect(parsePrimitive("007", "integer")).toBe(7);
    expect(parsePrimitive(" 42\n", "integer")).toBe(42);
    expect(Object.is(parsePrimitive("-0", "integer"), 0)).toBe(true);
  });

  it("refuses an integer beyond the safe integers, which xs:integer allows", () => {
    expect(parsePrimitive("9007199254740991", "integer")).toBe(Number.MAX_SAFE_INTEGER);
    expect(parsePrimitive("-9007199254740991", "integer")).toBe(Number.MIN_SAFE_INTEGER);
    expect(() => parsePrimitive("9007199254740992", "integer")).toThrow(
      'The text "9007199254740992" is not an integer: expected an integer from -9007199254740991 to 9007199254740991.',
    );
    expect(() => parsePrimitive("-12345678901234567890", "integer")).toThrow(DataError);
  });

  it("refuses text that is not an xs:integer", () => {
    for (const text of ["", "1.0", "1e3", "0x10", "٣", "--1", "1 2", "+", "one"]) {
      expect(() => parsePrimitive(text, "integer"), text).toThrow(DataError);
    }
  });

  it("reads xs:double, including INF, -INF and NaN", () => {
    expect(parsePrimitive("23.23", "float")).toBe(23.23);
    expect(parsePrimitive("1E3", "float")).toBe(1000);
    expect(parsePrimitive("-1.5e-2", "float")).toBe(-0.015);
    expect(parsePrimitive(".5", "float")).toBe(0.5);
    expect(parsePrimitive("5.", "float")).toBe(5);
    expect(parsePrimitive("INF", "float")).toBe(Number.POSITIVE_INFINITY);
    expect(parsePrimitive("-INF", "float")).toBe(Number.NEGATIVE_INFINITY);
    expect(parsePrimitive("NaN", "float")).toBeNaN();
    expect(Object.is(parsePrimitive("-0", "float"), -0)).toBe(true);
    expect(parsePrimitive("1e999", "float")).toBe(Number.POSITIVE_INFINITY);
  });

  it("refuses text that is not an xs:double", () => {
    for (const text of ["", "inf", "Infinity", "nan", "1e", "e5", ".", "1,5", "0x1p3", "1_000"]) {
      expect(() => parsePrimitive(text, "float"), text).toThrow(DataError);
    }
  });

  it("writes the shortest decimal that reads back, and INF, -INF, NaN and -0", () => {
    expect(formatPrimitive(23.23, "float")).toBe("23.23");
    expect(formatPrimitive(5, "float")).toBe("5");
    expect(formatPrimitive(1e21, "float")).toBe("1e+21");
    expect(formatPrimitive(Number.POSITIVE_INFINITY, "float")).toBe("INF");
    expect(formatPrimitive(Number.NEGATIVE_INFINITY, "float")).toBe("-INF");
    expect(formatPrimitive(Number.NaN, "float")).toBe("NaN");
    expect(formatPrimitive(-0, "float")).toBe("-0");
    expect(formatPrimitive(0.1 + 0.2, "float")).toBe("0.30000000000000004");
  });

  it("keeps a string as it is, white space and all", () => {
    expect(parsePrimitive("  a \n b ", "string")).toBe("  a \n b ");
    expect(parsePrimitive("", "string")).toBe("");
    expect(formatPrimitive(" a  b ", "string")).toBe(" a  b ");
  });

  it("reads an identifier and drops the white space around it", () => {
    expect(parsePrimitive(" ID3\n", "identifier")).toBe("ID3");
    expect(() => parsePrimitive("1a", "identifier")).toThrow(
      'The text "1a" is not an identifier: expected an identifier.',
    );
    expect(() => parsePrimitive("a b", "identifier")).toThrow(DataError);
    expect(() => parsePrimitive("", "identifier")).toThrow(DataError);
  });

  it("reads a uri as its text with the white space around it dropped", () => {
    expect(parsePrimitive("  file:///somewhere.txt ", "uri")).toBe("file:///somewhere.txt");
    expect(formatPrimitive("file:///somewhere.txt", "uri")).toBe("file:///somewhere.txt");
  });

  it("reads a point as two integers, as in 118 184", () => {
    expect(parsePrimitive("118 184", "point")).toEqual([118, 184]);
    expect(parsePrimitive("  -3\t4 ", "point")).toEqual([-3, 4]);
    expect(formatPrimitive([118, 184], "point")).toBe("118 184");
    for (const text of ["", "1", "1 2 3", "1.5 2", "a b"])
      expect(() => parsePrimitive(text, "point"), text).toThrow(DataError);
  });

  it("reads a pair as two identifiers, as in W G1", () => {
    expect(parsePrimitive("W G1", "pair")).toEqual(["W", "G1"]);
    expect(formatPrimitive(["W", "G1"], "pair")).toBe("W G1");
    for (const text of ["", "W", "W G1 G2", "1 a", "a b:c"])
      expect(() => parsePrimitive(text, "pair"), text).toThrow(DataError);
  });

  it("reads a directed pair as source and destination in the order written", () => {
    expect(parsePrimitive("b a", "directedPair")).toEqual(["b", "a"]);
    expect(formatPrimitive(["b", "a"], "directedPair")).toBe("b a");
    expect(() => parsePrimitive("b", "directedPair")).toThrow(DataError);
  });

  it("reads a duration as seconds in the lexical form of xs:double", () => {
    expect(parsePrimitive("90", "duration")).toBe(90);
    expect(parsePrimitive("1.5", "duration")).toBe(1.5);
    expect(parsePrimitive("INF", "duration")).toBe(Number.POSITIVE_INFINITY);
    expect(formatPrimitive(1.5, "duration")).toBe("1.5");
    expect(() => parsePrimitive("PT1S", "duration")).toThrow(DataError);
  });

  it("reads a file as its reference alone, with the content type of unknown bytes", () => {
    expect(parsePrimitive(" uploads/17 ", "file")).toEqual({
      reference: "uploads/17",
      mimeType: "application/octet-stream",
    });
    expect(formatPrimitive({ reference: "uploads/17", mimeType: "text/plain", fileName: "a.txt" }, "file")).toBe(
      "uploads/17",
    );
    expect(() => parsePrimitive("  ", "file")).toThrow(DataError);
  });

  it("rejects arguments of other types", () => {
    expect(() => parsePrimitive(json("5"), "integer")).toThrow("The text must be a string, found 5.");
    expect(() => parsePrimitive(json("null"), "integer")).toThrow(DataError);
    expect(() => parsePrimitive("5", json('"number"'))).toThrow(DataError);
    expect(() => formatPrimitive(json('"5"'), "integer")).toThrow(DataError);
    expect(() => formatPrimitive(5, json("null"))).toThrow(DataError);
  });
});

describe("XML Schema dates and times", () => {
  it("accepts the dateTimes of the examples of results reporting and the forms of XML Schema", () => {
    // The first two are the datestamps of 1EdTech's results/report.xml and conformance-use-case-1.xml.
    for (const text of [
      "2020-08-25T18:19:20",
      "2021-02-22T22:27:45.988",
      "2000-02-29T00:00:00Z",
      "2020-01-01T24:00:00",
      "2020-01-01T24:00:00.000",
      "1999-12-31T23:59:59+14:00",
      "1999-12-31T23:59:59-05:30",
      "0001-01-01T00:00:00",
      "9999-12-31T23:59:59.999999999",
    ]) {
      expect(isXsdDateTime(text), text).toBe(true);
    }
  });

  it("rejects what is not a dateTime with a four-digit year", () => {
    for (const text of [
      "",
      "2020-08-25",
      "2020-08-25 18:19:20",
      "2020-08-25T18:19",
      "2021-02-29T00:00:00",
      "1900-02-29T00:00:00",
      "2020-13-01T00:00:00",
      "2020-00-10T00:00:00",
      "2020-04-31T00:00:00",
      "0000-01-01T00:00:00",
      "12345-01-01T00:00:00",
      "20-01-01T00:00:00",
      "2020-01-01T25:00:00",
      "2020-01-01T24:00:01",
      "2020-01-01T24:30:00",
      "2020-01-01T24:00:00.5",
      "2020-01-01T23:60:00",
      "2020-01-01T23:59:60",
      "2020-01-01T00:00:00+14:30",
      "2020-01-01T00:00:00+15:00",
      "2020-01-01T00:00:00+05:60",
      "2020-01-01T00:00:00+5",
      " 2020-01-01T00:00:00",
      "2020-01-01T00:00:00 ",
    ]) {
      expect(isXsdDateTime(text), text).toBe(false);
    }
  });

  it("accepts a date as the usage data writes lastUpdated: YYYY-MM-DD, with a day of that month", () => {
    // 2004-07-04 is the lastUpdated of 1EdTech's usageData/example.xml.
    for (const text of ["2004-07-04", "2024-02-29", "0001-01-01", "9999-12-31"])
      expect(isXsdDate(text), text).toBe(true);
  });

  it("rejects a value that is not text", () => {
    for (const value of [json("5"), json("null"), json('["2004-07-04"]'), json('{"a":1}')]) {
      expect(isXsdDate(value)).toBe(false);
      expect(isXsdDateTime(value)).toBe(false);
    }
  });

  it("rejects what the pattern of DateDType or the calendar does not allow", () => {
    for (const text of [
      "",
      "2023-02-29",
      "2004-7-4",
      "2004-07-04Z",
      "04-07-04",
      "2004-07-32",
      "0000-01-01",
      "2004-07-04T00:00:00",
    ]) {
      expect(isXsdDate(text), text).toBe(false);
    }
  });
});

describe("ISO 8601 durations", () => {
  it("reads the durations of an example result of 1EdTech", () => {
    expect(parseIsoDuration("PT2M0.049722S")).toBe(120.049722);
    expect(parseIsoDuration("PT9.590316S")).toBe(9.590316);
    expect(parseIsoDuration("-P1DT1H")).toBe(-90_000);
  });

  it("reads weeks, days, hours, minutes and seconds, and a fraction of the seconds", () => {
    expect(parseIsoDuration("PT1H30M")).toBe(5400);
    expect(parseIsoDuration("P1DT4H30M25S")).toBe(102_625);
    expect(parseIsoDuration("P1D")).toBe(86_400);
    expect(parseIsoDuration("P2W")).toBe(1_209_600);
    expect(parseIsoDuration("PT0.25S")).toBe(0.25);
    expect(parseIsoDuration("PT1M30.5S")).toBe(90.5);
    expect(parseIsoDuration("PT1M")).toBe(60);
    expect(parseIsoDuration("-PT5S")).toBe(-5);
  });

  it("refuses years and months, which have no fixed length, as in the example P10Y3M20DT4H30M25S of the binding", () => {
    expect(() => parseIsoDuration("P10Y3M20DT4H30M25S")).toThrow(
      'The duration "P10Y3M20DT4H30M25S" has years or months, which have no fixed length in seconds',
    );
    expect(() => parseIsoDuration("P1Y")).toThrow("years or months");
    expect(() => parseIsoDuration("P1M")).toThrow("years or months");
  });

  it("refuses text that is not a duration", () => {
    for (const text of ["", "P", "PT", "1H", "P1H", "PT1.5H", "PT1S2M", "pt1s", "PT-1S", "PT1,5S", "P1DT", "5"]) {
      expect(() => parseIsoDuration(text), text).toThrow(DataError);
    }
  });

  it("refuses a duration that is too long to be a number of seconds", () => {
    expect(() => parseIsoDuration(`PT${"9".repeat(400)}S`)).toThrow("too long");
  });

  it("rejects an argument of another type", () => {
    expect(() => parseIsoDuration(json("5"))).toThrow("The duration must be a string, found 5.");
  });
});

describe("identifier and integer lists", () => {
  it("reads identifiers separated by white space", () => {
    expect(parseIdentifierList(" a  b\tc\nd ")).toEqual(["a", "b", "c", "d"]);
    expect(parseIdentifierList("")).toEqual([]);
    expect(parseIdentifierList("only")).toEqual(["only"]);
  });

  it("rejects an item that is not an identifier", () => {
    expect(() => parseIdentifierList("a 1b")).toThrow('The item "1b" of an identifier list is not an identifier.');
    expect(() => parseIdentifierList("a,b")).toThrow(DataError);
  });

  it("writes identifiers separated by one space", () => {
    expect(formatIdentifierList(["a", "b"])).toBe("a b");
    expect(formatIdentifierList([])).toBe("");
    expect(() => formatIdentifierList(["a", "b c"])).toThrow(DataError);
    expect(() => formatIdentifierList(json('["a", 1]'))).toThrow(DataError);
  });

  it("reads xs:int integers separated by white space", () => {
    expect(parseIntegerList("1 -2 +3")).toEqual([1, -2, 3]);
    expect(parseIntegerList("")).toEqual([]);
    expect(parseIntegerList("2147483647 -2147483648")).toEqual([2147483647, -2147483648]);
  });

  it("rejects an item that is not an integer from -2147483648 to 2147483647", () => {
    expect(() => parseIntegerList("2147483648")).toThrow(DataError);
    expect(() => parseIntegerList("-2147483649")).toThrow(DataError);
    expect(() => parseIntegerList("1 1.5")).toThrow(DataError);
    expect(() => parseIntegerList("1, 2")).toThrow(DataError);
  });

  it("writes integers separated by one space", () => {
    expect(formatIntegerList([1, -2, 0])).toBe("1 -2 0");
    expect(formatIntegerList([])).toBe("");
    expect(() => formatIntegerList([2 ** 31])).toThrow(DataError);
    expect(() => formatIntegerList([1.5])).toThrow(DataError);
    expect(() => formatIntegerList(json('["1"]'))).toThrow(DataError);
  });

  it("rejects arguments of other types", () => {
    expect(() => parseIdentifierList(json("null"))).toThrow(DataError);
    expect(() => parseIntegerList(json("[1]"))).toThrow(DataError);
    expect(() => formatIdentifierList(json('"a"'))).toThrow("The identifiers must be an array");
    expect(() => formatIntegerList(json("{}"))).toThrow("The integers must be an array");
  });
});

describe("matching values", () => {
  const ids = (cardinality: "multiple" | "ordered", ...values: string[]): Value => {
    const built = container(cardinality, "identifier", values);
    if (built === null) throw new Error("empty");
    return built;
  };

  it("matches single values of the same base type and value", () => {
    expect(matchValues(single("integer", 5), single("integer", 5))).toBe(true);
    expect(matchValues(single("integer", 5), single("integer", 6))).toBe(false);
    expect(matchValues(nonNull(single("string", "a")), nonNull(single("string", "A")))).toBe(false);
    expect(matchValues(single("boolean", true), single("boolean", false))).toBe(false);
  });

  it("never matches values of another base type or cardinality", () => {
    expect(matchValues(single("integer", 1), single("float", 1))).toBe(false);
    expect(matchValues(single("identifier", "a"), nonNull(single("string", "a")))).toBe(false);
    expect(matchValues(single("identifier", "a"), ids("ordered", "a"))).toBe(false);
    expect(matchValues(ids("ordered", "a"), single("identifier", "a"))).toBe(false);
    expect(matchValues(ids("multiple", "a"), ids("ordered", "a"))).toBe(false);
    expect(matchValues(ids("ordered", "a"), nonNull(record([["a", single("identifier", "a")]])))).toBe(false);
  });

  it("compares floats as SameValueZero: NaN matches NaN and 0 matches -0", () => {
    expect(matchValues(single("float", Number.NaN), single("float", Number.NaN))).toBe(true);
    expect(matchValues(single("float", 0), single("float", -0))).toBe(true);
    expect(matchValues(single("float", 0.1 + 0.2), single("float", 0.3))).toBe(false);
  });

  it("ignores the order of a pair and keeps the order of a directed pair", () => {
    expect(matchValues(single("pair", ["A", "B"]), single("pair", ["B", "A"]))).toBe(true);
    expect(matchValues(single("pair", ["A", "B"]), single("pair", ["A", "C"]))).toBe(false);
    expect(matchValues(single("directedPair", ["A", "B"]), single("directedPair", ["A", "B"]))).toBe(true);
    expect(matchValues(single("directedPair", ["A", "B"]), single("directedPair", ["B", "A"]))).toBe(false);
  });

  it("matches points by both coordinates", () => {
    expect(matchValues(single("point", [1, 2]), single("point", [1, 2]))).toBe(true);
    expect(matchValues(single("point", [1, 2]), single("point", [2, 1]))).toBe(false);
  });

  it("matches files by reference, content type and name", () => {
    const file = (reference: string, mimeType: string, fileName?: string): Value =>
      single("file", fileName === undefined ? { reference, mimeType } : { reference, mimeType, fileName });
    expect(matchValues(file("r", "a/b", "n"), file("r", "a/b", "n"))).toBe(true);
    expect(matchValues(file("r", "a/b"), file("r", "a/b"))).toBe(true);
    expect(matchValues(file("r", "a/b", "n"), file("r", "a/b"))).toBe(false);
    expect(matchValues(file("r", "a/b"), file("s", "a/b"))).toBe(false);
    expect(matchValues(file("r", "a/b"), file("r", "a/c"))).toBe(false);
  });

  it("matches multiple containers with the same values in any order: [A,B,C] is [C,B,A]", () => {
    expect(matchValues(ids("multiple", "A", "B", "C"), ids("multiple", "C", "B", "A"))).toBe(true);
  });

  it("counts repeated values: [A,B,B,C] is an acceptable container, and it differs from [A,B,C]", () => {
    expect(matchValues(ids("multiple", "A", "B", "B", "C"), ids("multiple", "C", "B", "A", "B"))).toBe(true);
    expect(matchValues(ids("multiple", "A", "B", "B", "C"), ids("multiple", "A", "B", "C"))).toBe(false);
    expect(matchValues(ids("multiple", "A", "A", "B"), ids("multiple", "A", "B", "B"))).toBe(false);
  });

  it("matches the pairs of a multiple container whatever the order inside each pair", () => {
    const pairs = (...values: [string, string][]): Value => nonNull(container("multiple", "pair", values));
    expect(matchValues(pairs(["A", "B"], ["C", "D"]), pairs(["D", "C"], ["B", "A"]))).toBe(true);
    expect(matchValues(pairs(["A", "B"], ["C", "D"]), pairs(["A", "C"], ["B", "D"]))).toBe(false);
  });

  it("matches ordered containers only in the same order: [A,B,C] differs from [C,B,A]", () => {
    expect(matchValues(ids("ordered", "A", "B", "C"), ids("ordered", "A", "B", "C"))).toBe(true);
    expect(matchValues(ids("ordered", "A", "B", "C"), ids("ordered", "C", "B", "A"))).toBe(false);
    expect(matchValues(ids("ordered", "A", "B"), ids("ordered", "A", "B", "C"))).toBe(false);
  });

  it("matches records with the same fields and values, whatever their order", () => {
    const fields = (...entries: [string, Value][]): Value => nonNull(record(entries as [string, never][]));
    const rock = single("boolean", true);
    const paper = nonNull(single("string", "x"));
    expect(matchValues(fields(["rock", rock], ["paper", paper]), fields(["paper", paper], ["rock", rock]))).toBe(true);
    expect(matchValues(fields(["rock", rock]), fields(["rock", rock], ["paper", paper]))).toBe(false);
    expect(matchValues(fields(["rock", rock]), fields(["rock", single("boolean", false)]))).toBe(false);
    expect(matchValues(fields(["rock", rock]), fields(["scissors", rock]))).toBe(false);
    expect(matchValues(fields(["n", single("integer", 1)]), fields(["n", single("float", 1)]))).toBe(false);
  });

  it("rejects arguments of other types", () => {
    expect(() => matchValues(json("null"), single("integer", 1))).toThrow(
      "The first value must be an object, found null.",
    );
    expect(() => matchValues(single("integer", 1), json('"x"'))).toThrow(DataError);
  });
});

describe("promoting values", () => {
  it("turns an integer into a float and keeps its number, as weighted outcomes need", () => {
    expect(promote(single("integer", 3), "float")).toEqual(single("float", 3));
  });

  it("turns an integer into a duration, as assignment to a duration variable does", () => {
    expect(promote(single("integer", 90), "duration")).toEqual(single("duration", 90));
  });

  it("promotes every value of a container and keeps its order and cardinality", () => {
    expect(promote(nonNull(container("ordered", "integer", [3, 1, 3])), "float")).toEqual(
      container("ordered", "float", [3, 1, 3]),
    );
    expect(promote(nonNull(container("multiple", "integer", [2])), "float")).toEqual(
      container("multiple", "float", [2]),
    );
  });

  it("returns a value that has the target base type as it is", () => {
    const value = single("float", 1.5);
    expect(promote(value, "float")).toBe(value);
  });

  it("refuses every other conversion", () => {
    expect(() => promote(single("float", 1.5), "duration")).toThrow(
      "Only a value of base type integer can be promoted to duration, found base type float.",
    );
    expect(() => promote(nonNull(single("string", "a")), "float")).toThrow(DataError);
    expect(() => promote(nonNull(record([["a", single("integer", 1)]])), "float")).toThrow("found a record");
  });

  it("rejects arguments of other types", () => {
    expect(() => promote(json("null"), "float")).toThrow(DataError);
    expect(() => promote(single("integer", 1), json('"integer"'))).toThrow(
      'The base type to promote to must be "float" or "duration", found "integer".',
    );
  });
});

/** One row of the tables of the JSON binding: a value, its declaration and the JSON that the binding shows. */
interface BindingRow {
  readonly name: string;
  readonly declaration: ValueDeclaration;
  readonly value: Value | null;
  readonly json: unknown;
}

/** Returns the declaration of a variable with a cardinality and a base type. */
const declare = (cardinality: Cardinality, baseType: BaseType): ValueDeclaration => ({ cardinality, baseType });

// biome-ignore lint/suspicious/noApproximativeNumericConstant: the floats of the example of the binding, which is not pi.
const BINDING_FLOATS = [3.1415926, 12.34, 98.76];

const BINDING_EXAMPLES: readonly BindingRow[] = [
  // Base types
  { name: "NULL", declaration: declare("single", "integer"), value: null, json: { base: null } },
  {
    name: "boolean",
    declaration: declare("single", "boolean"),
    value: single("boolean", true),
    json: { base: { boolean: true } },
  },
  {
    name: "integer",
    declaration: declare("single", "integer"),
    value: single("integer", 123),
    json: { base: { integer: 123 } },
  },
  {
    name: "float",
    declaration: declare("single", "float"),
    value: single("float", 23.23),
    json: { base: { float: 23.23 } },
  },
  {
    name: "string",
    declaration: declare("single", "string"),
    value: nonNull(single("string", "string")),
    json: { base: { string: "string" } },
  },
  {
    name: "point",
    declaration: declare("single", "point"),
    value: single("point", [10, 20]),
    json: { base: { point: [10, 20] } },
  },
  {
    name: "pair",
    declaration: declare("single", "pair"),
    value: single("pair", ["A", "B"]),
    json: { base: { pair: ["A", "B"] } },
  },
  {
    name: "directedPair",
    declaration: declare("single", "directedPair"),
    value: single("directedPair", ["a", "b"]),
    json: { base: { directedPair: ["a", "b"] } },
  },
  {
    name: "uri",
    declaration: declare("single", "uri"),
    value: single("uri", "file:///somewhere.txt"),
    json: { base: { uri: "file:///somewhere.txt" } },
  },
  {
    name: "identifier",
    declaration: declare("single", "identifier"),
    value: single("identifier", "_identifier"),
    json: { base: { identifier: "_identifier" } },
  },
  // Multiple and ordered cardinality
  { name: "NULL list", declaration: declare("multiple", "integer"), value: null, json: { list: null } },
  {
    name: "boolean list",
    declaration: declare("multiple", "boolean"),
    value: container("multiple", "boolean", [true, false, true, true]),
    json: { list: { boolean: [true, false, true, true] } },
  },
  {
    name: "integer list",
    declaration: declare("ordered", "integer"),
    value: container("ordered", "integer", [2, 3, 5, 7, 11, 13]),
    json: { list: { integer: [2, 3, 5, 7, 11, 13] } },
  },
  {
    name: "float list",
    declaration: declare("multiple", "float"),
    value: container("multiple", "float", BINDING_FLOATS),
    json: { list: { float: BINDING_FLOATS } },
  },
  {
    name: "string list",
    declaration: declare("multiple", "string"),
    value: container("multiple", "string", ["Another", "And Another"]),
    json: { list: { string: ["Another", "And Another"] } },
  },
  {
    name: "point list",
    declaration: declare("multiple", "point"),
    value: container("multiple", "point", [
      [123, 456],
      [640, 480],
    ]),
    json: {
      list: {
        point: [
          [123, 456],
          [640, 480],
        ],
      },
    },
  },
  {
    name: "pair list",
    declaration: declare("multiple", "pair"),
    value: container("multiple", "pair", [
      ["A", "B"],
      ["D", "C"],
    ]),
    json: {
      list: {
        pair: [
          ["A", "B"],
          ["D", "C"],
        ],
      },
    },
  },
  {
    name: "directedPair list",
    declaration: declare("ordered", "directedPair"),
    value: container("ordered", "directedPair", [
      ["A", "B"],
      ["C", "D"],
    ]),
    json: {
      list: {
        directedPair: [
          ["A", "B"],
          ["C", "D"],
        ],
      },
    },
  },
  {
    name: "uri list",
    declaration: declare("multiple", "uri"),
    value: container("multiple", "uri", ["file:///aFile.txt", "file:///abc.txt"]),
    json: { list: { uri: ["file:///aFile.txt", "file:///abc.txt"] } },
  },
  {
    name: "identifier list",
    declaration: declare("multiple", "identifier"),
    value: container("multiple", "identifier", ["_id1", "id2", "ID3"]),
    json: { list: { identifier: ["_id1", "id2", "ID3"] } },
  },
  // Record cardinality
  { name: "NULL record", declaration: { cardinality: "record" }, value: null, json: { record: null } },
];

describe("the JSON of a value", () => {
  for (const { name, declaration, value, json: expected } of BINDING_EXAMPLES) {
    it(`writes and reads ${name} as the binding shows`, () => {
      expect(toJsonValue(value, declaration)).toEqual(expected);
      expect(fromJsonValue(expected, declaration)).toEqual(value);
    });
  }

  it("writes and reads the record of the binding without its NULL field", () => {
    const appendix = {
      record: [
        { name: "rock", base: { boolean: true } },
        { name: "paper", base: { string: "Four score and seven years ago..." } },
        { name: "scissors", base: { integer: 4 } },
        { name: "foo", base: null },
      ],
    };
    const decoded = fromJsonValue(appendix, { cardinality: "record" });
    expect(decoded).toEqual(
      record([
        ["rock", single("boolean", true)],
        ["paper", nonNull(single("string", "Four score and seven years ago..."))],
        ["scissors", single("integer", 4)],
      ]),
    );
    expect(toJsonValue(decoded, { cardinality: "record" })).toEqual({ record: appendix.record.slice(0, 3) });
  });

  it("reads a record whose fields are all NULL as NULL, and an empty record too", () => {
    expect(fromJsonValue({ record: [{ name: "a", base: null }] }, { cardinality: "record" })).toBeNull();
    expect(fromJsonValue({ record: [{ name: "a", base: { string: "" } }] }, { cardinality: "record" })).toBeNull();
    expect(fromJsonValue({ record: [] }, { cardinality: "record" })).toBeNull();
  });

  it("keeps a field named __proto__ as data", () => {
    const decoded = fromJsonValue(JSON.parse('{"record":[{"name":"__proto__","base":{"integer":1}}]}'), {
      cardinality: "record",
    });
    expect(decoded).toEqual(record([["__proto__", single("integer", 1)]]));
  });

  it("reads an empty string and an empty list as NULL", () => {
    expect(fromJsonValue({ base: { string: "" } }, declare("single", "string"))).toBeNull();
    expect(fromJsonValue({ list: { integer: [] } }, declare("multiple", "integer"))).toBeNull();
  });

  it("reads intOrIdentifier as the declared integer or identifier", () => {
    expect(fromJsonValue({ base: { intOrIdentifier: 123456 } }, declare("single", "integer"))).toEqual(
      single("integer", 123456),
    );
    expect(fromJsonValue({ base: { intOrIdentifier: "_id" } }, declare("single", "identifier"))).toEqual(
      single("identifier", "_id"),
    );
    expect(fromJsonValue({ list: { intOrIdentifier: [2, 3] } }, declare("ordered", "integer"))).toEqual(
      container("ordered", "integer", [2, 3]),
    );
  });

  it("reads intOrIdentifier in a record by its JSON type: a number is an integer, a string an identifier", () => {
    const decoded = fromJsonValue(
      {
        record: [
          { name: "n", base: { intOrIdentifier: 7 } },
          { name: "i", base: { intOrIdentifier: "x" } },
        ],
      },
      { cardinality: "record" },
    );
    expect(decoded).toEqual(
      record([
        ["n", single("integer", 7)],
        ["i", single("identifier", "x")],
      ]),
    );
  });

  it("refuses intOrIdentifier for another declaration and a list that mixes both", () => {
    expect(() => fromJsonValue({ base: { intOrIdentifier: 1 } }, declare("single", "float"))).toThrow(DataError);
    expect(() => fromJsonValue({ base: { intOrIdentifier: "x" } }, declare("single", "integer"))).toThrow(DataError);
    expect(() => fromJsonValue({ list: { intOrIdentifier: [2, "_id"] } }, declare("multiple", "integer"))).toThrow(
      DataError,
    );
  });

  it("writes a file as its reference with the content type and name, and reads it back", () => {
    const file = single("file", { reference: "files/1", mimeType: "text/plain", fileName: "helloworld.txt" });
    const written = { base: { file: { reference: "files/1", mime: "text/plain", name: "helloworld.txt" } } };
    expect(toJsonValue(file, declare("single", "file"))).toEqual(written);
    expect(fromJsonValue(written, declare("single", "file"))).toEqual(file);
    const unnamed = single("file", { reference: "files/2", mimeType: "image/png" });
    expect(toJsonValue(unnamed, declare("single", "file"))).toStrictEqual({
      base: { file: { reference: "files/2", mime: "image/png" } },
    });
  });

  it("refuses a file with its bytes inline, as the binding shows it", () => {
    const inline = { base: { file: { data: "cGxlYXN1cmUu", mime: "text/plain", name: "helloworld.txt" } } };
    expect(() => fromJsonValue(inline, declare("single", "file"))).toThrow(
      'A file must be a reference, not inline "data"',
    );
    expect(() =>
      fromJsonValue({ base: { file: { reference: "r", mime: "a/b", size: 1 } } }, declare("single", "file")),
    ).toThrow(DataError);
    expect(() => fromJsonValue({ base: { file: { reference: "r" } } }, declare("single", "file"))).toThrow(DataError);
    expect(() => fromJsonValue({ base: { file: "r" } }, declare("single", "file"))).toThrow(DataError);
  });

  it("writes a duration as PT<seconds>S with the shortest decimal", () => {
    const duration = (seconds: number): unknown =>
      toJsonValue(single("duration", seconds), declare("single", "duration"));
    expect(duration(0)).toEqual({ base: { duration: "PT0S" } });
    expect(duration(90)).toEqual({ base: { duration: "PT90S" } });
    expect(duration(1.5)).toEqual({ base: { duration: "PT1.5S" } });
    expect(duration(-2.5)).toEqual({ base: { duration: "-PT2.5S" } });
    expect(duration(1e21)).toEqual({ base: { duration: "PT1000000000000000000000S" } });
    expect(duration(1.5e-7)).toEqual({ base: { duration: "PT0.00000015S" } });
    expect(duration(123456.789)).toEqual({ base: { duration: "PT123456.789S" } });
  });

  it("refuses a duration with years or months, and a duration that is not a string", () => {
    const decode = (duration: unknown): unknown => fromJsonValue({ base: { duration } }, declare("single", "duration"));
    expect(() => decode("P10Y3M20DT4H30M25S")).toThrow(
      'The duration "P10Y3M20DT4H30M25S" has years or months, which have no fixed length in seconds',
    );
    expect(() => fromJsonValue({ list: { duration: ["PT1S", "P1M"] } }, declare("ordered", "duration"))).toThrow(
      "years or months",
    );
    expect(() => decode(5)).toThrow(DataError);
  });

  it("writes the numbers that JSON cannot carry as their xs:double spelling and reads them back", () => {
    for (const baseType of ["float", "duration"] as const) {
      const declaration = declare("single", baseType);
      for (const [number, spelling] of [
        [Number.NaN, "NaN"],
        [Number.POSITIVE_INFINITY, "INF"],
        [Number.NEGATIVE_INFINITY, "-INF"],
        [-0, "-0"],
      ] as const) {
        const written = toJsonValue(single(baseType, number), declaration);
        expect(written, `${baseType} ${spelling}`).toEqual({ base: { [baseType]: spelling } });
        const read = fromJsonValue(written, declaration) as { value: number };
        expect(Object.is(read.value, number)).toBe(true);
      }
    }
    expect(() => fromJsonValue({ base: { float: "abc" } }, declare("single", "float"))).toThrow(
      'A float must be a number or one of "NaN", "INF", "-INF" and "-0", found "abc".',
    );
    expect(() => fromJsonValue({ base: { float: true } }, declare("single", "float"))).toThrow(DataError);
  });

  it("refuses a JSON integer that is not a safe integer", () => {
    expect(() => fromJsonValue({ base: { integer: 1.5 } }, declare("single", "integer"))).toThrow(DataError);
    expect(() =>
      fromJsonValue(JSON.parse('{"base":{"integer":9007199254740993}}'), declare("single", "integer")),
    ).toThrow(DataError);
    expect(() => fromJsonValue({ base: { integer: "1" } }, declare("single", "integer"))).toThrow(DataError);
  });

  it("refuses JSON of another shape than its declaration", () => {
    const decode = (value: unknown, declaration: ValueDeclaration): unknown => fromJsonValue(value, declaration);
    expect(() => decode({ list: null }, declare("single", "integer"))).toThrow(
      'The JSON of a single value is invalid: missing the property "base".',
    );
    expect(() => decode({ base: null }, declare("multiple", "integer"))).toThrow(DataError);
    expect(() => decode({ base: null }, { cardinality: "record" })).toThrow(DataError);
    expect(() => decode({ base: { integer: 1 }, list: null }, declare("single", "integer"))).toThrow(DataError);
    expect(() => decode({}, declare("single", "integer"))).toThrow(
      'The JSON of a single value is invalid: missing the property "base".',
    );
    expect(() => decode({ base: { float: 1 } }, declare("single", "integer"))).toThrow(
      'The base of a single value must have the property "integer", found "float".',
    );
    expect(() => decode({ base: { integer: 1, float: 1 } }, declare("single", "integer"))).toThrow(DataError);
    expect(() => decode({ base: {} }, declare("single", "integer"))).toThrow(DataError);
    expect(() => decode({ base: { unknown: 1 } }, declare("single", "integer"))).toThrow(DataError);
    expect(() => decode({ list: { integer: 1 } }, declare("multiple", "integer"))).toThrow(
      "The list of base type integer is invalid: expected an array, found 1.",
    );
    expect(() => decode({ list: { integer: [1, "2"] } }, declare("multiple", "integer"))).toThrow(DataError);
    expect(() => decode({ list: { string: ["a", ""] } }, declare("multiple", "string"))).toThrow("empty string");
    expect(() => decode({ base: { point: [1, 2, 3] } }, declare("single", "point"))).toThrow(DataError);
    expect(() => decode({ base: { pair: ["a", 1] } }, declare("single", "pair"))).toThrow(DataError);
    expect(() => decode({ base: { boolean: "true" } }, declare("single", "boolean"))).toThrow(DataError);
    for (const bad of [null, 5, "x", [], true])
      expect(() => decode(bad, declare("single", "integer"))).toThrow(DataError);
  });

  it("refuses a record of another shape", () => {
    const decode = (value: unknown): unknown => fromJsonValue({ record: value }, { cardinality: "record" });
    expect(() => decode({})).toThrow("A record is invalid: expected an array, found an object.");
    expect(() => decode([5])).toThrow(DataError);
    expect(() => decode([{ name: "a" }])).toThrow('A record is invalid at [0]: missing the property "base".');
    expect(() => decode([{ name: "a", base: null, extra: 1 }])).toThrow(DataError);
    expect(() => decode([{ name: "not an id", base: { integer: 1 } }])).toThrow(DataError);
    expect(() => decode([{ name: 5, base: { integer: 1 } }])).toThrow(DataError);
    expect(() =>
      decode([
        { name: "a", base: { integer: 1 } },
        { name: "a", base: { integer: 2 } },
      ]),
    ).toThrow("twice");
    expect(() => decode([{ name: "a", base: { integer: "x" } }])).toThrow(DataError);
    expect(() => decode([{ name: "a", base: { intOrIdentifier: true } }])).toThrow(DataError);
  });

  it("refuses a value that differs from its declaration, and a value that is not one", () => {
    expect(() => toJsonValue(single("integer", 1), declare("single", "float"))).toThrow(
      "The value is single integer, but the declaration says single float.",
    );
    expect(() => toJsonValue(single("integer", 1), declare("multiple", "integer"))).toThrow(DataError);
    expect(() => toJsonValue(single("integer", 1), { cardinality: "record" })).toThrow("says a record");
    expect(() => toJsonValue(container("ordered", "integer", [1]), declare("multiple", "integer"))).toThrow(DataError);
    expect(() =>
      toJsonValue(json('{"cardinality":"single","baseType":"integer","value":"x"}'), declare("single", "integer")),
    ).toThrow(DataError);
    expect(() =>
      toJsonValue(json('{"cardinality":"single","baseType":"string","value":""}'), declare("single", "string")),
    ).toThrow("empty string");
    expect(() =>
      toJsonValue(json('{"cardinality":"multiple","baseType":"integer","values":[]}'), declare("multiple", "integer")),
    ).toThrow(DataError);
    expect(() => toJsonValue(json('{"cardinality":"record","fields":{}}'), { cardinality: "record" })).toThrow(
      DataError,
    );
    expect(() => toJsonValue(json("{}"), declare("single", "integer"))).toThrow(DataError);
    expect(() => toJsonValue(json('"x"'), declare("single", "integer"))).toThrow(DataError);
  });

  it("ignores a base type declared for a record and refuses a declaration that is not one", () => {
    expect(toJsonValue(null, { cardinality: "record", baseType: "integer" })).toEqual({ record: null });
    expect(() => toJsonValue(null, { cardinality: "record", baseType: json('"unknown"') })).toThrow(DataError);
    expect(() => toJsonValue(null, json("null"))).toThrow(
      "The declaration is invalid: expected an object, found null.",
    );
    expect(() => toJsonValue(null, json('{"cardinality":"list","baseType":"integer"}'))).toThrow(DataError);
    expect(() => toJsonValue(null, json('{"cardinality":"single"}'))).toThrow(DataError);
    expect(() => fromJsonValue({ base: null }, json("5"))).toThrow(DataError);
  });

  it("reads or refuses arbitrary JSON with a DataError, and nothing else, whatever the declaration", () => {
    const declarations: readonly [ValueDeclaration, unknown][] = [
      [declare("single", "integer"), { base: { integer: 1 } }],
      [declare("multiple", "float"), { list: { float: [1.5, "NaN"] } }],
      [declare("ordered", "duration"), { list: { duration: ["PT1S"] } }],
      [declare("single", "file"), { base: { file: { reference: "r", mime: "text/plain" } } }],
      [{ cardinality: "record" }, { record: [{ name: "a", base: { integer: 1 } }] }],
    ];
    for (const [declaration, example] of declarations) fuzzJson((json) => fromJsonValue(json, declaration), [example]);
  });
});

describe("wire values", () => {
  it("keeps a string exactly, line breaks included, so that an essay travels in state as written", () => {
    const essay = nonNull(single("string", "Dear Ana,\r\n\n  I arrived.\t"));
    const wire = toWireValue(essay, declare("single", "string"));
    expect(fromWireValue(JSON.parse(JSON.stringify(wire)))).toEqual(essay);
  });

  it("wraps the JSON of a value in its cardinality and base type", () => {
    expect(toWireValue(single("integer", 5), declare("single", "integer"))).toEqual({
      cardinality: "single",
      baseType: "integer",
      value: { base: { integer: 5 } },
    });
    expect(
      toWireValue(
        container("ordered", "point", [
          [1, 2],
          [3, 4],
        ]),
        declare("ordered", "point"),
      ),
    ).toEqual({
      cardinality: "ordered",
      baseType: "point",
      value: {
        list: {
          point: [
            [1, 2],
            [3, 4],
          ],
        },
      },
    });
  });

  it("has no base type for a record", () => {
    const wire = toWireValue(record([["a", single("integer", 1)]]), { cardinality: "record" });
    expect(wire).toStrictEqual({ cardinality: "record", value: { record: [{ name: "a", base: { integer: 1 } }] } });
  });

  it("keeps the type of a NULL: the wire value of NULL has null for its value", () => {
    expect(toWireValue(null, declare("multiple", "float"))).toStrictEqual({
      cardinality: "multiple",
      baseType: "float",
      value: null,
    });
    expect(fromWireValue({ cardinality: "multiple", baseType: "float", value: null })).toBeNull();
    expect(fromWireValue({ cardinality: "single", baseType: "integer", value: { base: null } })).toBeNull();
  });

  it("tells multiple from ordered, which the JSON binding does not", () => {
    const ordered = container("ordered", "identifier", ["a", "b"]);
    const multiple = container("multiple", "identifier", ["a", "b"]);
    expect(toJsonValue(ordered, declare("ordered", "identifier"))).toEqual(
      toJsonValue(multiple, declare("multiple", "identifier")),
    );
    expect(fromWireValue(toWireValue(ordered, declare("ordered", "identifier")))).toEqual(ordered);
    expect(fromWireValue(toWireValue(multiple, declare("multiple", "identifier")))).toEqual(multiple);
  });

  it("refuses a duration with years or months", () => {
    expect(() =>
      fromWireValue({ cardinality: "single", baseType: "duration", value: { base: { duration: "P1Y2M" } } }),
    ).toThrow("years or months");
  });

  it("refuses what is not a wire value", () => {
    expect(() => fromWireValue(json("null"))).toThrow("A wire value is invalid: expected an object, found null.");
    expect(() => fromWireValue(json("[]"))).toThrow(DataError);
    expect(() => fromWireValue({ baseType: "integer", value: null })).toThrow(DataError);
    expect(() => fromWireValue({ cardinality: "list", baseType: "integer", value: null })).toThrow(DataError);
    expect(() => fromWireValue({ cardinality: "single", value: null })).toThrow(DataError);
    expect(() => fromWireValue({ cardinality: "single", baseType: "unknown", value: null })).toThrow(DataError);
    expect(() => fromWireValue({ cardinality: "record", baseType: "integer", value: null })).toThrow(
      'A wire value is invalid: unexpected property "baseType".',
    );
    expect(() => fromWireValue({ cardinality: "single", baseType: "integer" })).toThrow(
      'A wire value is invalid: missing the property "value".',
    );
    expect(() => fromWireValue({ cardinality: "single", baseType: "integer", value: null, extra: 1 })).toThrow(
      DataError,
    );
    expect(() => fromWireValue({ cardinality: "single", baseType: "integer", value: { base: { float: 1 } } })).toThrow(
      DataError,
    );
    expect(() => fromWireValue({ cardinality: "single", baseType: "integer", value: { list: null } })).toThrow(
      DataError,
    );
    expect(() =>
      fromWireValue({ cardinality: "ordered", baseType: "integer", value: { base: { integer: 1 } } }),
    ).toThrow(DataError);
  });

  it("refuses a value that differs from its declaration", () => {
    expect(() => toWireValue(single("integer", 1), declare("single", "string"))).toThrow(DataError);
    expect(() => toWireValue(null, json("{}"))).toThrow(DataError);
  });

  it("reads or refuses arbitrary JSON with a DataError, and nothing else", () => {
    fuzzJson(fromWireValue, [
      toWireValue(single("integer", 1), declare("single", "integer")),
      toWireValue(container("ordered", "identifier", ["a", "b"]), declare("ordered", "identifier")),
      toWireValue(record([["a", single("float", 1.5)]]), { cardinality: "record" }),
      toWireValue(single("duration", 2.5), declare("single", "duration")),
      toWireValue(null, declare("multiple", "float")),
    ]);
  });
});

describe("base64 and base64url", () => {
  // The test vectors of RFC 4648, with the base64url of each beside them, which has no padding.
  const Vectors: readonly (readonly [text: string, base64: string, base64url: string])[] = [
    ["", "", ""],
    ["f", "Zg==", "Zg"],
    ["fo", "Zm8=", "Zm8"],
    ["foo", "Zm9v", "Zm9v"],
    ["foob", "Zm9vYg==", "Zm9vYg"],
    ["fooba", "Zm9vYmE=", "Zm9vYmE"],
    ["foobar", "Zm9vYmFy", "Zm9vYmFy"],
  ];
  const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

  it.each(Vectors)("encodes %j as the test vectors of RFC 4648 do", (text, base64, base64url) => {
    expect(encodeBase64(bytesOf(text))).toBe(base64);
    expect(encodeBase64Url(bytesOf(text))).toBe(base64url);
  });

  it.each(Vectors)("decodes the test vectors of RFC 4648 to %j", (text, base64, base64url) => {
    expect(decodeBase64(base64)).toEqual(bytesOf(text));
    expect(decodeBase64Url(base64url)).toEqual(bytesOf(text));
  });

  it("writes the digits 62 and 63 as + and / in base64 and as - and _ in base64url", () => {
    const bytes = Uint8Array.from([0xfb, 0xff, 0xbf]);
    expect(encodeBase64(bytes)).toBe("+/+/");
    expect(encodeBase64Url(bytes)).toBe("-_-_");
    expect(decodeBase64("+/+/")).toEqual(bytes);
    expect(decodeBase64Url("-_-_")).toEqual(bytes);
  });

  it("decodes only the canonical encoding of bytes", () => {
    const base64 = [
      "Zh==", // bits after the last byte that are not zero: "f" is "Zg=="
      "Zm9=", // the same after two bytes: "fo" is "Zm8="
      "Zg", // padding missing
      "Zg=", // padding too short
      "Zg===", // padding too long, and the length is not a multiple of 4
      "Z===", // a lone digit stands for no byte
      "====",
      "Zg=A", // padding in the middle
      "Zm9v\n", // characters outside the alphabet
      " Zm9v",
      "Zm 9v",
      "-_-_", // the alphabet of base64url
      "Zm9é",
    ];
    for (const text of base64) expect(decodeBase64(text), JSON.stringify(text)).toBeUndefined();
    const base64url = [
      "Zh", // bits after the last byte that are not zero
      "Zi",
      "Zj",
      "Zm9", // a base64url text of length 4k + 3 holds 2 bytes: "Zm8" is canonical
      "Zm-",
      "Zm_",
      "Z", // a lone digit stands for no byte
      "Zg==", // padding is not part of the text
      "Zm9v\n",
      "+/+/", // the alphabet of base64
      "Zm9é",
    ];
    for (const text of base64url) expect(decodeBase64Url(text), JSON.stringify(text)).toBeUndefined();
  });

  it("rejects arguments of other types", () => {
    expect(() => encodeBase64(json("[1]"))).toThrow(
      new DataError("The bytes to encode must be a Uint8Array, found an array."),
    );
    expect(() => encodeBase64Url(json("null"))).toThrow(DataError);
    expect(() => decodeBase64(json("5"))).toThrow(new DataError("The text to decode must be a string, found 5."));
    expect(() => decodeBase64Url(json("null"))).toThrow(DataError);
  });
});

describe("regular expressions", () => {
  const matches = (pattern: string, text: string): boolean => compileXsdRegex(pattern).matches(text);

  describe("the language", () => {
    it("matches the whole text, never a part of it", () => {
      expect(matches("abc", "abc")).toBe(true);
      expect(matches("abc", "abcd")).toBe(false);
      expect(matches("abc", "xabc")).toBe(false);
      expect(matches("", "")).toBe(true);
      expect(matches("", "a")).toBe(false);
      expect(matches("a*", "")).toBe(true);
    });

    it("treats ^ and $ as ordinary characters", () => {
      expect(matches("^a$", "^a$")).toBe(true);
      expect(matches("^a$", "a")).toBe(false);
      expect(matches("a^b", "a^b")).toBe(true);
    });

    it("repeats with ?, *, + and counted quantifiers", () => {
      expect(["", "a"].map((text) => matches("a?", text))).toEqual([true, true]);
      expect(matches("a?", "aa")).toBe(false);
      expect(["", "a", "aaa"].map((text) => matches("a*", text))).toEqual([true, true, true]);
      expect(["", "a", "aaa"].map((text) => matches("a+", text))).toEqual([false, true, true]);
      expect(["a", "aa", "aaa", "aaaa"].map((text) => matches("a{2,3}", text))).toEqual([false, true, true, false]);
      expect(["a", "aa", "aaa"].map((text) => matches("a{2,}", text))).toEqual([false, true, true]);
      expect(["", "a", "aa"].map((text) => matches("a{2}", text))).toEqual([false, false, true]);
      expect(matches("a{0}", "")).toBe(true);
      expect(matches("a{0}", "a")).toBe(false);
      expect(matches("(ab){2}", "abab")).toBe(true);
      expect(matches("(ab){2}", "aba")).toBe(false);
    });

    it("chooses between branches, and a branch can be empty", () => {
      expect(["a", "b", "c", "ab"].map((text) => matches("a|b", text))).toEqual([true, true, false, false]);
      expect(["", "a", "b"].map((text) => matches("a|", text))).toEqual([true, true, false]);
      expect(matches("(a|b)c", "bc")).toBe(true);
      expect(matches("()", "")).toBe(true);
    });

    it("has the dot match any character but a line feed or a carriage return", () => {
      expect(matches(".", "a")).toBe(true);
      expect(matches(".", "\u2028")).toBe(true);
      expect(matches(".", "\n")).toBe(false);
      expect(matches(".", "\r")).toBe(false);
      expect(matches(".", "")).toBe(false);
      expect(matches("\\.", ".")).toBe(true);
      expect(matches("\\.", "a")).toBe(false);
    });

    it("reads a surrogate pair as one character", () => {
      expect(matches(".", "\u{1d49c}")).toBe(true);
      expect(matches("..", "\u{1d49c}")).toBe(false);
      expect(matches("\\p{L}", "\u{1d49c}")).toBe(true);
      expect(matches("[\u{1d49c}-\u{1d4b5}]+", "\u{1d49c}\u{1d4b5}")).toBe(true);
      expect(matches("\\p{IsHighSurrogates}", "\ud800")).toBe(true);
    });

    it("has the single character escapes", () => {
      expect(matches("\\n\\r\\t", "\n\r\t")).toBe(true);
      expect(matches("\\\\\\|\\?\\*\\+\\(\\)\\{\\}\\-\\[\\]\\^", "\\|?*+(){}-[]^")).toBe(true);
      expect(matches("[\\n\\t]+", "\n\t\n")).toBe(true);
      expect(matches("[\\-a]+", "a-a")).toBe(true);
      expect(matches("[a\\-z]+", "a-z")).toBe(true);
      expect(matches("[!-\\-]+", "!#-")).toBe(true);
      expect(matches("[!-\\-]", "a")).toBe(false);
    });

    it("has character classes with ranges, negation and a hyphen at the start or the end", () => {
      expect(["a", "m", "z", "A"].map((text) => matches("[a-z]", text))).toEqual([true, true, true, false]);
      expect(["a", "A", "-"].map((text) => matches("[^a-z]", text))).toEqual([false, true, true]);
      expect(["a", "-", "b"].map((text) => matches("[a-]", text))).toEqual([true, true, false]);
      expect(["a", "-", "b"].map((text) => matches("[-a]", text))).toEqual([true, true, false]);
      expect(["a", "-", "b"].map((text) => matches("[^-a]", text))).toEqual([false, false, true]);
      expect(matches("[a^]+", "^a")).toBe(true);
      expect(matches("[.]", ".")).toBe(true);
      expect(matches("[.]", "a")).toBe(false);
    });

    it("subtracts a class from a class", () => {
      expect(["b", "a", "e"].map((text) => matches("[a-z-[aeiou]]", text))).toEqual([true, false, false]);
      expect(["a", "x", "y"].map((text) => matches("[^a-c-[x]]", text))).toEqual([false, false, true]);
      expect(["a", "b", "c"].map((text) => matches("[a-c-[b-[c]]]", text))).toEqual([true, false, true]);
      expect(matches("[\\p{L}-[\\p{Lu}]]+", "abc")).toBe(true);
      expect(matches("[\\p{L}-[\\p{Lu}]]+", "aBc")).toBe(false);
    });

    it("has \\s, \\S, \\d, \\D, \\w and \\W", () => {
      expect(matches("\\s+", " \t\n\r")).toBe(true);
      expect(matches("\\s", "\u00a0")).toBe(false);
      expect(matches("\\S+", "ab")).toBe(true);
      expect(matches("\\d+", "0123")).toBe(true);
      expect(matches("\\d", "٣")).toBe(true);
      expect(matches("\\d", "²")).toBe(false);
      expect(matches("\\D", "a")).toBe(true);
      expect(matches("\\D", "5")).toBe(false);
      expect(matches("\\w+", "aé5日")).toBe(true);
      expect(matches("\\w", "_")).toBe(false);
      expect(matches("\\w", "-")).toBe(false);
      expect(matches("\\w", " ")).toBe(false);
      expect(matches("\\W+", " -!")).toBe(true);
      expect(matches("[\\w-[\\d]]+", "ab")).toBe(true);
      expect(matches("[\\w-[\\d]]+", "a1")).toBe(false);
    });

    it("has \\i and \\c for XML names (XML 1.0, fifth edition)", () => {
      expect(["a-b.c", "_x", ":a", "é1", "1a", "-a", ""].map((text) => matches("\\i\\c*", text))).toEqual([
        true,
        true,
        true,
        true,
        false,
        false,
        false,
      ]);
      expect(matches("\\I", "1")).toBe(true);
      expect(matches("\\C", " ")).toBe(true);
      expect(matches("\\C", "a")).toBe(false);
    });
  });

  describe("general categories", () => {
    // A character of each category, from UnicodeData.txt.
    const samples: readonly [string, string][] = [
      ["Lu", "A"],
      ["Ll", "a"],
      ["Lt", "\u01c5"],
      ["Lm", "\u02b0"],
      ["Lo", "\u3042"],
      ["Mn", "\u0301"],
      ["Mc", "\u0903"],
      ["Me", "\u20dd"],
      ["Nd", "\u0663"],
      ["Nl", "\u2167"],
      ["No", "\u00b2"],
      ["Pc", "_"],
      ["Pd", "-"],
      ["Ps", "("],
      ["Pe", ")"],
      ["Pi", "\u00ab"],
      ["Pf", "\u00bb"],
      ["Po", "!"],
      ["Zs", " "],
      ["Zl", "\u2028"],
      ["Zp", "\u2029"],
      ["Sm", "+"],
      ["Sc", "$"],
      ["Sk", "^"],
      ["So", "\u00a9"],
      ["Cc", "\u0001"],
      ["Cf", "\u00ad"],
      ["Co", "\ue000"],
      ["Cn", "\u0378"],
    ];

    it("has \\p{..} for the 29 categories of the language, each matching only its own characters", () => {
      for (const [category, character] of samples) {
        for (const [other] of samples) {
          expect(matches(`\\p{${other}}`, character), `\\p{${other}} on a ${category}`).toBe(other === category);
        }
      }
    });

    it("has \\p{..} for the major classes and \\P{..} for their complement", () => {
      for (const [category, character] of samples) {
        for (const major of ["L", "M", "N", "P", "Z", "S", "C"]) {
          const inClass = category.startsWith(major);
          expect(matches(`\\p{${major}}`, character), `\\p{${major}} on a ${category}`).toBe(inClass);
          expect(matches(`\\P{${major}}`, character), `\\P{${major}} on a ${category}`).toBe(!inClass);
        }
      }
    });

    it("counts a lone surrogate among the others, Cs, and does not name Cs", () => {
      expect(matches("\\p{C}", "\ud800")).toBe(true);
      expect(matches("\\w", "\ud800")).toBe(false);
      expect(() => compileXsdRegex("\\p{Cs}")).toThrow(DataError);
    });

    it("knows the characters of Unicode 17 and not those of later versions", () => {
      expect(matches("\\p{L}", "\u{10d4a}")).toBe(true);
      expect(matches("\\p{Cn}", "\u{323b0}")).toBe(false);
    });
  });

  describe("blocks", () => {
    it("has \\p{IsName} for the blocks of Unicode 3.1, under the names of XML Schema", () => {
      expect(matches("\\p{IsBasicLatin}+", "Hello, world!")).toBe(true);
      expect(matches("\\p{IsBasicLatin}", "é")).toBe(false);
      expect(matches("\\p{IsLatin-1Supplement}", "é")).toBe(true);
      expect(matches("\\p{IsGreek}+", "\u0370\u03ff")).toBe(true);
      expect(matches("\\p{IsGreek}", "\u0400")).toBe(false);
      expect(matches("\\p{IsCJKUnifiedIdeographs}+", "日本語")).toBe(true);
      expect(matches("\\p{IsCombiningMarksforSymbols}", "\u20dd")).toBe(true);
      expect(matches("\\p{IsCJKUnifiedIdeographsExtensionA}", "\u4db5")).toBe(true);
      expect(matches("\\p{IsCJKUnifiedIdeographsExtensionA}", "\u4db6")).toBe(false);
      expect(matches("\\P{IsBasicLatin}", "é")).toBe(true);
    });

    it("joins the ranges of a block with several: PrivateUse has three, Specials two", () => {
      for (const character of ["\ue000", "\uf8ff", "\u{f0000}", "\u{ffffd}", "\u{100000}", "\u{10fffd}"]) {
        expect(matches("\\p{IsPrivateUse}", character), character.codePointAt(0)?.toString(16)).toBe(true);
      }
      expect(matches("\\p{IsPrivateUse}", "\u{ffffe}")).toBe(false);
      expect(matches("\\p{IsSpecials}+", "\ufeff\ufff0\ufffd")).toBe(true);
      expect(matches("\\p{IsSpecials}", "\uff00")).toBe(false);
    });

    it("refuses a block that Unicode 3.1 does not have, such as a name of a later version", () => {
      for (const name of [
        "IsGreekandCoptic",
        "IsFoo",
        "Is",
        "IsaA0-a9",
        "IsbasicLatin",
        "BasicLatin",
        "IsBasic Latin",
      ]) {
        expect(() => compileXsdRegex(`\\p{${name}}`), name).toThrow(DataError);
      }
    });
  });

  describe("invalid patterns", () => {
    const invalid: readonly [string, string][] = [
      ["(", "a group that is not closed by )"],
      [")", "an unmatched )"],
      ["a)", "an unmatched )"],
      ["[", "a character class that is not closed by ]"],
      ["[a", "a character class that is not closed by ]"],
      ["[]", "an empty character class"],
      ["[^]", "an empty character class"],
      ["*", "a * that stands for nothing"],
      ["+a", "a + that stands for nothing"],
      ["a**", "a * that stands for nothing"],
      ["a{", "a quantifier without a number"],
      ["a{1", "a quantifier that is not closed by }"],
      ["a{,2}", "a quantifier without a number"],
      ["a{2,1}", "a quantifier whose maximum 1 is below its minimum 2"],
      ["a{x}", "a quantifier without a number"],
      ["{1}", "a { that stands for nothing"],
      ["a}", "a } that stands for nothing"],
      ["]", "a ] that stands for nothing"],
      ["\\", "an unexpected end"],
      ["\\q", "the escape \\q, which XML Schema does not have"],
      ["[\\q]", "in a class"],
      ["\\p", "a \\p or \\P without {"],
      ["\\p{L", "a \\p or \\P whose { is not closed by }"],
      ["\\p{Foo}", 'the property "Foo", which is no category or block'],
      ["\\p{l}", "no category or block"],
      ["[z-a]", "a range whose end comes before its start"],
      ["[a-c-e]", "a - within a character class"],
      ["[a-c-1-4]", "a - within a character class"],
      ["[a--]", "a range that ends in -"],
      ["[a-[b]", "a class subtraction that does not end the class"],
      ["[a-[b]c]", "a class subtraction that does not end the class"],
      ["[a[b]]", "a [ in a character class that is not escaped"],
      ["[\\d-z]", "a - within a character class"],
      ["[a-\\d]", "a range that ends in an escape of several characters"],
    ];

    for (const [pattern, problem] of invalid) {
      it(`refuses ${JSON.stringify(pattern)}: ${problem}`, () => {
        expect(() => compileXsdRegex(pattern)).toThrow(DataError);
        expect(() => compileXsdRegex(pattern)).toThrow(problem);
        expect(() => compileXsdRegex(pattern)).toThrow(
          `The pattern ${JSON.stringify(pattern)} is not an XML Schema regular expression`,
        );
      });
    }

    it("names the position of the problem in characters", () => {
      expect(() => compileXsdRegex("ab(cd")).toThrow("a group that is not closed by ) at character 6.");
      expect(() => compileXsdRegex("\u{1d49c}\u{1d49c}*+")).toThrow("a + that stands for nothing at character 4.");
    });
  });

  describe("limits", () => {
    it("has defaults that allow a{100000} and refuse a larger repeat", () => {
      expect(DEFAULT_XSD_REGEX_LIMITS).toEqual({ maxStates: 100_000, maxDepth: 100 });
      expect(matches("a{100000}", "a".repeat(100_000))).toBe(true);
      expect(() => compileXsdRegex("a{100001}")).toThrow(
        'The pattern "a{100001}" needs more than 100000 states once its repeats are expanded.',
      );
    });

    it("counts the states of a pattern once its repeats are expanded", () => {
      const limits = { maxStates: 10 };
      expect(compileXsdRegex("a{10}", { limits }).matches("a".repeat(10))).toBe(true);
      expect(() => compileXsdRegex("a{11}", { limits })).toThrow(DataError);
      expect(() => compileXsdRegex("(ab){5}c", { limits })).toThrow(DataError);
      expect(() => compileXsdRegex("a|b|c|d|e|f|g|h|i|j|k", { limits })).toThrow(DataError);
    });

    it("refuses nested repeats at once, without building their states", () => {
      expect(() => compileXsdRegex("((a{9999}){9999}){9999}")).toThrow("needs more than 100000 states");
      expect(() => compileXsdRegex("((a{99999999999999999999}){9999}){9999}")).toThrow("needs more than 100000 states");
    });

    it("compiles a repeat of a node without states at once, whatever its count", () => {
      const start = performance.now();
      for (const pattern of ["(){500000000}", "(()){500000000,500000000}", "((){500000000}){500000000}"]) {
        expect(compileXsdRegex(pattern).matches(""), pattern).toBe(true);
        expect(compileXsdRegex(pattern).matches("a"), pattern).toBe(false);
      }
      expect(performance.now() - start).toBeLessThan(1000);
      expect(compileXsdRegex("(){500000000}a").matches("a")).toBe(true);
      expect(compileXsdRegex("(a|()){3}").matches("aa")).toBe(true);
    });

    it("limits the nesting of groups and class subtractions", () => {
      const nested = (depth: number): string => `${"(".repeat(depth)}a${")".repeat(depth)}`;
      expect(matches(nested(100), "a")).toBe(true);
      expect(() => compileXsdRegex(nested(101))).toThrow("more than 100 levels of nesting");
      expect(() => compileXsdRegex(nested(3), { limits: { maxDepth: 2 } })).toThrow("more than 2 levels of nesting");
      expect(compileXsdRegex(nested(2), { limits: { maxDepth: 2 } }).matches("a")).toBe(true);
      expect(() => compileXsdRegex("[a-z-[b-[c-[d]]]]", { limits: { maxDepth: 2 } })).toThrow("levels of nesting");
      expect(() => compileXsdRegex(nested(100_000))).toThrow(DataError);
    });

    it("keeps the default of a limit that is left out", () => {
      expect(() => compileXsdRegex("a{3}", { limits: { maxStates: 2 } })).toThrow(DataError);
      expect(matches("((((a))))", "a")).toBe(true);
      expect(compileXsdRegex("((((a))))", { limits: { maxStates: 2 } }).matches("a")).toBe(true);
    });
  });

  describe("arguments of other types", () => {
    it("refuses a pattern that is not a string and options that are not an object", () => {
      expect(() => compileXsdRegex(json("5"))).toThrow("The pattern must be a string, found 5.");
      expect(() => compileXsdRegex(json("null"))).toThrow(DataError);
      expect(() => compileXsdRegex("a", json("null"))).toThrow("The options must be an object, found null.");
      expect(() => compileXsdRegex("a", json('"x"'))).toThrow(DataError);
      expect(() => compileXsdRegex("a", json("[]"))).toThrow(DataError);
    });

    it("refuses limits that are not an object and a limit that is not a positive integer", () => {
      expect(() => compileXsdRegex("a", { limits: json("null") })).toThrow(
        "The option limits must be an object, found null.",
      );
      expect(() => compileXsdRegex("a", { limits: json("[]") })).toThrow(DataError);
      expect(() => compileXsdRegex("a", { limits: { maxStates: json('"5"') } })).toThrow(
        'The limit maxStates must be a positive integer, found "5".',
      );
      expect(() => compileXsdRegex("a", { limits: { maxStates: 0 } })).toThrow(DataError);
      expect(() => compileXsdRegex("a", { limits: { maxStates: 1.5 } })).toThrow(DataError);
      expect(() => compileXsdRegex("a", { limits: { maxDepth: json("null") } })).toThrow(
        "The limit maxDepth must be a positive integer, found null.",
      );
    });

    it("refuses text that is not a string", () => {
      const pattern = compileXsdRegex("a");
      expect(() => pattern.matches(json("1"))).toThrow("The text must be a string, found 1.");
      expect(() => pattern.matches(json("null"))).toThrow(DataError);
    });
  });

  describe("time", () => {
    /** Returns the milliseconds of wall-clock time that compiling a pattern and matching one text take. */
    function timeOf(pattern: string, text: string): number {
      const compiled = compileXsdRegex(pattern);
      const start = performance.now();
      compiled.matches(text);
      return performance.now() - start;
    }

    // ReDoS fixtures: patterns that make a backtracking engine take exponential time on a text that almost matches.
    const BudgetMs = 3000;
    const fixtures: readonly [string, string][] = [
      ["(a+)+$", "a".repeat(100_000)],
      ["(a|a)*b", "a".repeat(100_000)],
      ["(a*)*b", "a".repeat(100_000)],
      ["((a*)*)*c", "a".repeat(100_000)],
      ["(x+x+)+y", "x".repeat(100_000)],
      ["(a|aa)+$", `${"a".repeat(100_000)}b`],
      ["([a-z]+)*[0-9]", "abcdefghij".repeat(10_000)],
      ["(\\w+\\s?)*$", `${"word ".repeat(20_000)}!`],
      ["(.*a){20}", "a".repeat(100_000)],
      ["[a-q][^u-z]{13}x", "abcdefghijklmnopqrstuvwxyz".repeat(4000)],
      ["\\p{L}*\\p{Nd}", "é".repeat(100_000)],
    ];

    for (const [pattern, text] of fixtures) {
      it(`matches ${JSON.stringify(pattern)} on ${text.length} characters within ${BudgetMs} ms`, () => {
        expect(timeOf(pattern, text)).toBeLessThan(BudgetMs);
      });
    }

    it("gives the right answer on the fixtures", () => {
      expect(matches("(a+)+$", "a".repeat(1000))).toBe(false);
      expect(matches("(a+)+$", `${"a".repeat(1000)}$`)).toBe(true);
      expect(matches("(a|a)*b", `${"a".repeat(1000)}b`)).toBe(true);
      expect(matches("(a*)*b", "a".repeat(1000))).toBe(false);
      expect(matches("(x+x+)+y", `${"x".repeat(1000)}y`)).toBe(true);
    });

    it("takes time that grows in proportion to the text, whatever the pattern", () => {
      const runs = 7;
      const smallLength = 125_000;
      const largeLength = 2_000_000;
      const repeats = largeLength / smallLength;
      const microsecondsPerMillisecond = 1000;
      // A busy machine delays a process but adds nothing to its processor time, so the growth is measured on that, not
      // on the wall clock; and the least of several runs leaves out what a garbage collection or a cold compiler adds.
      // The small text is matched as many times as it is shorter, so that both sides do the same work if the time is
      // linear, and take long enough that the other threads of the process do not decide the ratio.
      const processorTimeOf = (compiled: XsdPattern, text: string, times: number): number => {
        const before = process.cpuUsage();
        for (let time = 0; time < times; time += 1) compiled.matches(text);
        const { user, system } = process.cpuUsage(before);
        return (user + system) / microsecondsPerMillisecond;
      };
      const leastTime = (compiled: XsdPattern, length: number, times: number): number => {
        const text = "a".repeat(length);
        compiled.matches(text);
        return Math.min(...Array.from({ length: runs }, () => processorTimeOf(compiled, text, times)));
      };
      for (const pattern of ["(a+)+$", "(a|a)*b", "\\p{L}*\\p{Nd}"]) {
        const compiled = compileXsdRegex(pattern);
        const growth = leastTime(compiled, largeLength, 1) / leastTime(compiled, smallLength, repeats);
        // Linear time makes the ratio about 1, and a quadratic pattern makes it 16, the factor of the lengths. The limit
        // of 4 is where the time grows with the 1.5th power of the length.
        expect(growth, pattern).toBeLessThan(4);
      }
    }, 30_000);

    it("stays fast when a text needs more deterministic states than the matcher keeps", () => {
      // (a|b)*a(a|b){20} has up to 2^21 states, more than a matcher keeps; the pattern needs the last 21 characters.
      const compiled = compileXsdRegex("(a|b)*a(a|b){20}");
      let seed = 12345;
      const text = Array.from({ length: 200_000 }, () => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return seed & 0x10000 ? "a" : "b";
      }).join("");
      const start = performance.now();
      const result = compiled.matches(text);
      expect(performance.now() - start).toBeLessThan(BudgetMs * 3);
      expect(result).toBe(text.at(-21) === "a");
    });

    it("uses memory in proportion to the pattern, not to the number of different characters in the text", () => {
      const text = Array.from({ length: 300_000 }, (_, index) => String.fromCodePoint(0x20000 + (index % 40_000))).join(
        "",
      );
      expect(timeOf(".*", text)).toBeLessThan(BudgetMs);
      expect(timeOf("\\p{L}*", text)).toBeLessThan(BudgetMs);
    });
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = new URL("../../../docs/runtime/values.md", import.meta.url);
    const values = await import("../src/values/index.js");
    expect(await runGuideSamples(guide, { "@assesskit/runtime/values": values })).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  const letter = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_");
  const nameChar = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789.-");
  const identifier = fc
    .tuple(letter, fc.array(nameChar, { maxLength: 12 }))
    .map(([first, rest]) => first + rest.join(""));
  const text = fc.string({ unit: "binary", minLength: 1, maxLength: 12 });
  const file = fc.record(
    { reference: text, mimeType: text, fileName: text },
    { requiredKeys: ["reference", "mimeType"] },
  );
  const double = fc.double();
  const anyInteger = fc.maxSafeInteger();
  const pointValue = fc.tuple(anyInteger, anyInteger);
  const pairValue = fc.tuple(identifier, identifier);

  /** An arbitrary of the primitives of each base type. */
  const primitives: Readonly<Record<BaseType, fc.Arbitrary<Primitive>>> = {
    boolean: fc.boolean(),
    directedPair: pairValue,
    duration: double,
    file,
    float: double,
    identifier,
    integer: anyInteger,
    pair: pairValue,
    point: pointValue,
    string: text,
    uri: fc.string({ unit: "binary" }),
  };
  const baseType = fc.constantFrom(...BASE_TYPES);

  const singleValue = baseType.chain((type) => primitives[type].map((value) => nonNull(single(type, value as never))));
  const containerValue = fc
    .tuple(baseType, fc.constantFrom("multiple", "ordered"))
    .chain(([type, cardinality]) =>
      fc
        .array(primitives[type], { minLength: 1, maxLength: 6 })
        .map((values) => nonNull(container(cardinality, type, values))),
    );
  const recordValue = fc
    .uniqueArray(fc.tuple(identifier, singleValue), { minLength: 1, maxLength: 4, selector: ([name]) => name })
    .map((fields) => nonNull(record(fields as [string, never][])));
  const value = fc.oneof(singleValue, containerValue, recordValue);

  describe("bytes", () => {
    it("encodes any bytes as the base64 and base64url of Node.js and decodes them back", () => {
      fc.assert(
        fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
          const expected = Buffer.from(bytes);
          expect(encodeBase64(bytes)).toBe(expected.toString("base64"));
          expect(encodeBase64Url(bytes)).toBe(expected.toString("base64url"));
          expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
          expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
        }),
        FUZZ,
      );
    });

    it("decodes a text of the base64url alphabet exactly when the bits after its last byte are zero", () => {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      /** Whether the bits of the last character that stand for no byte are zero: 4 bits after one byte, 2 after two. */
      const canonical = (text: string): boolean => {
        const unused = text.length % 4 === 2 ? 0b1111 : text.length % 4 === 3 ? 0b11 : 0;
        return (alphabet.indexOf(text.at(-1) ?? "A") & unused) === 0;
      };
      fc.assert(
        fc.property(fc.string({ maxLength: 40 }), (text) => {
          const valid = /^[A-Za-z0-9_-]*$/u.test(text) && text.length % 4 !== 1 && canonical(text);
          expect(decodeBase64Url(text) !== undefined).toBe(valid);
        }),
        FUZZ,
      );
      fc.assert(
        fc.property(fc.stringMatching(/^[A-Za-z0-9_-]{1,40}$/u), (text) => {
          expect(decodeBase64Url(text) !== undefined).toBe(text.length % 4 !== 1 && canonical(text));
        }),
        FUZZ,
      );
    });

    it("decodes a text exactly when encoding the result gives the text back", () => {
      const digits = fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_=");
      fc.assert(
        fc.property(fc.array(digits, { maxLength: 12 }), (characters) => {
          const text = characters.join("");
          const bytes = decodeBase64(text);
          expect(bytes === undefined || encodeBase64(bytes) === text).toBe(true);
          const urlBytes = decodeBase64Url(text);
          expect(urlBytes === undefined || encodeBase64Url(urlBytes) === text).toBe(true);
        }),
        FUZZ,
      );
    });
  });

  describe("values and their forms", () => {
    it("builds values of every cardinality and base type that match themselves", () => {
      fc.assert(
        fc.property(value, (built) => {
          expect(matchValues(built, built)).toBe(true);
        }),
      );
    });

    it("reads back the lexical form that it writes, numbers included", () => {
      // A uri loses the white space around it and a file everything but its reference, so they are not in the list.
      const lossless = fc.constantFrom<BaseType>(
        "boolean",
        "integer",
        "float",
        "duration",
        "string",
        "identifier",
        "point",
        "pair",
        "directedPair",
      );
      fc.assert(
        fc.property(
          lossless.chain((type) => fc.tuple(fc.constant(type), primitives[type])),
          ([type, primitive]) => {
            expect(parsePrimitive(formatPrimitive(primitive, type), type)).toStrictEqual(primitive);
          },
        ),
      );
    });

    it("reads back the JSON that it writes", () => {
      fc.assert(
        fc.property(value, (built) => {
          const declaration = declarationOf(built);
          expect(fromJsonValue(toJsonValue(built, declaration), declaration)).toStrictEqual(built);
        }),
      );
    });

    it("reads back the wire value that it writes, with no declaration, also after it went through JSON text", () => {
      fc.assert(
        fc.property(value, (built) => {
          const wire = toWireValue(built, declarationOf(built));
          expect(fromWireValue(wire)).toStrictEqual(built);
          expect(fromWireValue(JSON.parse(JSON.stringify(wire)))).toStrictEqual(built);
        }),
      );
    });

    it("keeps the type of a NULL through JSON text", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...CARDINALITIES.filter((cardinality) => cardinality !== "record")),
          baseType,
          (cardinality, type) => {
            const declaration = { cardinality, baseType: type };
            const wire = JSON.parse(JSON.stringify(toWireValue(null, declaration)));
            expect(wire).toEqual({ cardinality, baseType: type, value: null });
            expect(fromWireValue(wire)).toBeNull();
          },
        ),
      );
    });

    it("writes a duration that reads back as the same seconds", () => {
      fc.assert(
        fc.property(double, (seconds) => {
          const declaration: ValueDeclaration = { cardinality: "single", baseType: "duration" };
          const written = toJsonValue(single("duration", seconds), declaration);
          const read = fromJsonValue(written, declaration) as { value: number };
          expect(Object.is(read.value, seconds)).toBe(true);
          const text = (written as { base: { duration: string } }).base.duration;
          expect(/^-?PT[0-9]+(\.[0-9]+)?S$|^(NaN|-?INF|-0)$/.test(text), text).toBe(true);
        }),
      );
    });
  });

  describe("matching and promotion", () => {
    it("matches multiple containers exactly when one is a permutation of the other", () => {
      const sample = fc.array(fc.constantFrom("A", "B", "C"), { minLength: 1, maxLength: 8 });
      fc.assert(
        fc.property(sample, sample, (left, right) => {
          const a = nonNull(container("multiple", "identifier", left));
          const b = nonNull(container("multiple", "identifier", right));
          const sorted = (items: string[]): string => items.toSorted().join();
          expect(matchValues(a, b)).toBe(sorted(left) === sorted(right));
          expect(matchValues(a, nonNull(container("multiple", "identifier", left.toReversed())))).toBe(true);
        }),
      );
    });

    it("matches ordered containers exactly when they are equal", () => {
      const sample = fc.array(fc.constantFrom("A", "B"), { minLength: 1, maxLength: 6 });
      fc.assert(
        fc.property(sample, sample, (left, right) => {
          const a = nonNull(container("ordered", "identifier", left));
          const b = nonNull(container("ordered", "identifier", right));
          expect(matchValues(a, b)).toBe(left.join() === right.join());
        }),
      );
    });

    it("matches a pair whichever way round and a directed pair only the same way round", () => {
      fc.assert(
        fc.property(identifier, identifier, (first, second) => {
          expect(matchValues(single("pair", [first, second]), single("pair", [second, first]))).toBe(true);
          expect(matchValues(single("directedPair", [first, second]), single("directedPair", [second, first]))).toBe(
            first === second,
          );
        }),
      );
    });

    it("matches as an equivalence: symmetric and transitive on values of one kind", () => {
      const small = fc.array(fc.constantFrom("A", "B", "C"), { minLength: 1, maxLength: 4 });
      const kind = fc.constantFrom("multiple", "ordered");
      fc.assert(
        fc.property(kind, small, small, small, (cardinality, x, y, z) => {
          const [a, b, c] = [x, y, z].map((items) => nonNull(container(cardinality, "identifier", items)));
          if (a === undefined || b === undefined || c === undefined) return;
          expect(matchValues(a, b)).toBe(matchValues(b, a));
          if (matchValues(a, b) && matchValues(b, c)) expect(matchValues(a, c)).toBe(true);
        }),
      );
    });

    it("keeps the numbers and the shape of a value when it promotes an integer", () => {
      const integers = fc.array(anyInteger, { minLength: 1, maxLength: 6 });
      fc.assert(
        fc.property(
          integers,
          fc.constantFrom("multiple", "ordered"),
          fc.constantFrom("float", "duration"),
          (items, cardinality, target) => {
            const promoted = promote(nonNull(container(cardinality, "integer", items)), target);
            expect(promoted).toEqual(container(cardinality, target, items));
            expect(promote(promoted, target)).toBe(promoted);
          },
        ),
      );
    });
  });

  describe("identifiers and terms", () => {
    it("accepts every string of the identifier alphabet that starts with a letter or an underscore", () => {
      fc.assert(fc.property(identifier, (candidate) => isIdentifier(candidate)));
    });

    it("rejects every string that starts with a digit, a hyphen or a period, or holds a colon or white space", () => {
      const bad = fc.oneof(
        fc.tuple(fc.constantFrom(..."0123456789-."), identifier).map(([first, rest]) => first + rest),
        fc.tuple(identifier, fc.constantFrom(..." \t\n:/@"), identifier).map((parts) => parts.join("")),
      );
      fc.assert(fc.property(bad, (candidate) => !isIdentifier(candidate)));
    });

    it("rejects every string that is not a term", () => {
      fc.assert(
        fc.property(fc.string(), (candidate) => {
          expect(isBaseType(candidate)).toBe(BASE_TYPE_TERMS.includes(candidate));
          expect(isCardinality(candidate)).toBe(CARDINALITY_TERMS.includes(candidate));
        }),
      );
    });
  });

  describe("lists", () => {
    it("reads back the identifier list that it writes", () => {
      fc.assert(
        fc.property(fc.array(identifier, { maxLength: 8 }), (items) => {
          expect(parseIdentifierList(formatIdentifierList(items))).toEqual(items);
        }),
      );
    });

    it("reads back the integer list that it writes", () => {
      fc.assert(
        fc.property(fc.array(fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }), { maxLength: 8 }), (items) => {
          expect(parseIntegerList(formatIntegerList(items))).toEqual(items);
        }),
      );
    });

    it("reads lists whatever white space separates the items", () => {
      const gap = fc.stringMatching(/^[ \t\n\r]{1,4}$/);
      fc.assert(
        fc.property(
          fc.array(identifier, { minLength: 1, maxLength: 5 }),
          gap,
          gap,
          gap,
          (items, before, between, after) => {
            expect(parseIdentifierList(`${before}${items.join(between)}${after}`)).toEqual(items);
          },
        ),
      );
    });
  });

  describe("regular expressions", () => {
    // The common subset of XML Schema's regular expressions and JavaScript's, over texts of ASCII letters and digits, where
    // the two languages agree: V8's backtracking engine is the oracle.
    const atom = fc.constantFrom("a", "b", "c", "0", ".", "[ab]", "[^a]", "[a-c]", "[0-9]", "\\d", "\\w", "\\.");
    const quantifier = fc.constantFrom("", "", "", "?", "*", "+", "{2}", "{1,2}", "{0,1}", "{2,}");
    const pattern = fc.letrec<{ choice: string; sequence: string; piece: string }>((tie) => ({
      piece: fc.oneof(
        { maxDepth: 2, depthIdentifier: "pattern" },
        fc.tuple(atom, quantifier).map(([item, count]) => item + count),
        fc.tuple(tie("choice"), quantifier).map(([group, count]) => `(${group})${count}`),
      ),
      sequence: fc.array(tie("piece"), { minLength: 0, maxLength: 3 }).map((pieces) => pieces.join("")),
      choice: fc.array(tie("sequence"), { minLength: 1, maxLength: 2 }).map((branches) => branches.join("|")),
    })).choice;
    const input = fc.string({ unit: fc.constantFrom("a", "b", "c", "0", "1", "."), maxLength: 7 });

    it("agrees with a backtracking engine on the common subset", () => {
      fc.assert(
        fc.property(pattern, input, (source, candidate) => {
          const oracle = new RegExp(`^(?:${source})$`, "u");
          expect(compileXsdRegex(source).matches(candidate), `${source} on ${JSON.stringify(candidate)}`).toBe(
            oracle.test(candidate),
          );
        }),
        { numRuns: 1000 },
      );
    });

    it("compiles a mutated pattern within small limits or refuses it with a DataError, and matches any text without throwing", () => {
      const fragments = [
        "{",
        "}",
        "{99999999999}",
        "{2,1}",
        "{,}",
        "[",
        "]",
        "[a-",
        "-[",
        "[^",
        "\\p{",
        "\\p{L}",
        "\\P{Is",
        "\\",
        "\\c",
        "\\i",
        "(",
        ")",
        "|",
        "*",
        "+",
        "?",
        "\u0000",
        "😀",
        "\ud800",
      ];
      fc.assert(
        fc.property(
          pattern,
          mutationsOf(fragments),
          fc.string({ unit: "binary", maxLength: 12 }),
          (source, changes, candidate) => {
            let compiled: XsdPattern;
            try {
              compiled = compileXsdRegex(mutateText(source, changes), { limits: { maxStates: 300, maxDepth: 5 } });
            } catch (error) {
              expect(error, String(error)).toBeInstanceOf(DataError);
              return;
            }
            expect(typeof compiled.matches(candidate)).toBe("boolean");
          },
        ),
        FUZZ,
      );
    });

    it("matches every text of a pattern it compiles for a text that the pattern generates by repetition", () => {
      fc.assert(
        fc.property(fc.array(fc.constantFrom("ab", "c", "abc"), { maxLength: 20 }), (parts) => {
          expect(compileXsdRegex("(ab|c|abc)*").matches(parts.join(""))).toBe(true);
        }),
      );
    });

    it("partitions the code points among the 30 categories, each in exactly one", () => {
      const categories = "Lu Ll Lt Lm Lo Mn Mc Me Nd Nl No Pc Pd Ps Pe Pi Pf Po Zs Zl Zp Sm Sc Sk So Cc Cf Co Cn".split(
        " ",
      );
      const compiled = categories.map((name) => compileXsdRegex(`\\p{${name}}`));
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 0x10ffff }).filter((point) => point < 0xd800 || point > 0xdfff),
          (point) => {
            const character = String.fromCodePoint(point);
            expect(compiled.filter((category) => category.matches(character))).toHaveLength(1);
          },
        ),
        { numRuns: 3000 },
      );
    });

    it("gives the complement for \\P and the negated class", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 0x10ffff }), (point) => {
          const character = String.fromCodePoint(point);
          expect(compileXsdRegex("\\P{L}").matches(character)).toBe(!compileXsdRegex("\\p{L}").matches(character));
          expect(compileXsdRegex("[^\\p{L}]").matches(character)).toBe(!compileXsdRegex("\\p{L}").matches(character));
          expect(compileXsdRegex("\\D").matches(character)).toBe(!compileXsdRegex("\\d").matches(character));
          expect(compileXsdRegex("\\W").matches(character)).toBe(!compileXsdRegex("\\w").matches(character));
        }),
        { numRuns: 1000 },
      );
    });
  });
});
