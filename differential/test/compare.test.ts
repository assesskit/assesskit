import { describe, expect, it } from "vitest";
import {
  compare,
  compareSessions,
  type Implementation,
  type ItemCase,
  type Observation,
  type Play,
  type Run,
  type SessionCase,
  sameValue,
  type TurnObservation,
} from "../src/index.ts";

const testCase = (name: string): ItemCase => ({ name, xml: "<qti-assessment-item/>", responses: {}, seed: 1 });
const accepts = (observation: Partial<Observation>): Run => ({
  accepted: true,
  observation: { outcomes: {}, templateValues: {}, ...observation },
});
const rejects = (reason: string): Run & Play => ({ accepted: false, reason });
const implementation = (name: string, runs: Record<string, Run>, plays: Record<string, Play> = {}): Implementation => ({
  name,
  run: (item) => runs[item.name] ?? rejects("unknown"),
  play: (session) => plays[session.name] ?? rejects("unknown"),
});
const sessionCase = (name: string): SessionCase => ({ name, xml: "<qti-assessment-item/>", turns: [], seed: 1 });
const turn = (observation: Partial<TurnObservation>): TurnObservation => ({
  accepted: true,
  outcomes: {},
  numAttempts: 1,
  closed: false,
  ...observation,
});

describe("sameValue", () => {
  it("compares scalars, lists and records element by element", () => {
    expect(sameValue(1, 1)).toBe(true);
    expect(sameValue(1, "1")).toBe(false);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, undefined)).toBe(false);
    expect(sameValue(["A", "B"], ["A", "B"])).toBe(true);
    expect(sameValue(["A", "B"], ["B", "A"])).toBe(false);
    expect(sameValue(["A"], ["A", "B"])).toBe(false);
    expect(sameValue({ x: 1, y: "a" }, { y: "a", x: 1 })).toBe(true);
    expect(sameValue({ x: 1 }, { x: 1, y: 2 })).toBe(false);
    expect(sameValue(["A"], { 0: "A" })).toBe(false);
  });
});

describe("compare", () => {
  it("reports the outcome and template values that differ", () => {
    const reference = implementation("ref", {
      a: accepts({ outcomes: { SCORE: 1, FEEDBACK: "ok" }, templateValues: { N: 5 } }),
    });
    const subject = implementation("sub", {
      a: accepts({ outcomes: { SCORE: 0, FEEDBACK: "ok" }, templateValues: { N: 6, M: 1 } }),
    });
    const report = compare([testCase("a")], reference, subject, []);
    expect(report.compared).toBe(1);
    expect(report.differences).toEqual([
      { item: "a", kind: "outcome", variable: "SCORE", reference: 1, subject: 0 },
      { item: "a", kind: "template", variable: "M", reference: undefined, subject: 1 },
      { item: "a", kind: "template", variable: "N", reference: 5, subject: 6 },
    ]);
  });

  it("reports an item that only one implementation accepts, and lists the items both reject", () => {
    const reference = implementation("ref", { a: accepts({}), b: rejects("not an item") });
    const subject = implementation("sub", { a: rejects("unsupported"), b: rejects("not an item either") });
    const report = compare([testCase("a"), testCase("b")], reference, subject, []);
    expect(report.compared).toBe(0);
    expect(report.rejected).toEqual([{ item: "b", reason: "not an item" }]);
    expect(report.differences).toEqual([
      { item: "a", kind: "acceptance", variable: "", reference: true, subject: false },
    ]);
  });

  it("sets aside the accepted differences", () => {
    const reference = implementation("ref", { a: accepts({ outcomes: { SCORE: 1 } }) });
    const subject = implementation("sub", { a: accepts({ outcomes: { SCORE: 0 } }) });
    const accepted = [{ item: "a", variable: "SCORE", reason: "The specification says 0.", source: "INFO §2.11.1.5" }];
    const report = compare([testCase("a")], reference, subject, accepted);
    expect(report.differences).toEqual([]);
    expect(report.accepted).toHaveLength(1);
  });
});

describe("compareSessions", () => {
  it("reports what differs turn by turn: acceptance, outcomes, numAttempts and closing", () => {
    const reference = implementation(
      "ref",
      {},
      {
        a: { accepted: true, turns: [turn({ outcomes: { SCORE: 0 } }), turn({ numAttempts: 2, closed: true })] },
        b: { accepted: true, turns: [turn({}), turn({ accepted: false })] },
      },
    );
    const subject = implementation(
      "sub",
      {},
      {
        a: { accepted: true, turns: [turn({ outcomes: { SCORE: 1 } }), turn({ numAttempts: 3, closed: true })] },
        b: { accepted: true, turns: [turn({}), turn({})] },
      },
    );
    const report = compareSessions([sessionCase("a"), sessionCase("b")], reference, subject, []);
    expect(report.compared).toBe(2);
    expect(report.differences).toEqual([
      { item: "a turn 1", kind: "outcome", variable: "SCORE", reference: 0, subject: 1 },
      { item: "a turn 2", kind: "session", variable: "numAttempts", reference: 2, subject: 3 },
      { item: "b turn 2", kind: "acceptance", variable: "", reference: false, subject: true },
    ]);
  });

  it("reports a session that only one implementation plays, and lists those both reject", () => {
    const reference = implementation("ref", {}, { a: { accepted: true, turns: [] }, b: rejects("not an item") });
    const subject = implementation("sub", {}, { a: rejects("processing failed"), b: rejects("no") });
    const report = compareSessions([sessionCase("a"), sessionCase("b")], reference, subject, []);
    expect(report.rejected).toEqual([{ item: "b", reason: "not an item" }]);
    expect(report.differences).toEqual([
      { item: "a", kind: "acceptance", variable: "", reference: true, subject: false },
    ]);
  });
});
