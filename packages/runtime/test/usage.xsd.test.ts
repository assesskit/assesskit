import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { requireSchemas } from "../../../scripts/schemas.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import {
  DISTRACTOR_STATISTICS,
  ITEM_STATISTICS,
  type ItemStatistic,
  readUsageData,
  USAGE_NAMESPACE,
  type UsageData,
  writeUsageData,
} from "../src/usage/index.js";
import { usageData } from "./arbitraries/usage.js";
import { declaredNames, unusedNames, usedNames } from "./schema-declarations.js";

const root = resolve(import.meta.dirname, "../../..");
const schemaDirectory = requireSchemas(root);
const examples = join(requireCorpus(root), "qti-examples/qtiv3-examples");

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(schemaDirectory);
});

afterAll(() => {
  schemas.close();
});

/** Returns the issues of the UD schema for a document. */
const issuesOf = (content: string, path = "usage.xml"): Promise<readonly unknown[]> =>
  validateXmlFiles(schemas, [{ path, content }]);

const base = { context: "http://example.com/context", targetObjects: [{ identifier: "Item_VB123456" }] };

/** Usage data that uses every element and attribute of the UD schema. */
const everything: UsageData = {
  glossary: "http://example.com/glossary",
  statistics: [
    {
      kind: "ordinary",
      name: "AIS",
      glossary: "http://example.com/other",
      context: "http://ntweb.ets.org/itemStats/Context/XVZ2004_J1B",
      caseCount: 689_325,
      stdError: 0.0022,
      stdDeviation: 1.5,
      lastUpdated: "2004-07-04",
      targetObjects: [
        { identifier: "Item_VB123456", partIdentifier: "A", objectType: "choice" },
        { identifier: "Test_VB", objectType: "test" },
      ],
      value: { value: "high", baseType: "string", fieldIdentifier: "level" },
    },
    {
      kind: "categorized",
      name: "D-Param",
      glossary: "http://example.com/other",
      ...base,
      caseCount: 1200,
      stdError: 0.01,
      stdDeviation: 2,
      lastUpdated: "2004-07-05",
      mapping: {
        lowerBound: 1,
        upperBound: 4,
        defaultValue: 0,
        entries: [
          { mapKey: "d1", mappedValue: 412.5267, caseSensitive: true },
          { mapKey: "d2", mappedValue: 426.5699, caseSensitive: false },
        ],
      },
    },
  ],
};

describe("writeUsageData", () => {
  it("writes usage data without statistics", async () => {
    expect(await issuesOf(writeUsageData({ statistics: [] }))).toEqual([]);
  });

  it("writes every element and attribute that the schema declares, as documents that it accepts and that read back", async () => {
    const text = writeUsageData(everything);
    expect(await issuesOf(text)).toEqual([]);
    expect(readUsageData(text)).toEqual(everything);
    const declared = declaredNames(schemaDirectory, ["imsqti_usagedatav3p0_v1p0.xsd"]);
    expect(unusedNames(declared, usedNames([text], [USAGE_NAMESPACE]))).toEqual([]);
  });

  it("writes every term of ObjectTypeEnum", async () => {
    const statistics = (["test", "testpart", "section", "item", "outcome", "interaction", "choice"] as const).map(
      (objectType): ItemStatistic => ({
        kind: "ordinary",
        name: "AIS",
        context: "c",
        targetObjects: [{ identifier: "x", objectType }],
        value: { value: 1 },
      }),
    );
    expect(await issuesOf(writeUsageData({ statistics }))).toEqual([]);
  });

  it("writes a statistic under every name of the vocabularies, which the schema reads as identifiers", async () => {
    const statistics = [...DISTRACTOR_STATISTICS, ...ITEM_STATISTICS].map(
      (name): ItemStatistic => ({ kind: "ordinary", name, ...base, value: { value: 0.5 } }),
    );
    expect(await issuesOf(writeUsageData({ statistics }))).toEqual([]);
  });

  it("writes the value of every base type", async () => {
    const values = [
      ["boolean", true],
      ["directedPair", ["A", "B"]],
      ["duration", 90.5],
      ["file", { reference: "uploads/a.pdf", mimeType: "application/pdf" }],
      ["float", 1.5],
      ["identifier", "choice"],
      ["integer", -3],
      ["pair", ["A", "B"]],
      ["point", [10, 20]],
      ["string", "text & more"],
      ["uri", "http://example.com/"],
    ] as const;
    const statistics = values.map(
      ([baseType, value]): ItemStatistic => ({
        kind: "ordinary",
        name: "x",
        ...base,
        value: { baseType, value: value as never },
      }),
    );
    expect(await issuesOf(writeUsageData({ statistics }))).toEqual([]);
  });

  it("has a schema that rejects a statistic without a target object, so the checks above can fail", async () => {
    const text = writeUsageData({
      statistics: [{ kind: "ordinary", name: "AIS", ...base, value: { value: 1 } }],
    }).replace('<targetObject identifier="Item_VB123456"/>', "");
    expect(await issuesOf(text)).toMatchObject([
      { rule: "assesskit/node/xsd-invalid", message: expect.stringContaining("targetObject") },
    ]);
  });
});

describe("usage data of the 1EdTech examples", () => {
  it("writes usageData/example.xml as a document that the schema accepts", async () => {
    const text = writeUsageData(readUsageData(readFileSync(join(examples, "usageData/example.xml"), "utf8")));
    expect(await issuesOf(text, "example.xml")).toEqual([]);
  });
});

describe("properties", () => {
  it("writes documents that the UD schema accepts", async () => {
    const samples = fc.sample(usageData, { numRuns: 60, seed: 20_220_202 });
    const files = samples.map((model, index) => ({ path: `usage-${index}.xml`, content: writeUsageData(model) }));
    expect(await validateXmlFiles(schemas, files)).toEqual([]);
  });
});
