import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { parseXml, readUsageData, writeUsageData } from "../src/index.js";
import { canonical } from "./arbitraries/xml.js";
import { issueOf } from "./read-failure.js";

const examples = join(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");

const read = (path: string): string => readFileSync(join(examples, path), "utf8");

describe("usage data of the 1EdTech examples", () => {
  it("reads usageData/example.xml: its item statistics, two categorized ones and the distractor statistics", () => {
    const text = read("usageData/example.xml");
    const data = readUsageData(text);
    expect(data.glossary).toBeUndefined();
    expect(data.statistics).toHaveLength((text.match(/<(?:ordinary|categorized)Statistic[ >]/g) ?? []).length);
    expect(data.statistics.filter(({ kind }) => kind === "categorized").map(({ name }) => name)).toEqual([
      "D-Parm",
      "Score_Conversion",
    ]);
    expect(data.statistics[0]).toEqual({
      kind: "ordinary",
      name: "AIS",
      context: "http://ntweb.ets.org/itemStats/Context/XVZ2004_J1B",
      caseCount: 689_325,
      stdError: 0.0022,
      lastUpdated: "2004-07-04",
      targetObjects: [{ identifier: "Item_VB123456" }],
      value: { value: 0.87 },
    });
    const distractor = data.statistics.find(({ name }) => name === "AIS-Response");
    expect(distractor).toMatchObject({
      glossary: "http://www.imsglobal.org/question/qti_2p0/glossaries/distractor_statistics",
      targetObjects: [{ identifier: "Item_VB123456", partIdentifier: "A" }],
      value: { value: 0.21 },
    });
    const conversion = data.statistics.at(-1);
    expect(conversion).toMatchObject({
      name: "Score_Conversion",
      targetObjects: [{ identifier: "Test_VB" }],
      mapping: { lowerBound: 1, upperBound: 9, defaultValue: 0 },
    });
    expect(conversion && "mapping" in conversion ? conversion.mapping.entries : []).toHaveLength(9);
  });

  it("writes usageData/example.xml back as the same document up to canonical form", () => {
    const text = read("usageData/example.xml");
    expect(canonical(parseXml(writeUsageData(readUsageData(text))))).toEqual(canonical(parseXml(text)));
  });

  it("refuses the usage data of the packages, which are in the namespace of QTI 2.2", () => {
    for (const name of ["FEMALE", "MALE", "TOTAL"]) {
      expect(issueOf(() => readUsageData(read(`packaging/usageData/USAGE-${name}-TEST-106391.xml`)))).toMatchObject({
        code: "assesskit/usage/not-usage-data",
        message: expect.stringContaining("{http://www.imsglobal.org/xsd/imsqti_usagedata_v2p2}usageData"),
      });
    }
  });
});
