import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { requireSchemas } from "../../../scripts/schemas.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import {
  type AssessmentResult,
  type ItemResult,
  RESULTS_NAMESPACE,
  readResults,
  writeResults,
} from "../src/results/index.js";
import { buildContainer, buildRecord, buildSingle } from "../src/values/index.js";
import { assessmentResult } from "./arbitraries/results.js";
import { declaredNames, unusedNames, usedNames } from "./schema-declarations.js";

const root = resolve(import.meta.dirname, "../../..");
const schemaDirectory = requireSchemas(root);
const examples = join(requireCorpus(root), "qti-examples/qtiv3-examples/results");

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(schemaDirectory);
});

afterAll(() => {
  schemas.close();
});

/** Returns the issues of the RR schema for a document. */
const issuesOf = (content: string, path = "result.xml"): Promise<readonly unknown[]> =>
  validateXmlFiles(schemas, [{ path, content }]);

function nonNull<T>(value: T | null): T {
  if (value === null) throw new Error("The test builds a NULL.");
  return value;
}

/** A result that uses every element and attribute of the RR schema. */
const everything: AssessmentResult = {
  context: {
    sourcedId: "johnsmith1",
    sessionIdentifiers: [{ sourceId: "http://www.imsglobal.org/", identifier: "EXAMPLE" }],
  },
  testResult: {
    identifier: "SAMPLE",
    datestamp: "2020-08-25T18:19:20",
    variables: [
      {
        kind: "response",
        identifier: "duration",
        cardinality: "single",
        baseType: "duration",
        candidateResponse: buildSingle("duration", 100),
        extensions: [],
      },
      {
        kind: "context",
        identifier: "QTI_CONTEXT",
        cardinality: "record",
        value: buildRecord([["x", nonNull(buildSingle("integer", 1))]]),
      },
    ],
    supports: [{ name: "additional-testing-time", assignment: "universal" }],
  },
  itemResults: [
    {
      identifier: "Q01",
      sequenceIndex: 1,
      datestamp: "2020-08-25T18:18:40.5Z",
      sessionStatus: "pendingExternalScoring",
      variables: [
        {
          kind: "response",
          identifier: "RESPONSE",
          cardinality: "ordered",
          baseType: "directedPair",
          choiceSequence: ["A", "B"],
          scoreStatus: "notscored",
          answeredStatus: "attempted",
          correctResponse: {
            interpretation: "the order",
            value: nonNull(buildContainer("ordered", "directedPair", [["A", "B"]])),
          },
          candidateResponse: buildContainer("ordered", "directedPair", [["B", "A"]]),
          extensions: [],
        },
        {
          kind: "outcome",
          identifier: "SCORE",
          cardinality: "single",
          baseType: "float",
          value: buildSingle("float", 0.5),
          view: ["candidate", "tutor"],
          interpretation: "points",
          longInterpretation: "http://example.com/points",
          normalMaximum: 1,
          normalMinimum: 0,
          masteryValue: 0.5,
          externalScored: "externalMachine",
          variableIdentifierRef: "RESPONSE",
          outcomeInformation: [],
        },
        {
          kind: "template",
          identifier: "TV",
          cardinality: "multiple",
          baseType: "point",
          value: buildContainer("multiple", "point", [[1, 2]]),
        },
        {
          kind: "context",
          identifier: "CV",
          cardinality: "single",
          baseType: "file",
          value: buildSingle("file", { reference: "f.pdf", mimeType: "application/octet-stream" }),
        },
      ],
      candidateComment: "unclear",
      supports: [{ name: "item-translation", assignment: "assigned", value: "ko", language: "ko" }],
    },
  ],
};

describe("writeResults", () => {
  it("writes a result of which only the context is known", async () => {
    const text = writeResults({ context: { sessionIdentifiers: [] }, itemResults: [] });
    expect(await issuesOf(text)).toEqual([]);
  });

  it("writes every element and attribute that the schema declares, as documents that it accepts and that read back", async () => {
    const text = writeResults(everything);
    expect(await issuesOf(text)).toEqual([]);
    expect(readResults(text)).toEqual(everything);
    const declared = declaredNames(schemaDirectory, ["imsqti_resultv3p0_v1p0.xsd"]);
    expect(unusedNames(declared, usedNames([text], [RESULTS_NAMESPACE]))).toEqual([]);
  });

  it("writes every term of the vocabularies", async () => {
    const statuses = [
      "initial",
      "pendingSubmission",
      "pendingResponseProcessing",
      "pendingExternalScoring",
      "final",
    ] as const;
    const answered = ["answered", "attempted", "presented", "notpresented"] as const;
    const itemResults = statuses.map(
      (sessionStatus, index): ItemResult => ({
        identifier: `Q${index}`,
        datestamp: "2020-01-01T00:00:00",
        sessionStatus,
        variables: [
          {
            kind: "response",
            identifier: "R",
            cardinality: "single",
            baseType: "integer",
            scoreStatus: index % 2 === 0 ? "scored" : "notscored",
            answeredStatus: answered[index % answered.length],
            candidateResponse: null,
            extensions: [],
          },
        ],
        supports: (["assigned", "inherit", "prohibited", "universal"] as const).map((assignment) => ({
          name: "s",
          assignment,
        })),
      }),
    );
    expect(await issuesOf(writeResults({ context: { sessionIdentifiers: [] }, itemResults }))).toEqual([]);
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
    const variables = values.map(([baseType, value]) => ({
      kind: "outcome" as const,
      identifier: `O_${baseType}`,
      cardinality: "single" as const,
      baseType,
      value: buildSingle(baseType, value as never),
    }));
    const item: ItemResult = {
      identifier: "Q",
      datestamp: "2020-01-01T00:00:00",
      sessionStatus: "final",
      variables,
      supports: [],
    };
    expect(await issuesOf(writeResults({ context: { sessionIdentifiers: [] }, itemResults: [item] }))).toEqual([]);
  });

  it("has a schema that rejects a result without a context, so the checks above can fail", async () => {
    const text = writeResults({ context: { sessionIdentifiers: [] }, itemResults: [] }).replace("<context/>", "");
    expect(await issuesOf(text)).toMatchObject([
      { rule: "assesskit/node/xsd-invalid", message: expect.stringContaining("context") },
    ]);
  });
});

describe("results of the 1EdTech examples", () => {
  it("writes report.xml and conformance-use-case-1.xml as documents that the schema accepts", async () => {
    for (const name of ["report.xml", "conformance-use-case-1.xml"]) {
      const text = writeResults(readResults(readFileSync(join(examples, name), "utf8")));
      expect(await issuesOf(text, name), name).toEqual([]);
    }
  });
});

describe("properties", () => {
  it("writes documents that the RR schema accepts", async () => {
    const samples = fc.sample(assessmentResult({ extensions: false }), { numRuns: 60, seed: 20_221_101 });
    const files = samples.map((model, index) => ({ path: `result-${index}.xml`, content: writeResults(model) }));
    expect(await validateXmlFiles(schemas, files)).toEqual([]);
  });
});
