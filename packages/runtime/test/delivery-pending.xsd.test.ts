import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { type AssessmentResult, buildSingle, writeResults } from "../src/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import {
  ADAPTIVE,
  act,
  begun,
  CAT_A,
  engineOf,
  fail,
  linkResolution,
  next,
  outcome,
  part,
  pick,
  played,
  processing,
  refs,
  reportedSession,
  reportedTest,
  SUM_SCORES,
  section,
  setOutcome,
  stage,
  waiting,
} from "./pending-fixtures.js";

const schemaDirectory = requireSchemas(resolve(import.meta.dirname, "../../.."));

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(schemaDirectory);
});

afterAll(() => {
  schemas.close();
});

/** The issues of the RR schema for a report written by `writeResults`. */
const issuesOf = (report: AssessmentResult, path = "report.xml"): Promise<readonly unknown[]> =>
  validateXmlFiles(schemas, [{ path, content: writeResults(report) }]);

describe("results validated against the Results Reporting schema", () => {
  it("validates the report of a finished session, provisional while an essay waits for its score and final after", async () => {
    const engine = reportedTest();
    const { state } = reportedSession(engine);
    expect(await issuesOf(engine.results(state))).toEqual([]);
    const supplied = played(engine, state, {
      type: "supply-scores",
      request: "item:w:1:SCORE",
      value: buildSingle("float", 8),
      scorer: "human",
      at: 6000,
    });
    expect(await issuesOf(engine.results(supplied.state))).toEqual([]);
    expect(await issuesOf(engine.results(begun(engine).state))).toEqual([]);
  });

  it("validates the report of a session with a link to a tool", async () => {
    const engine = engineOf(
      `${outcome("TOTAL", "float")}${part("P", section("S", refs("L1", "q")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
      { items: { L1: linkResolution("L1") } },
    );
    const submitted = played(engine, begun(engine).state, act("submit", "L1", 5), next(6));
    expect(await issuesOf(engine.results(submitted.state))).toEqual([]);
  });

  it("validates the report that Submit Results carries, and the report with the outcomes the CAT engine added", async () => {
    const engine = engineOf(
      `${outcome("TOTAL", "float")}${outcome("LEVEL", "float", 'external-scored="externalMachine"')}${part("P", section("A", ADAPTIVE + refs("i1", "i2", "i3")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
      { cat: CAT_A },
    );
    const start = begun(engine);
    const staged = played(
      engine,
      start.state,
      stage(engine, start.state, 1, { itemIdentifiers: ["i1", "i2"], stageLength: 2 }),
    );
    const done = played(
      engine,
      staged.state,
      act("skip", "i1", 2),
      next(3),
      pick("i2", "B", 4),
      act("submit", "i2", 5),
    );
    const request = waiting(engine, done.state);
    if (request.kind !== "submit-results") fail("A Submit Results request was expected.");
    expect(await issuesOf(request.assessmentResult, "request.xml")).toEqual([]);
    const reply: AssessmentResult = {
      context: { sessionIdentifiers: [{ sourceId: "https://cat.example", identifier: "run-7" }] },
      testResult: {
        identifier: "T",
        datestamp: "2026-10-30T12:00:00Z",
        supports: [],
        variables: [
          {
            kind: "outcome",
            identifier: "LEVEL",
            cardinality: "single",
            baseType: "float",
            value: buildSingle("float", 2),
          },
          {
            kind: "outcome",
            identifier: "THETA",
            cardinality: "single",
            baseType: "float",
            value: buildSingle("float", 0.5),
          },
        ],
      },
      itemResults: [],
    };
    const merged = played(engine, done.state, stage(engine, done.state, 6, null, { assessmentResult: reply }));
    expect(await issuesOf(engine.results(merged.state))).toEqual([]);
  });
});
