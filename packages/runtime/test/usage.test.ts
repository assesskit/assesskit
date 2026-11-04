import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runGuideSamples } from "../../../scripts/guide-samples.js";
import { DataError } from "../src/errors.js";
import {
  DISTRACTOR_STATISTICS,
  ITEM_STATISTICS,
  type ItemStatistic,
  readUsageData,
  USAGE_NAMESPACE,
  type UsageData,
  writeUsageData,
} from "../src/usage/index.js";
import { XSI_NAMESPACE } from "../src/xml/internal.js";
import { usageData } from "./arbitraries/usage.js";
import { fuzzReader } from "./fuzz.js";
import { issueOf } from "./read-failure.js";

const SCHEMA_LOCATION = `${USAGE_NAMESPACE} https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_usagedatav3p0_v1p0.xsd`;
const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';
const CONTEXT = "http://ntweb.ets.org/itemStats/Context/XVZ2004_J1B";

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

const document = (body = "", attributes = ""): string =>
  `<usageData xmlns="${USAGE_NAMESPACE}"${attributes}>${body}</usageData>`;

const ordinary = (attributes: string, children: string): string =>
  `<ordinaryStatistic name="AIS" context="${CONTEXT}"${attributes}>${children}</ordinaryStatistic>`;

const TARGET = '<targetObject identifier="Item_VB123456"/>';

/** The only statistic of a document. */
function statisticOf(body: string): ItemStatistic {
  const [first] = readUsageData(document(body)).statistics;
  if (first === undefined) throw new Error("The document has no statistic.");
  return first;
}

const base = { name: "AIS", context: CONTEXT, targetObjects: [{ identifier: "Item_VB123456" }] };

describe("reading usage data", () => {
  it("reads the glossary of the usage data and the statistics in the order of the document", () => {
    const data = readUsageData(
      document(
        `${ordinary("", `${TARGET}<value>0.87</value>`)}<categorizedStatistic name="D-Param" context="${CONTEXT}">${TARGET}<mapping><mapEntry mapKey="d1" mappedValue="1"/></mapping></categorizedStatistic>${ordinary("", `${TARGET}<value>1</value>`)}`,
        ' glossary="http://example.com/glossary"',
      ),
    );
    expect(data.glossary).toBe("http://example.com/glossary");
    expect(data.statistics.map(({ kind }) => kind)).toEqual(["ordinary", "categorized", "ordinary"]);
  });

  it("reads usage data without statistics", () => {
    expect(readUsageData(document())).toEqual({ statistics: [] });
  });

  it("reads the attributes of an ordinary statistic and its value", () => {
    // The first statistic of 1EdTech's usageData/example.xml.
    expect(
      statisticOf(
        `<ordinaryStatistic name="AIS" glossary="http://example.com/g" context="${CONTEXT}" caseCount="689325" stdError="0.0022" stdDeviation="1.5" lastUpdated="2004-07-04">${TARGET}<value>0.87</value></ordinaryStatistic>`,
      ),
    ).toEqual({
      kind: "ordinary",
      name: "AIS",
      glossary: "http://example.com/g",
      context: CONTEXT,
      caseCount: 689_325,
      stdError: 0.0022,
      stdDeviation: 1.5,
      lastUpdated: "2004-07-04",
      targetObjects: [{ identifier: "Item_VB123456" }],
      value: { value: 0.87 },
    });
  });

  it("reads a categorized statistic with its mapping, bounds and entries", () => {
    // The D-Parm statistic of 1EdTech's usageData/example.xml.
    expect(
      statisticOf(
        `<categorizedStatistic name="D-Parm" context="${CONTEXT}">${TARGET}<mapping lowerBound="1" upperBound="4" defaultValue="0"><mapEntry mapKey="d1" mappedValue="412.5267"/><mapEntry mapKey="d2" mappedValue="426.5699" caseSensitive="false"/></mapping></categorizedStatistic>`,
      ),
    ).toEqual({
      kind: "categorized",
      ...base,
      name: "D-Parm",
      mapping: {
        lowerBound: 1,
        upperBound: 4,
        defaultValue: 0,
        entries: [
          { mapKey: "d1", mappedValue: 412.5267 },
          { mapKey: "d2", mappedValue: 426.5699, caseSensitive: false },
        ],
      },
    });
  });

  it("leaves out the bounds and the default value that a mapping does not give", () => {
    const statistic = statisticOf(
      `<categorizedStatistic name="x" context="c">${TARGET}<mapping><mapEntry mapKey="" mappedValue="-INF" caseSensitive="1"/></mapping></categorizedStatistic>`,
    );
    expect(statistic).toMatchObject({
      mapping: { entries: [{ mapKey: "", mappedValue: Number.NEGATIVE_INFINITY, caseSensitive: true }] },
    });
    expect((statistic as { mapping: object }).mapping).not.toHaveProperty("lowerBound");
    expect((statistic as { mapping: object }).mapping).not.toHaveProperty("defaultValue");
  });

  it("reads the target objects of a statistic: the item, a part of it and the kind of object", () => {
    const statistic = statisticOf(
      ordinary(
        "",
        '<targetObject identifier="Item_VB123456" partIdentifier="A" objectType="choice"/><targetObject identifier="Test_VB" objectType="test"/><value>1</value>',
      ),
    );
    expect(statistic.targetObjects).toEqual([
      { identifier: "Item_VB123456", partIdentifier: "A", objectType: "choice" },
      { identifier: "Test_VB", objectType: "test" },
    ]);
  });

  it("reads a value without a base type as a float, and a value with one by the lexical form of that type", () => {
    const value = (attributes: string, text: string): unknown =>
      (statisticOf(ordinary("", `${TARGET}<value${attributes}>${text}</value>`)) as { value: unknown }).value;
    expect(value("", " 0.647 ")).toEqual({ value: 0.647 });
    expect(value("", "1e-3")).toEqual({ value: 0.001 });
    expect(value("", "NaN")).toEqual({ value: Number.NaN });
    expect(value(' baseType="integer"', "585678")).toEqual({ value: 585_678, baseType: "integer" });
    expect(value(' baseType="string"', "  as written ")).toEqual({ value: "  as written ", baseType: "string" });
    expect(value(' baseType="point" fieldIdentifier="p"', "1 2")).toEqual({
      value: [1, 2],
      baseType: "point",
      fieldIdentifier: "p",
    });
    expect(value(' baseType="boolean"', "true")).toEqual({ value: true, baseType: "boolean" });
  });

  it("accepts the seven terms of ObjectTypeEnum and no other", () => {
    for (const objectType of ["test", "testpart", "section", "item", "outcome", "interaction", "choice"]) {
      const statistic = statisticOf(
        ordinary("", `<targetObject identifier="x" objectType="${objectType}"/><value>1</value>`),
      );
      expect(statistic.targetObjects[0]).toEqual({ identifier: "x", objectType });
    }
    expect(() => statisticOf(ordinary("", '<targetObject identifier="x" objectType="Item"/><value>1</value>'))).toThrow(
      'must be "test", "testpart", "section", "item", "outcome", "interaction" or "choice", found "Item"',
    );
    expect(() => statisticOf(ordinary("", '<targetObject identifier="x" objectType=""/><value>1</value>'))).toThrow(
      'found ""',
    );
  });

  it("lists the four terms of the Distractor Statistics vocabulary", () => {
    expect(DISTRACTOR_STATISTICS).toEqual([
      "AISResponse",
      "NumberChoosingResponse",
      "PTbis-Response",
      "PercentChoosingResponse",
    ]);
  });

  it("lists the sixteen terms of the Item Statistics vocabulary", () => {
    expect(ITEM_STATISTICS).toEqual([
      "A-Param",
      "AIS",
      "B-Param",
      "C-Param",
      "D-Param",
      "Fifths_Table_Highest",
      "Fifths_Table_Lowest",
      "Fifths_Table_Middle",
      "Fifths_Table_Second_Highest",
      "Fifths_Table_Second_Lowest",
      "P-value",
      "PHI",
      "PTbis",
      "Polyserial",
      "Score_Conversion",
      "rbis",
    ]);
  });

  it("reads and writes a statistic under every term of the vocabularies, and under a name outside them", () => {
    const names = [...DISTRACTOR_STATISTICS, ...ITEM_STATISTICS, "A-Parm", "drcInfitt"];
    const statistics: ItemStatistic[] = names.map((name) => ({ kind: "ordinary", ...base, name, value: { value: 1 } }));
    const data: UsageData = { statistics };
    expect(readUsageData(writeUsageData(data))).toEqual(data);
  });

  it("reads text, bytes and a parsed element", () => {
    const text = document();
    expect(readUsageData(new TextEncoder().encode(text))).toEqual({ statistics: [] });
  });
});

describe("writing usage data", () => {
  it("writes usage data without statistics", () => {
    expect(writeUsageData({ statistics: [] })).toBe(
      `${DECLARATION}<usageData xsi:schemaLocation="${SCHEMA_LOCATION}" xmlns="${USAGE_NAMESPACE}" xmlns:xsi="${XSI_NAMESPACE}"/>`,
    );
  });

  it("writes an ordinary statistic with the attributes in the order of the schema, a float value without a base type", () => {
    const text = writeUsageData({
      glossary: "http://example.com/g",
      statistics: [
        {
          kind: "ordinary",
          name: "AIS",
          glossary: "http://example.com/glossary",
          context: CONTEXT,
          caseCount: 689_325,
          stdError: 0.0022,
          stdDeviation: 1.5,
          lastUpdated: "2004-07-04",
          targetObjects: [{ identifier: "Item_VB123456", partIdentifier: "A", objectType: "choice" }],
          value: { value: 0.87 },
        },
      ],
    });
    expect(text).toBe(
      `${DECLARATION}<usageData xsi:schemaLocation="${SCHEMA_LOCATION}" glossary="http://example.com/g" xmlns="${USAGE_NAMESPACE}" xmlns:xsi="${XSI_NAMESPACE}"><ordinaryStatistic name="AIS" glossary="http://example.com/glossary" context="${CONTEXT}" caseCount="689325" stdError="0.0022" stdDeviation="1.5" lastUpdated="2004-07-04"><targetObject identifier="Item_VB123456" partIdentifier="A" objectType="choice"/><value>0.87</value></ordinaryStatistic></usageData>`,
    );
  });

  it("writes a categorized statistic and a value with a base type and a field", () => {
    const text = writeUsageData({
      statistics: [
        {
          kind: "categorized",
          ...base,
          mapping: { lowerBound: 1, entries: [{ mapKey: "d1", mappedValue: 412.5, caseSensitive: true }] },
        },
        { kind: "ordinary", ...base, value: { value: [1, 2], baseType: "point", fieldIdentifier: "p" } },
      ],
    });
    expect(text).toContain(
      '<mapping lowerBound="1"><mapEntry mapKey="d1" mappedValue="412.5" caseSensitive="true"/></mapping>',
    );
    expect(text).toContain('<value fieldIdentifier="p" baseType="point">1 2</value>');
  });

  it("writes the terms of ObjectTypeEnum and refuses any other", () => {
    for (const objectType of ["test", "testpart", "section", "item", "outcome", "interaction", "choice"] as const) {
      const statistic: ItemStatistic = {
        kind: "ordinary",
        ...base,
        targetObjects: [{ identifier: "x", objectType }],
        value: { value: 1 },
      };
      expect(writeUsageData({ statistics: [statistic] })).toContain(`objectType="${objectType}"`);
    }
    const other: ItemStatistic = {
      kind: "ordinary",
      ...base,
      targetObjects: [{ identifier: "x", objectType: json('"Item"') }],
      value: { value: 1 },
    };
    expect(() => writeUsageData({ statistics: [other] })).toThrow(
      'The objectType of a target object must be "test", "testpart", "section", "item", "outcome", "interaction" or "choice", found "Item".',
    );
  });
});

describe("errors", () => {
  it("refuses a root that is not usageData of the UD namespace, among them the namespace of QTI 2.2", () => {
    expect(
      issueOf(() => readUsageData('<usageData xmlns="http://www.imsglobal.org/xsd/imsqti_usagedata_v2p2"/>')),
    ).toEqual({
      severity: "error",
      rule: "assesskit/usage/not-usage-data",
      message: `The root element must be usageData in the namespace ${USAGE_NAMESPACE}, found {http://www.imsglobal.org/xsd/imsqti_usagedata_v2p2}usageData.`,
      location: { line: 1, column: 1, element: "usageData" },
    });
    expect(() => readUsageData(`<statistics xmlns="${USAGE_NAMESPACE}"/>`)).toThrow("found statistics.");
  });

  it("refuses a statistic without its context, name, target object or value", () => {
    expect(() =>
      readUsageData(document(`<ordinaryStatistic name="a">${TARGET}<value>1</value></ordinaryStatistic>`)),
    ).toThrow("The element ordinaryStatistic needs the attribute context.");
    expect(() =>
      readUsageData(document(`<ordinaryStatistic context="c">${TARGET}<value>1</value></ordinaryStatistic>`)),
    ).toThrow("The element ordinaryStatistic needs the attribute name.");
    expect(
      issueOf(() =>
        readUsageData(document('<ordinaryStatistic name="a" context="c"><value>1</value></ordinaryStatistic>')),
      ),
    ).toMatchObject({
      rule: "assesskit/usage/missing-element",
      message: "The element ordinaryStatistic needs a targetObject.",
    });
    expect(() =>
      readUsageData(document(`<ordinaryStatistic name="a" context="c">${TARGET}</ordinaryStatistic>`)),
    ).toThrow("The element ordinaryStatistic needs the element value, found no more elements.");
  });

  it("refuses a categorized statistic with a value instead of a mapping, and a mapping without an entry", () => {
    expect(() =>
      readUsageData(
        document(`<categorizedStatistic name="a" context="c">${TARGET}<value>1</value></categorizedStatistic>`),
      ),
    ).toThrow("The element categorizedStatistic needs the element mapping, found the element value.");
    expect(() =>
      readUsageData(document(`<categorizedStatistic name="a" context="c">${TARGET}<mapping/></categorizedStatistic>`)),
    ).toThrow("The element mapping needs a mapEntry.");
  });

  it("refuses a name that is not an identifier, a date that is not YYYY-MM-DD and a count beyond the safe integers", () => {
    const statistic = (attributes: string): string => document(ordinary(attributes, `${TARGET}<value>1</value>`));
    expect(() =>
      readUsageData(
        document(`<ordinaryStatistic name="1AIS" context="c">${TARGET}<value>1</value></ordinaryStatistic>`),
      ),
    ).toThrow('The text "1AIS" is not an identifier');
    expect(() => readUsageData(statistic(' lastUpdated="2004-07-04T00:00:00"'))).toThrow(
      'The text "2004-07-04T00:00:00" is not a date such as 2004-07-04.',
    );
    expect(() => readUsageData(statistic(' lastUpdated="2003-02-29"'))).toThrow("is not a date such as 2004-07-04.");
    expect(() => readUsageData(statistic(' caseCount="9007199254740993"'))).toThrow("expected an integer from");
    expect(() => readUsageData(statistic(' caseCount="12.5"'))).toThrow(
      "The attribute caseCount of the element ordinaryStatistic is invalid.",
    );
  });

  it("refuses a value that is not of its base type", () => {
    expect(() => statisticOf(ordinary("", `${TARGET}<value>high</value>`))).toThrow(
      'The value of an ordinary statistic without a baseType is a float. The text "high" is not a float: expected a decimal number with an optional exponent, INF, -INF or NaN.',
    );
    expect(issueOf(() => statisticOf(ordinary("", `${TARGET}<value baseType="integer">1.5</value>`)))).toMatchObject({
      rule: "assesskit/usage/invalid-value",
    });
  });

  it("refuses attributes and elements that the schema does not define", () => {
    expect(() => readUsageData(document("", ' unknown="1"'))).toThrow(
      "The element usageData has the attribute unknown, which the schema does not define for it.",
    );
    expect(() => readUsageData(document("<other/>"))).toThrow(
      "The element other is not allowed in usageData at this place.",
    );
    expect(() => readUsageData(document(ordinary(' extra="1"', `${TARGET}<value>1</value>`)))).toThrow(
      "The element ordinaryStatistic has the attribute extra",
    );
  });

  it("refuses input that is not text, bytes or an element, and a model that is not usage data", () => {
    expect(() => readUsageData(json("null"))).toThrow(
      "The usage data to read must be a string, a Uint8Array or an XmlElement, found null.",
    );
    expect(() => writeUsageData(json("5"))).toThrow("The usage data must be an object, found 5.");
    expect(() => writeUsageData(json("{}"))).toThrow(
      "The statistics of the usage data must be an array, found undefined.",
    );
    expect(() => writeUsageData(json('{"statistics":[5]}'))).toThrow("A statistic must be an object, found 5.");
    expect(() =>
      writeUsageData(
        json('{"statistics":[{"kind":"other","name":"a","context":"c","targetObjects":[{"identifier":"i"}]}]}'),
      ),
    ).toThrow('The kind of a statistic must be "ordinary" or "categorized", found "other".');
  });

  it("refuses a model with a field of the wrong type", () => {
    const ordinaryWith = (fields: object): UsageData => ({
      statistics: [{ kind: "ordinary", ...base, value: { value: 1 }, ...fields }],
    });
    expect(() => writeUsageData(ordinaryWith({ name: "1bad" }))).toThrow(
      'A value of base type identifier must be an identifier, found "1bad".',
    );
    expect(() => writeUsageData(ordinaryWith({ lastUpdated: "2004-7-4" }))).toThrow(
      'The lastUpdated of the statistic "AIS" must be a date such as 2004-07-04, found "2004-7-4".',
    );
    expect(() => writeUsageData(ordinaryWith({ caseCount: 1.5 }))).toThrow(DataError);
    expect(() => writeUsageData(ordinaryWith({ targetObjects: [] }))).toThrow(
      'The targetObjects of the statistic "AIS" needs at least one entry.',
    );
    expect(() => writeUsageData(ordinaryWith({ targetObjects: json("null") }))).toThrow(
      'The targetObjects of the statistic "AIS" must be an array, found null.',
    );
    expect(() => writeUsageData(ordinaryWith({ value: { value: "high" } }))).toThrow(
      "A value of base type float must be a number",
    );
    expect(() => writeUsageData(ordinaryWith({ value: { value: 1, baseType: "decimal" } }))).toThrow(
      'The baseType of the value of a statistic must be "boolean"',
    );
    const mapped = (mapping: object): UsageData => ({
      statistics: [{ kind: "categorized", ...base, mapping: json(JSON.stringify(mapping)) }],
    });
    expect(() => writeUsageData(mapped({ entries: [] }))).toThrow("The entries of a mapping needs at least one entry.");
    expect(() => writeUsageData(mapped({ entries: [{ mapKey: "a", mappedValue: "1" }] }))).toThrow(
      'A value of base type float must be a number, found "1".',
    );
    expect(() => writeUsageData(mapped({ entries: [{ mapKey: "a", mappedValue: 1, caseSensitive: "yes" }] }))).toThrow(
      'The caseSensitive of a map entry must be a boolean, found "yes".',
    );
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = readFileSync(new URL("../../../docs/runtime/usage.md", import.meta.url), "utf8");
    const usage = await import("../src/usage/index.js");
    expect(await runGuideSamples(guide, { "@assesskit/runtime/usage": usage })).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  it("reads back the document that it writes", () => {
    fc.assert(
      fc.property(usageData, (model) => {
        expect(readUsageData(writeUsageData(model))).toEqual(model);
      }),
      { numRuns: 300 },
    );
  });

  it("reads a mutated document or refuses it with a ReadError or a SecurityError, and throws nothing else", () => {
    fuzzReader(usageData.map(writeUsageData), readUsageData);
  });

  it("writes the same text for a model that it has read as for the model it was read from", () => {
    fc.assert(
      fc.property(usageData, (model) => {
        const text = writeUsageData(model);
        expect(writeUsageData(readUsageData(text))).toBe(text);
      }),
      { numRuns: 200 },
    );
  });
});
