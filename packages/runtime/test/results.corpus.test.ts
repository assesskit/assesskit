import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { parseXml, readResults, writeResults } from "../src/index.js";
import { canonical } from "./arbitraries/xml.js";
import { issueOf } from "./read-failure.js";

const examples = join(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples/results");

const read = (name: string): string => readFileSync(join(examples, name), "utf8");

describe("results of the 1EdTech examples", () => {
  it("reads report.xml: a test result, two attempts at one item and their variables", () => {
    const result = readResults(read("report.xml"));
    expect(result.context).toEqual({
      sourcedId: "johnsmith1",
      sessionIdentifiers: [{ sourceId: "http://www.imsglobal.org/", identifier: "EXAMPLE" }],
    });
    expect(result.testResult).toMatchObject({ identifier: "SAMPLE", datestamp: "2020-08-25T18:19:20" });
    expect(result.testResult?.variables.map(({ identifier }) => identifier)).toEqual([
      "duration",
      "S01.duration",
      "SCORE",
    ]);
    expect(result.testResult?.variables[2]).toMatchObject({ kind: "outcome", masteryValue: 1 });
    expect(
      result.itemResults.map(({ identifier, sequenceIndex, sessionStatus }) => [
        identifier,
        sequenceIndex,
        sessionStatus,
      ]),
    ).toEqual([
      ["Q01", 1, "final"],
      ["Q01", 1, "final"],
    ]);
    const [first, second] = result.itemResults;
    expect(first?.variables[1]).toMatchObject({
      choiceSequence: ["D", "B", "C", "A"],
      correctResponse: { value: { value: "A" } },
      candidateResponse: { value: "A" },
    });
    expect(second?.variables[1]).toMatchObject({ candidateResponse: { value: "B" } });
  });

  it("writes report.xml back as the same document up to canonical form", () => {
    const text = read("report.xml");
    expect(canonical(parseXml(writeResults(readResults(text))))).toEqual(canonical(parseXml(text)));
  });

  it("reads the durations of conformance-use-case-1.xml, which are ISO 8601 durations", () => {
    const result = readResults(read("conformance-use-case-1.xml"));
    expect(result.testResult?.variables[0]).toMatchObject({
      candidateResponse: { baseType: "duration", value: 120.049722 },
    });
    const durations = result.itemResults.map((item) => item.variables[1]);
    expect(
      durations.map((variable) => (variable?.kind === "response" ? variable.candidateResponse : undefined)),
    ).toMatchObject([{ value: 92.131795 }, { value: 9.590316 }, { value: 8.554191 }, { value: 9.77342 }]);
  });

  it("reads conformance-use-case-1.xml: four items, a multiple response and two strings", () => {
    const result = readResults(read("conformance-use-case-1.xml"));
    expect(result.itemResults).toHaveLength(4);
    const response = (index: number): unknown =>
      result.itemResults[index]?.variables.find(({ identifier }) => identifier === "RESPONSE");
    expect(response(1)).toMatchObject({
      cardinality: "multiple",
      candidateResponse: { values: ["choice_a", "choice_b", "choice_c"] },
    });
    expect(response(3)).toMatchObject({ baseType: "string", candidateResponse: { value: "My Haiku" } });
  });

  it("reads back what it writes for conformance-use-case-1.xml, with the durations in seconds", () => {
    const result = readResults(read("conformance-use-case-1.xml"));
    const text = writeResults(result);
    expect(text).toContain("<value>120.049722</value>");
    expect(readResults(text)).toEqual(result);
  });

  it("refuses full-example.xml, which is not well-formed at line 26", () => {
    expect(issueOf(() => readResults(read("full-example.xml")))).toMatchObject({
      code: "assesskit/xml/not-well-formed",
      location: { line: 26 },
    });
  });
});
