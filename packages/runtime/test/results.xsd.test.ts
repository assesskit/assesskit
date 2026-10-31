import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { requireSchemas } from "../../../scripts/schemas.js";
import {
  type AssessmentResult,
  container,
  type ItemResult,
  readResults,
  record,
  single,
  writeResults,
} from "../src/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import { assessmentResult } from "./arbitraries/results.js";

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
        candidateResponse: single("duration", 100),
        extensions: [],
      },
      {
        kind: "context",
        identifier: "QTI_CONTEXT",
        cardinality: "record",
        value: record([["x", nonNull(single("integer", 1))]]),
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
            value: nonNull(container("ordered", "directedPair", [["A", "B"]])),
          },
          candidateResponse: container("ordered", "directedPair", [["B", "A"]]),
          extensions: [],
        },
        {
          kind: "outcome",
          identifier: "SCORE",
          cardinality: "single",
          baseType: "float",
          value: single("float", 0.5),
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
          value: container("multiple", "point", [[1, 2]]),
        },
        {
          kind: "context",
          identifier: "CV",
          cardinality: "single",
          baseType: "file",
          value: single("file", { reference: "f.pdf", mimeType: "application/pdf" }),
        },
      ],
      candidateComment: "unclear",
      supports: [{ name: "item-translation", assignment: "assigned", value: "ko", language: "ko" }],
    },
  ],
};

describe("writeResults", () => {
  it("[R1][R2][R3][X] writes a result of which only the context is known", async () => {
    const text = writeResults({ context: { sessionIdentifiers: [] }, itemResults: [] });
    expect(await issuesOf(text)).toEqual([]);
  });

  it("[R1][R2][R3][R4][R5][R6][R7][R8][R9][R10][R11][R12][R13][R14][R15][X] writes every element and attribute of the schema", async () => {
    expect(await issuesOf(writeResults(everything))).toEqual([]);
  });

  it("[R16][R17][R18][R19][X] writes every term of the vocabularies", async () => {
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

  it("[R13][X] writes the value of every base type", async () => {
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
      value: single(baseType, value as never),
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

  it("[X][N] has a schema that rejects a result without a context, so the checks above can fail", async () => {
    const text = writeResults({ context: { sessionIdentifiers: [] }, itemResults: [] }).replace("<context/>", "");
    expect(await issuesOf(text)).toMatchObject([
      { code: "assesskit/node/xsd-invalid", message: expect.stringContaining("context") },
    ]);
  });
});

describe("results of the 1EdTech examples", () => {
  it("[R1][X][C] writes report.xml and conformance-use-case-1.xml as documents that the schema accepts", async () => {
    for (const name of ["report.xml", "conformance-use-case-1.xml"]) {
      const text = writeResults(readResults(readFileSync(join(examples, name), "utf8")));
      expect(await issuesOf(text, name), name).toEqual([]);
    }
  });
});

describe("properties", () => {
  it("[R1][X] writes documents that the RR schema accepts", async () => {
    const samples = fc.sample(assessmentResult({ extensions: false }), { numRuns: 60, seed: 20_221_101 });
    const files = samples.map((model, index) => ({ path: `result-${index}.xml`, content: writeResults(model) }));
    expect(await validateXmlFiles(schemas, files)).toEqual([]);
  });
});
