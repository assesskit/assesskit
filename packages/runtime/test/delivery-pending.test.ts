import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readScoringRubrics, type ScoringRubric } from "../src/asi/index.js";
import type { CatSessionPort, CreateSessionResponse } from "../src/cat/index.js";
import {
  type Action,
  createEngine,
  type DeliveryState,
  deserializeState,
  drainCat,
  type Engine,
  sendCatRequest,
  serializeState,
  stamp,
} from "../src/delivery/index.js";
import { readView, writeView } from "../src/delivery/wire.js";
import { DataError } from "../src/errors.js";
import { createRandom } from "../src/index.js";
import { describeInteractions } from "../src/interactions/index.js";
import { drawOrders } from "../src/interactions/internal.js";
import { writePnp } from "../src/pnp/index.js";
import { type AssessmentResult, readResults, writeResults } from "../src/results/index.js";
import { buildSingle, isXsdDateTime, type Value } from "../src/values/index.js";
import {
  ADAPTIVE,
  act,
  begun,
  CAT_A,
  choice,
  described,
  engineOf,
  essay,
  fail,
  fakePort,
  key,
  linkResolution,
  next,
  outcome,
  part,
  pick,
  played,
  pnpOf,
  processing,
  REPORT_CONTEXT,
  refs,
  refusalOf,
  reportedSession,
  reportedTest,
  SUM_SCORES,
  section,
  setOutcome,
  stage,
  waiting,
  write,
} from "./pending-fixtures.js";
import { criterionMarkup, ESSAY, ESSAY_MARKUP, rubricMarkup } from "./scoring-rubrics.js";

/** Wraps a port so that it records the signal that each request gets. */
function recordingSignals(port: CatSessionPort, signals: (AbortSignal | undefined)[]): CatSessionPort {
  return {
    createSession: (prefix, section, body, options) => {
      signals.push(options?.signal);
      return port.createSession(prefix, section, body);
    },
    submitResults: (prefix, section, session, body, options) => {
      signals.push(options?.signal);
      return port.submitResults(prefix, section, session, body);
    },
    endSession: (prefix, section, session, options) => {
      signals.push(options?.signal);
      return port.endSession(prefix, section, session);
    },
  };
}

const wire = (state: DeliveryState): DeliveryState => deserializeState(serializeState(state));

describe("scoring requests", () => {
  const essays = {
    e1: essay("e1", {
      declarations: '<qti-outcome-declaration identifier="RUNS" cardinality="single" base-type="integer"/>',
      responseProcessing:
        '<qti-response-processing><qti-set-outcome-value identifier="RUNS"><qti-sum><qti-variable identifier="RUNS"/><qti-base-value base-type="integer">1</qti-base-value></qti-sum></qti-set-outcome-value></qti-response-processing>',
    }),
    e2: essay("e2"),
  };
  const content = `${outcome("TOTAL", "float")}${part("P", section("S", refs("e1", "e2")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`;
  const engine = engineOf(content, { items: essays });

  it("makes the request of an item outcome when its session closes, with the declaration and the response", () => {
    const start = begun(engine);
    expect(engine.pending(start.state).scoring).toEqual([]);
    const submitted = played(engine, start.state, write("e1", "An essay\nof two lines", 1), act("submit", "e1", 2));
    expect(described(submitted.events)).toEqual([
      "responses-set e1@1",
      "attempt-ended e1 submit@2",
      "response-processed e1@2",
      "outcome-processed T@2",
      "scoring-requested e1 item:e1:1:SCORE@2",
    ]);
    expect(engine.pending(submitted.state).scoring).toEqual([
      {
        id: "item:e1:1:SCORE",
        scope: "item",
        item: key("e1"),
        outcome: "SCORE",
        mode: "human",
        declaration: {
          cardinality: "single",
          baseType: "float",
          normalMinimum: 0,
          normalMaximum: 10,
          interpretation: "Essay score",
        },
        covers: [
          {
            item: key("e1"),
            responseIdentifier: "RESPONSE",
            presented: true,
            interaction: "extended-text-interaction",
            // Exact string, newline included.
            response: buildSingle("string", "An essay\nof two lines"),
          },
        ],
        requestedAt: 2,
      },
    ]);
  });

  it("passes the mode externalMachine and the variable-identifier-ref of the declaration", () => {
    const machine = engineOf(content, { items: { e1: essay("e1", { scorer: "externalMachine", ref: "RESPONSE" }) } });
    const submitted = played(machine, begun(machine).state, write("e1", "Text", 1), act("submit", "e1", 2));
    const [request] = machine.pending(submitted.state).scoring;
    expect(request).toMatchObject({ mode: "externalMachine", variableIdentifierRef: "RESPONSE" });
  });

  it("supplies the value of an item outcome: outcome processing runs again, response processing does not", () => {
    const submitted = played(engine, begun(engine).state, write("e1", "Text", 1), act("submit", "e1", 2));
    const runs = (state: DeliveryState): unknown => state.items[0]?.session.variables.outcomes.get("RUNS");
    expect(runs(submitted.state)).toEqual(buildSingle("integer", 1));
    const supplied = played(engine, submitted.state, {
      type: "supply-scores",
      request: "item:e1:1:SCORE",
      value: buildSingle("float", 7),
      scorer: "human",
      at: 3,
    });
    expect(described(supplied.events)).toEqual(["scores-applied e1 item:e1:1:SCORE@3", "outcome-processed T@3"]);
    expect(supplied.state.items[0]?.session.variables.outcomes.get("SCORE")).toEqual(buildSingle("float", 7));
    expect(supplied.state.outcomes.get("TOTAL")).toEqual(buildSingle("float", 7));
    // The scorer sets the value after the session closed; response processing is not run again.
    expect(runs(supplied.state)).toEqual(buildSingle("integer", 1));
    expect(engine.pending(supplied.state).scoring).toEqual([]);
    expect(supplied.state.scoring[0]?.supplied).toEqual({ value: buildSingle("float", 7), at: 3, scorer: "human" });
  });

  it("replaces the value when a second one is supplied, and takes an integer for a float outcome", () => {
    const submitted = played(engine, begun(engine).state, write("e1", "Text", 1), act("submit", "e1", 2));
    const supply = (value: number, at: number) =>
      ({
        type: "supply-scores",
        request: "item:e1:1:SCORE",
        value: buildSingle("integer", value),
        scorer: "externalMachine",
        at,
      }) as const;
    const first = played(engine, submitted.state, supply(4, 3));
    const second = played(engine, first.state, supply(9, 4));
    expect(described(second.events)).toEqual(["scores-replaced e1 item:e1:1:SCORE@4", "outcome-processed T@4"]);
    expect(second.state.items[0]?.session.variables.outcomes.get("SCORE")).toEqual(buildSingle("float", 9));
    expect(second.state.outcomes.get("TOTAL")).toEqual(buildSingle("float", 9));
    expect(second.state.scoring[0]?.supplied?.scorer).toBe("externalMachine");
  });

  it("accepts a supplied value after the test ended and while the session is suspended", () => {
    const submitted = played(engine, begun(engine).state, write("e1", "Text", 1), act("submit", "e1", 2));
    const suspended = played(engine, submitted.state, { type: "suspend", at: 3 });
    const supplied = played(engine, suspended.state, {
      type: "supply-scores",
      request: "item:e1:1:SCORE",
      value: buildSingle("float", 5),
      scorer: "human",
      at: 4,
    });
    expect(supplied.state.status).toBe("suspended");
    const ended = played(engine, supplied.state, { type: "resume", at: 5 }, { type: "end-test", at: 6 });
    expect(ended.state.status).toBe("ended");
    const replaced = played(engine, ended.state, {
      type: "supply-scores",
      request: "item:e1:1:SCORE",
      value: buildSingle("float", 6),
      scorer: "human",
      at: 7,
    });
    expect(replaced.state.outcomes.get("TOTAL")).toEqual(buildSingle("float", 6));
    expect(refusalOf(engine, ended.state, act("skip", "e1", 8)).reason).toBe("ended");
  });

  it("refuses a supply for no request, or of a value that does not fit the declaration", () => {
    const submitted = played(engine, begun(engine).state, write("e1", "Text", 1), act("submit", "e1", 2));
    const supply = (request: string, value: Value | null) =>
      ({ type: "supply-scores", request, value, scorer: "human", at: 3 }) as const;
    expect(refusalOf(engine, submitted.state, supply("item:e1:1:NOPE", buildSingle("float", 1))).reason).toBe(
      "unknown-request",
    );
    expect(refusalOf(engine, submitted.state, supply("item:e1:1:SCORE", buildSingle("string", "high"))).reason).toBe(
      "score-type-mismatch",
    );
    expect(refusalOf(engine, submitted.state, supply("item:e1:1:SCORE", buildSingle("boolean", true))).reason).toBe(
      "score-type-mismatch",
    );
    const nothing = played(engine, submitted.state, supply("item:e1:1:SCORE", null));
    expect(nothing.state.scoring[0]?.supplied?.value).toBeNull();
  });

  it("stamps a host action like a candidate action", () => {
    const submitted = played(engine, begun(engine).state, write("e1", "Text", 1), act("submit", "e1", 2));
    const action = stamp(
      submitted.state,
      { type: "supply-scores", request: "item:e1:1:SCORE", value: buildSingle("float", 3), scorer: "human" },
      0,
    );
    expect(action.at).toBe(2);
    expect(played(engine, submitted.state, action).state.scoring[0]?.supplied?.at).toBe(2);
  });

  it("keeps requests and supplied values through serialization", () => {
    const submitted = played(engine, begun(engine).state, write("e1", "Text", 1), act("submit", "e1", 2));
    const supplied = played(engine, submitted.state, {
      type: "supply-scores",
      request: "item:e1:1:SCORE",
      value: buildSingle("float", 2.5),
      scorer: "human",
      at: 3,
    });
    expect(wire(supplied.state)).toEqual(supplied.state);
    expect(serializeState(wire(supplied.state))).toBe(serializeState(supplied.state));
  });
});

/** The rubric block that names the responses an externally scored outcome of the test covers (the runtime convention). */
const covers = (outcomeId: string, entries: readonly (readonly [string, string])[], notes = ""): string =>
  `<qti-rubric-block view="scorer" use="scoring" class="external-score-covers" data-outcome-identifier="${outcomeId}"><qti-content-body>${notes}<ul>${entries
    .map(([ref, label]) => `<li data-item-ref="${ref}" data-response-identifier="RESPONSE">${label}</li>`)
    .join("")}</ul></qti-content-body></qti-rubric-block>`;

describe("host actions of other types", () => {
  const engine = engineOf(
    `${outcome("TOTAL", "float")}${part("P", section("A", ADAPTIVE + refs("i1")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
    { cat: CAT_A },
  );
  const { state } = begun(engine);
  const apply = (action: string) => () => engine.apply(state, JSON.parse(action));

  it("refuses a supply of a request, scorer or value of another type", () => {
    expect(apply('{"type":"supply-scores","request":1,"value":null,"scorer":"human","at":0}')).toThrow(
      "The action is invalid at request: expected a string, found 1.",
    );
    expect(apply('{"type":"supply-scores","request":"r","value":null,"scorer":"robot","at":0}')).toThrow(
      'The action is invalid at scorer: expected "human" or "externalMachine", found "robot".',
    );
    expect(
      apply('{"type":"supply-scores","request":"r","value":{"cardinality":"single"},"scorer":"human","at":0}'),
    ).toThrow(DataError);
  });

  it("refuses an answer of a CAT engine of another type", () => {
    const answer = (response: string) =>
      apply(`{"type":"cat-response","request":"cat:A:1:1","response":${response},"at":0}`);
    expect(answer("null")).toThrow("The action is invalid at response: expected an object, found null.");
    expect(answer('{"ended":false}')).toThrow("The action is invalid at response.ended: expected true, found false.");
    expect(answer('{"sessionIdentifier":4}')).toThrow(
      "The action is invalid at response.sessionIdentifier: expected a string, found 4.",
    );
    expect(answer('{"nextItems":{"itemIdentifiers":"i1"}}')).toThrow(DataError);
    expect(answer('{"nextItems":null,"assessmentResult":5}')).toThrow(
      "The action is invalid at response.assessmentResult: expected an object, found 5.",
    );
    expect(answer('{"assessmentResult":{"itemResults":[{"identifier":1,"variables":[]}]}}')).toThrow(
      "The action is invalid at response.assessmentResult.itemResults[0].identifier: expected a string, found 1.",
    );
  });
});

describe("scoring requests of the test", () => {
  const plain = { w1: essay("w1", { scorer: "none" }), w2: essay("w2", { scorer: "none" }) };
  const outcomes = `${outcome("CONTENT", "float", 'external-scored="human" normal-maximum="6"', "1.5")}${outcome("TOTAL", "float")}`;
  const block = covers(
    "CONTENT",
    [
      ["w1", "Task 1: essay"],
      ["w2", "Task 2: letter"],
    ],
    "<p>Rate content once, across both writing tasks.</p>",
  );
  const rule = processing(
    setOutcome(
      "TOTAL",
      '<qti-product><qti-variable identifier="CONTENT"/><qti-base-value base-type="integer">2</qti-base-value></qti-product>',
    ),
  );
  const engine = engineOf(`${outcomes}${block}${part("P", section("S", refs("w1", "w2", "q")))}${rule}`, {
    items: plain,
  });

  it("makes the request when every covered response is closed, with the labels and the submitted strings", () => {
    const first = played(engine, begun(engine).state, write("w1", "First task", 1), act("submit", "w1", 2));
    expect(engine.pending(first.state).scoring).toEqual([]);
    const both = played(engine, first.state, next(3), write("w2", "Second task", 4), act("submit", "w2", 5));
    expect(described(both.events)).toContain("scoring-requested T test:CONTENT@5");
    const [request] = engine.pending(both.state).scoring;
    expect(request).toMatchObject({
      id: "test:CONTENT",
      scope: "test",
      outcome: "CONTENT",
      mode: "human",
      declaration: { cardinality: "single", baseType: "float", normalMaximum: 6 },
      requestedAt: 5,
    });
    expect(request?.item).toBeUndefined();
    expect(request?.covers).toEqual([
      {
        item: key("w1"),
        responseIdentifier: "RESPONSE",
        label: "Task 1: essay",
        presented: true,
        interaction: "extended-text-interaction",
        response: buildSingle("string", "First task"),
      },
      {
        item: key("w2"),
        responseIdentifier: "RESPONSE",
        label: "Task 2: letter",
        presented: true,
        interaction: "extended-text-interaction",
        response: buildSingle("string", "Second task"),
      },
    ]);
  });

  it("lists a cover that was never presented, with presented false, when the test ends", () => {
    const first = played(engine, begun(engine).state, write("w1", "First task", 1), act("submit", "w1", 2));
    const ended = played(engine, first.state, { type: "end-test", at: 3 });
    expect(described(ended.events).at(-1)).toBe("scoring-requested T test:CONTENT@3");
    const [request] = engine.pending(ended.state).scoring;
    expect(
      request?.covers.map(({ item, presented, response, label }) => [item.ref, presented, response, label]),
    ).toEqual([
      ["w1", true, buildSingle("string", "First task"), "Task 1: essay"],
      ["w2", false, null, "Task 2: letter"],
    ]);
  });

  it("keeps a supplied test outcome through every later run of outcome processing, and its default until then", () => {
    const start = begun(engine);
    // Until a value is supplied, the outcome has its declared default.
    expect(start.state.outcomes.get("CONTENT")).toEqual(buildSingle("float", 1.5));
    const closed = played(
      engine,
      start.state,
      write("w1", "One", 1),
      act("submit", "w1", 2),
      next(3),
      write("w2", "Two", 4),
      act("submit", "w2", 5),
    );
    expect(closed.state.outcomes.get("CONTENT")).toEqual(buildSingle("float", 1.5));
    expect(closed.state.outcomes.get("TOTAL")).toEqual(buildSingle("float", 3));
    const supplied = played(engine, closed.state, {
      type: "supply-scores",
      request: "test:CONTENT",
      value: buildSingle("float", 5),
      scorer: "human",
      at: 6,
    });
    expect(supplied.state.outcomes.get("CONTENT")).toEqual(buildSingle("float", 5));
    expect(supplied.state.outcomes.get("TOTAL")).toEqual(buildSingle("float", 10));
    // The next run resets the outcomes to their defaults but not the supplied one.
    const later = played(engine, supplied.state, next(7), act("submit", "q", 8));
    expect(described(later.events)).toContain("outcome-processed T@8");
    expect(later.state.outcomes.get("CONTENT")).toEqual(buildSingle("float", 5));
    expect(later.state.outcomes.get("TOTAL")).toEqual(buildSingle("float", 10));
  });

  it("makes a request with no covers, at the end of the test, for an outcome that no block names", () => {
    const bare = engineOf(`${outcomes}${part("P", section("S", refs("w1", "w2")))}${rule}`, { items: plain });
    const first = played(bare, begun(bare).state, write("w1", "One", 1), act("submit", "w1", 2));
    expect(bare.pending(first.state).scoring).toEqual([]);
    const ended = played(bare, first.state, { type: "end-test", at: 3 });
    const [request] = bare.pending(ended.state).scoring;
    expect(request).toMatchObject({ id: "test:CONTENT", covers: [] });
  });

  it("takes the covers from the blocks only, never from the rules that use the outcome", () => {
    // The rule reads CONTENT and the sum reads every SCORE, but the block names one response only.
    const only = engineOf(
      `${outcomes}${covers("CONTENT", [["w2", "Task 2"]])}${part("P", section("S", refs("w1", "w2")))}${rule}`,
      { items: plain },
    );
    const ended = played(only, begun(only).state, { type: "end-test", at: 1 });
    const [request] = only.pending(ended.state).scoring;
    expect(request?.covers.map(({ item }) => item.ref)).toEqual(["w2"]);
  });

  it("resolves a cover to each instance that selection with replacement made, presented or not", () => {
    const repeated = engineOf(
      `${outcomes}${covers("CONTENT", [["w1", "Task 1"]])}${part("P", section("S", `<qti-selection select="2" with-replacement="true"/>${refs("w1")}`))}${rule}`,
      { items: plain },
    );
    const ended = played(repeated, begun(repeated).state, { type: "end-test", at: 1 });
    const [request] = repeated.pending(ended.state).scoring;
    expect(request?.covers.map(({ item, presented }) => [item, presented])).toEqual([
      [key("w1", 1), true],
      [key("w1", 2), false],
    ]);
  });

  it("gives the scorer the rubric, the items as the candidate saw them, and the answers", () => {
    const first = played(engine, begun(engine).state, write("w1", "First task", 1), act("submit", "w1", 2));
    const ended = played(engine, first.state, { type: "end-test", at: 3 });
    const view = engine.scorerView(ended.state, "test:CONTENT");
    expect(view.request.id).toBe("test:CONTENT");
    // The rubric of the test for the scorer: the covers block, whose notes the rater reads.
    expect(view.rubric.map((node) => node.kind)).toEqual(["p", "ul"]);
    expect(view.items.map(({ key: itemKey, title, presented }) => [itemKey.ref, title, presented])).toEqual([
      ["w1", "Item w1", true],
      ["w2", "Item w2", false],
    ]);
    const [shown, absent] = view.items;
    expect(shown?.responses).toEqual(new Map([["RESPONSE", buildSingle("string", "First task")]]));
    expect(shown?.correctResponses).toEqual(new Map([["RESPONSE", null]]));
    // The item's own rubric for the scorer follows the body as the candidate saw it.
    expect(shown?.body.map((node) => node.kind)).toEqual(["extended-text-interaction", "rubric-block"]);
    expect(absent).toMatchObject({ body: [], responses: new Map(), correctResponses: new Map() });
  });

  it("leaves the covers blocks of other outcomes out of the rubric of a request", () => {
    const two = engineOf(
      `${outcomes}${outcome("STYLE", "float", 'external-scored="human"')}${block}${covers("STYLE", [["w1", "Style"]])}${part("P", section("S", refs("w1", "w2")))}${rule}`,
      { items: plain },
    );
    const ended = played(two, begun(two).state, { type: "end-test", at: 1 });
    expect(two.scorerView(ended.state, "test:STYLE").rubric.map((node) => node.kind)).toEqual(["ul"]);
    expect(two.scorerView(ended.state, "test:CONTENT").rubric.map((node) => node.kind)).toEqual(["p", "ul"]);
    expect(() => two.scorerView(ended.state, "test:NOPE")).toThrow('The state has no scoring request "test:NOPE".');
  });
});

describe("the scoring rubric of a scoring request", () => {
  /** The levels of a criterion that `criterionMarkup` writes, with the scores given. */
  const levels = (...scores: number[]) => scores.map((score) => ({ score, description: `level ${score}` }));
  const holisticMarkup = (outcomeId: string, identifier = "overall"): string =>
    rubricMarkup(
      `<ol>${criterionMarkup(identifier, ["0", "1", "2"])}</ol>`,
      ` data-outcome-identifier="${outcomeId}" data-rubric-kind="holistic"`,
    );
  const holistic = (outcomeId: string, identifier = "overall"): ScoringRubric => ({
    outcomeIdentifier: outcomeId,
    kind: "holistic",
    criteria: [{ identifier, weight: 1, levels: levels(0, 1, 2) }],
  });
  const external = 'external-scored="human"';
  const kinds = (nodes: readonly { readonly kind: string }[]): string[] =>
    nodes.map((node) => node.kind).filter((kind) => kind !== "text");
  const traitDeclaration = `<qti-outcome-declaration identifier="TRAIT" cardinality="single" base-type="float" ${external}/>`;

  /** A test that rates its own outcome `SCORE` and two items that rate theirs, with the rubrics of both. */
  const collision = engineOf(
    `${outcome("SCORE", "float", external)}${outcome("TOTAL", "float")}${covers("SCORE", [["w1", "Task 1"]], "<p>Rate the test.</p>")}${holisticMarkup("SCORE", "whole")}${part("P", section("S", refs("w1", "w2")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
    {
      items: {
        w1: essay("w1", {
          declarations: traitDeclaration,
          body: `${holisticMarkup("SCORE", "item-score")}${holisticMarkup("TRAIT", "item-trait")}`,
          attributes: 'xml:lang="id"',
        }),
        w2: essay("w2", { body: holisticMarkup("SCORE", "other") }),
      },
    },
  );
  const submitted = played(collision, begun(collision).state, write("w1", "Text", 1), act("submit", "w1", 2));
  const ended = played(collision, submitted.state, { type: "end-test", at: 3 });

  it("gives the rubric of an item outcome from the item, in the language of the item", () => {
    const view = collision.scorerView(ended.state, "item:w1:1:SCORE");
    expect(view.scoringRubric).toEqual({ ...holistic("SCORE", "item-score"), language: "id" });
    expect(collision.scorerView(ended.state, "item:w1:1:TRAIT").scoringRubric).toEqual({
      ...holistic("TRAIT", "item-trait"),
      language: "id",
    });
  });

  it("gives the rubric of a test outcome from the test, whatever the items name", () => {
    const view = collision.scorerView(ended.state, "test:SCORE");
    expect(view.scoringRubric).toEqual(holistic("SCORE", "whole"));
    expect(kinds(view.rubric)).toEqual(["p", "ul", "ol"]);
  });

  it("leaves out of an item outcome the blocks of the test, even for an outcome of the same name", () => {
    const view = collision.scorerView(ended.state, "item:w1:1:SCORE");
    expect(view.rubric).toEqual([]);
    expect(collision.scorerView(ended.state, "item:w1:1:TRAIT").rubric).toEqual([]);
  });

  it("shows a scorer only the scoring rubric of the outcome in the body of an item", () => {
    const bodyOf = (request: string, ref = "w1") =>
      collision.scorerView(ended.state, request).items.find(({ key: itemKey }) => itemKey.ref === ref)?.body;
    // The interaction, the rubric of the item for scorers, and the rubric of the outcome.
    expect(kinds(bodyOf("item:w1:1:SCORE") ?? [])).toEqual([
      "extended-text-interaction",
      "rubric-block",
      "rubric-block",
    ]);
    expect(kinds(bodyOf("item:w1:1:TRAIT") ?? [])).toEqual([
      "extended-text-interaction",
      "rubric-block",
      "rubric-block",
    ]);
    expect(kinds(bodyOf("test:SCORE") ?? [])).toEqual(["extended-text-interaction", "rubric-block"]);
    expect(JSON.stringify(bodyOf("item:w1:1:SCORE"))).toContain("item-score");
    expect(JSON.stringify(bodyOf("item:w1:1:TRAIT"))).toContain("item-trait");
    expect(JSON.stringify(bodyOf("item:w1:1:SCORE"))).not.toContain("item-trait");
    expect(JSON.stringify(bodyOf("item:w1:1:TRAIT"))).not.toContain("item-score");
    expect(JSON.stringify(bodyOf("test:SCORE"))).not.toContain("item-");
  });

  it("gives the rubric of the test next to its covers, and leaves out those of other outcomes", () => {
    const outcomes = `${outcome("CONTENT", "float", external)}${outcome("STYLE", "float", external)}${outcome("TOTAL", "float")}`;
    const styled = ESSAY_MARKUP.replace('data-outcome-identifier="SCORE"', 'data-outcome-identifier="STYLE"');
    const content = ESSAY_MARKUP.replace('data-outcome-identifier="SCORE"', 'data-outcome-identifier="CONTENT"');
    const engine = engineOf(
      `${outcomes}${covers("CONTENT", [["w1", "Task 1"]])}${content}${covers("STYLE", [["w1", "Style"]])}${styled}${part("P", section("S", refs("w1")))}`,
      { items: { w1: essay("w1", { scorer: "none" }) } },
    );
    const state = played(engine, begun(engine).state, { type: "end-test", at: 1 }).state;
    const view = engine.scorerView(state, "test:CONTENT");
    expect(view.scoringRubric).toEqual({ ...ESSAY, outcomeIdentifier: "CONTENT" });
    expect(kinds(view.rubric)).toEqual(["ul", "p", "ol"]);
    expect(engine.scorerView(state, "test:STYLE").scoringRubric).toEqual({ ...ESSAY, outcomeIdentifier: "STYLE" });
  });

  it("reads the texts of an item after template processing, where the document gives the static text", () => {
    const topic = `<qti-template-declaration identifier="TOPIC" cardinality="single" base-type="string"><qti-default-value><qti-value>rivers</qti-value></qti-default-value></qti-template-declaration>`;
    const block = rubricMarkup(
      `<ol><li data-criterion-identifier="idea"><p>About <qti-printed-variable identifier="TOPIC"/></p><ol><li data-score="0">Off topic</li><li data-score="1">Writes about <qti-printed-variable identifier="TOPIC"/></li></ol></li></ol>`,
    );
    const authored = essay("w1", { declarations: topic, body: block });
    const engine = engineOf(`${outcome("TOTAL", "float")}${part("P", section("S", refs("w1")))}`, {
      items: { w1: authored },
    });
    const state = played(engine, begun(engine).state, write("w1", "Text", 1), act("submit", "w1", 2)).state;
    const [criterion] = engine.scorerView(state, "item:w1:1:SCORE").scoringRubric?.criteria ?? [];
    expect(criterion?.description).toBe("About rivers");
    expect(criterion?.levels.map(({ description }) => description)).toEqual(["Off topic", "Writes about rivers"]);
    const [written] = readScoringRubrics(authored).get("SCORE")?.criteria ?? [];
    expect(written?.description).toBe("About");
  });

  it("gives no rubric for an outcome without a block", () => {
    const engine = engineOf(`${outcome("TOTAL", "float")}${part("P", section("S", refs("w1")))}`, {
      items: { w1: essay("w1") },
    });
    const state = played(engine, begun(engine).state, act("submit", "w1", 1)).state;
    const view = engine.scorerView(state, "item:w1:1:SCORE");
    expect(view.scoringRubric).toBeUndefined();
    expect("scoringRubric" in view).toBe(false);
  });

  it("refuses to deliver an item whose first rubric block breaks the convention", () => {
    const broken = rubricMarkup("<ol/>", ' data-outcome-identifier="SCORE"');
    const engine = () =>
      engineOf(`${outcome("TOTAL", "float")}${part("P", section("S", refs("w1")))}`, {
        items: { w1: essay("w1", { body: `${broken}${holisticMarkup("SCORE")}` }) },
      });
    expect(engine).toThrow(/assesskit\/scoring-rubric\/malformed/);
  });

  it("does not take the class token of a test part or a section for a rubric", () => {
    const stray = holisticMarkup("CONTENT");
    const engine = engineOf(
      `${outcome("CONTENT", "float", external)}${outcome("TOTAL", "float")}${part("P", section("S", `<qti-rubric-block view="scorer" use="scoring" class="external-scoring-rubric" data-outcome-identifier="CONTENT"><qti-content-body><p>Stray</p></qti-content-body></qti-rubric-block>${refs("w1")}`), "linear", "individual", stray)}`,
      { items: { w1: essay("w1", { scorer: "none" }) } },
    );
    const state = played(engine, begun(engine).state, { type: "end-test", at: 1 }).state;
    expect(engine.scorerView(state, "test:CONTENT").scoringRubric).toBeUndefined();
  });

  it("keeps the candidate view free of the text of the rubric", () => {
    const view = collision.view(begun(collision).state, 0);
    const text = JSON.stringify(writeView(view));
    expect(text).not.toContain("item-score");
    expect(text).not.toContain("level 1");
  });
});

describe("items that a tool delivers", () => {
  const content = `${outcome("TOTAL", "float")}${part("P", section("S", refs("L1", "q")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`;
  const engine = engineOf(content, { items: { L1: linkResolution("L1") } });

  it("closes the session on submit and requests both SCORE and MAXSCORE, which the tool's grade supplies", () => {
    const submitted = played(engine, begun(engine).state, act("submit", "L1", 5));
    expect(described(submitted.events).filter((event) => event.startsWith("scoring"))).toEqual([
      "scoring-requested L1 item:L1:1:SCORE@5",
      "scoring-requested L1 item:L1:1:MAXSCORE@5",
    ]);
    const requests = engine.pending(submitted.state).scoring;
    expect(requests.map(({ outcome: name, mode, lti, covers: cover }) => [name, mode, lti, cover])).toEqual([
      ["SCORE", "externalMachine", true, []],
      ["MAXSCORE", "externalMachine", true, []],
    ]);
    expect(requests[0]?.declaration).toEqual({ cardinality: "single", baseType: "float" });
    const graded = played(
      engine,
      submitted.state,
      {
        type: "supply-scores",
        request: "item:L1:1:SCORE",
        value: buildSingle("float", 7),
        scorer: "externalMachine",
        at: 6,
      },
      {
        type: "supply-scores",
        request: "item:L1:1:MAXSCORE",
        value: buildSingle("float", 10),
        scorer: "externalMachine",
        at: 6,
      },
    );
    expect(graded.state.outcomes.get("TOTAL")).toEqual(buildSingle("float", 7));
    expect(engine.pending(graded.state).scoring).toEqual([]);
    const result = engine.results(graded.state).itemResults[0];
    expect(result).toMatchObject({ identifier: "L1", sessionStatus: "final" });
    const outcomesOf = result?.variables.flatMap((variable) =>
      variable.kind === "outcome" ? [[variable.identifier, variable.value, variable.externalScored]] : [],
    );
    expect(outcomesOf).toEqual([
      ["completionStatus", buildSingle("identifier", "unknown"), undefined],
      ["SCORE", buildSingle("float", 7), "externalMachine"],
      ["MAXSCORE", buildSingle("float", 10), "externalMachine"],
    ]);
  });

  it("gives the scorer the item of a link to a tool, which has no response to cover", () => {
    const submitted = played(engine, begun(engine).state, act("submit", "L1", 5));
    const view = engine.scorerView(submitted.state, "item:L1:1:SCORE");
    expect(
      view.items.map(({ key: itemKey, title, presented, responses }) => [
        itemKey.ref,
        title,
        presented,
        responses.size,
      ]),
    ).toEqual([["L1", "L1", true, 0]]);
  });

  it("requests both outcomes when the candidate leaves the item", () => {
    const left = played(engine, begun(engine).state, next(5));
    expect(left.state.current).toEqual(key("q"));
    expect(engine.pending(left.state).scoring.map(({ id }) => id)).toEqual(["item:L1:1:SCORE", "item:L1:1:MAXSCORE"]);
  });

  it("reports the item as pending external scoring until both values arrive", () => {
    const submitted = played(engine, begun(engine).state, act("submit", "L1", 5));
    const half = played(engine, submitted.state, {
      type: "supply-scores",
      request: "item:L1:1:SCORE",
      value: buildSingle("float", 7),
      scorer: "externalMachine",
      at: 6,
    });
    expect(engine.results(submitted.state).itemResults[0]?.sessionStatus).toBe("pendingExternalScoring");
    expect(engine.results(half.state).itemResults[0]?.sessionStatus).toBe("pendingExternalScoring");
  });
});

/** The datestamp of RFC 3339 `date-time` in UTC with milliseconds, which the JSON binding of CAT 1.0 declares. */
const RFC_3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

describe("adaptive sections", () => {
  const pool = refs("i1", "i2", "i3", "i4", "i5", "i6");
  const test = (mode: "linear" | "nonlinear" = "linear", head = ""): string =>
    `${outcome("TOTAL", "float")}${part("P", head + section("A", ADAPTIVE + pool), mode)}${processing(setOutcome("TOTAL", SUM_SCORES))}`;
  const engine = engineOf(test(), { cat: CAT_A });

  /** Answers the first request with a stage, then answers `ref` correctly and submits each of the items given. */
  function answered(items: readonly string[], stageLength?: number, at = 1): ReturnType<typeof played> {
    const start = begun(engine);
    const staged = played(
      engine,
      start.state,
      stage(engine, start.state, at, {
        itemIdentifiers: [...items],
        ...(stageLength === undefined ? {} : { stageLength }),
      }),
    );
    return staged;
  }

  it("waits for the first stage after Create Session, with no item presented", () => {
    const start = begun(engine);
    expect(start.state.current).toBeUndefined();
    expect(start.state.status).toBe("in-progress");
    expect(described(start.events)).toEqual(["cat-requested A create-session cat:A:1:1@0"]);
    expect(engine.pending(start.state)).toEqual({
      scoring: [],
      cat: [
        {
          id: "cat:A:1:1",
          kind: "create-session",
          section: "A",
          prefix: "https://cat.example/api",
          sectionIdentifier: "section-1",
          body: {},
        },
      ],
    });
    expect(engine.deadlines(start.state)).toEqual([]);
  });

  it("carries the PNP of the candidate in base64 in the Create Session request", () => {
    const pnp = pnpOf("<line-reader/>");
    const start = begun(engine, { pnp });
    const [request] = engine.pending(start.state).cat;
    // The document that writePnp writes, as UTF-8 bytes, in the base64 of RFC 4648.
    const expected = Buffer.from(writePnp(pnp), "utf8").toString("base64");
    expect(request).toMatchObject({ kind: "create-session", body: { personalNeedsAndPreferences: expected } });
    expect(Buffer.from(expected, "base64").toString("utf8")).toBe(writePnp(pnp));
  });

  it("appends the first stage in order and presents its first item", () => {
    const staged = answered(["i2", "i1", "i3"], 2);
    expect(described(staged.events)).toEqual([
      "cat-stage-added A i2 i1 i3@1",
      "section-entered A@1",
      "moved i2@1",
      "presented i2@1",
    ]);
    expect(staged.state.current).toEqual(key("i2"));
    expect(staged.state.plan.parts[0]?.children[0]?.children).toEqual([
      { kind: "item", key: key("i2") },
      { kind: "item", key: key("i1") },
      { kind: "item", key: key("i3") },
    ]);
    expect(engine.pending(staged.state).cat).toEqual([]);
  });

  it("sends the results when the first stageLength items are submitted, and drops the rest of the stage", () => {
    const staged = answered(["i1", "i2", "i3"], 2);
    const first = played(engine, staged.state, pick("i1", "B", 2), act("submit", "i1", 3), next(4));
    expect(engine.pending(first.state).cat).toEqual([]);
    const second = played(engine, first.state, pick("i2", "A", 5), act("submit", "i2", 6));
    expect(described(second.events).at(-1)).toBe("cat-requested A submit-results cat:A:1:2@6");
    const request = waiting(engine, second.state);
    expect(request).toMatchObject({ kind: "submit-results", sessionIdentifier: "session-1", id: "cat:A:1:2" });
    // The candidate waits: the next item depends on the answer.
    expect(refusalOf(engine, second.state, next(7)).reason).toBe("awaiting-cat");
    const answeredStage = played(
      engine,
      second.state,
      stage(engine, second.state, 8, { itemIdentifiers: ["i4"], stageLength: 1 }),
    );
    // i3 was never presented, so the new stage replaces it; i4 is added at the end.
    expect(
      answeredStage.state.plan.parts[0]?.children[0]?.children.map((child) =>
        child.kind === "item" ? child.key.ref : "?",
      ),
    ).toEqual(["i1", "i2", "i4"]);
    const onwards = played(engine, answeredStage.state, next(9));
    expect(onwards.state.current).toEqual(key("i4"));
  });

  it("sends the state of a stateless engine back and clears it when the engine sends none", () => {
    const staged = answered(["i1"], 1);
    const submitted = played(engine, staged.state, pick("i1", "B", 2), act("submit", "i1", 3));
    const withState = played(
      engine,
      submitted.state,
      stage(engine, submitted.state, 4, { itemIdentifiers: ["i2"], stageLength: 1 }, { sessionState: "opaque-1" }),
    );
    const second = played(engine, withState.state, next(5), pick("i2", "B", 6), act("submit", "i2", 7));
    expect(waiting(engine, second.state)).toMatchObject({ kind: "submit-results", sessionState: "opaque-1" });
    const without = played(
      engine,
      second.state,
      stage(engine, second.state, 8, { itemIdentifiers: ["i3"], stageLength: 1 }),
    );
    const third = played(engine, without.state, next(9), pick("i3", "B", 10), act("submit", "i3", 11));
    expect(waiting(engine, third.state)).not.toHaveProperty("sessionState");
  });

  it("reports each presented item with its score, duration, attempts and completion, and nothing for those not presented", () => {
    const staged = answered(["i1", "i2", "i3"], 2);
    const done = played(
      engine,
      staged.state,
      pick("i1", "B", 4),
      act("submit", "i1", 5),
      next(6),
      pick("i2", "A", 10),
      act("submit", "i2", 12),
    );
    const request = waiting(engine, done.state);
    if (request.kind !== "submit-results") fail("A Submit Results request was expected.");
    const { assessmentResult } = request;
    expect(assessmentResult.context).toEqual({ sessionIdentifiers: [] });
    expect(assessmentResult.itemResults.map(({ identifier, sequenceIndex }) => [identifier, sequenceIndex])).toEqual([
      ["i1", 1],
      ["i2", 2],
    ]);
    const [first, second] = assessmentResult.itemResults;
    expect(first?.sessionStatus).toBe("final");
    // Items 1 and 2 were shown at 1, 6; the datestamp is the time of the last event.
    expect(first?.datestamp).toBe(new Date(5).toISOString());
    expect(second?.datestamp).toBe(new Date(12).toISOString());
    expect(first?.datestamp).toMatch(RFC_3339);
    const variableOf = (result: typeof first, id: string): unknown =>
      result?.variables.flatMap((variable) =>
        variable.identifier === id
          ? [variable.kind === "response" ? variable.candidateResponse : (variable as { value?: unknown }).value]
          : [],
      )[0];
    expect(variableOf(first, "SCORE")).toEqual(buildSingle("float", 1));
    expect(variableOf(second, "SCORE")).toEqual(buildSingle("float", 0));
    expect(variableOf(first, "numAttempts")).toEqual(buildSingle("integer", 1));
    expect(variableOf(first, "duration")).toEqual(buildSingle("duration", 0.004));
    expect(variableOf(second, "duration")).toEqual(buildSingle("duration", 0.006));
    expect(variableOf(first, "completionStatus")).toEqual(buildSingle("identifier", "unknown"));
    expect(assessmentResult.testResult?.datestamp).toBe(new Date(12).toISOString());
  });

  it("reports an item the candidate skipped as initial, without a response or a SCORE, at the time of the skip", () => {
    const staged = answered(["i1", "i2"], 2);
    const done = played(
      engine,
      staged.state,
      act("skip", "i1", 4),
      next(5),
      pick("i2", "B", 6),
      act("submit", "i2", 7),
    );
    const request = waiting(engine, done.state);
    if (request.kind !== "submit-results") fail("A Submit Results request was expected.");
    const [skipped, answeredItem] = request.assessmentResult.itemResults;
    expect(skipped).toMatchObject({
      identifier: "i1",
      sequenceIndex: 1,
      sessionStatus: "initial",
      datestamp: new Date(4).toISOString(),
    });
    expect(skipped?.variables.map(({ identifier }) => identifier)).toEqual([
      "numAttempts",
      "duration",
      "completionStatus",
    ]);
    expect(answeredItem?.variables.map(({ identifier }) => identifier)).toEqual([
      "numAttempts",
      "duration",
      "RESPONSE",
      "completionStatus",
      "SCORE",
    ]);
  });

  it("instances an item that the engine calls again, and names the instances i.1, i.2 to the engine", () => {
    const staged = answered(["i1", "i1"], 2);
    expect(staged.state.plan.parts[0]?.children[0]?.children).toEqual([
      { kind: "item", key: key("i1", 1) },
      { kind: "item", key: key("i1", 2) },
    ]);
    const done = played(
      engine,
      staged.state,
      pick("i1", "B", 2),
      act("submit", "i1", 3),
      next(4),
      pick("i1", "A", 5, 2),
      act("submit", "i1", 6, 2),
    );
    const request = waiting(engine, done.state);
    if (request.kind !== "submit-results") fail("A Submit Results request was expected.");
    expect(request.assessmentResult.itemResults.map(({ identifier }) => identifier)).toEqual(["i1.1", "i1.2"]);
  });

  it("shows the part and no item while the first stage is awaited, with only the actions that can be taken", () => {
    const start = begun(engine);
    const view = engine.view(start.state, 5);
    expect(view).toMatchObject({
      status: "in-progress",
      part: { identifier: "P", navigationMode: "linear", submissionMode: "individual" },
      navigation: [],
      timers: [],
      actions: ["end-part", "end-test", "suspend"],
    });
    expect(view.current).toBeUndefined();
    expect(readView(writeView(view))).toEqual(view);
    const suspended = played(engine, start.state, { type: "suspend", at: 1 });
    expect(engine.view(suspended.state, 2)).toMatchObject({ status: "suspended", actions: ["resume"] });
    const staged = played(
      engine,
      start.state,
      stage(engine, start.state, 1, { itemIdentifiers: ["i1"], stageLength: 1 }),
    );
    expect(engine.view(staged.state, 2).current?.key).toEqual(key("i1"));
  });

  it("ends the section when the answer has no items, and the test with it", () => {
    const staged = answered(["i1"], 1);
    const submitted = played(engine, staged.state, pick("i1", "B", 2), act("submit", "i1", 3));
    const ended = played(engine, submitted.state, stage(engine, submitted.state, 4, null));
    expect(ended.state.cat[0]).toMatchObject({ status: "ended", stage: [] });
    const over = played(engine, ended.state, next(5));
    expect(described(over.events)).toEqual(["part-ended P@5", "test-ended T@5"]);
    expect(over.state.status).toBe("ended");
    expect(engine.pending(over.state).cat).toEqual([]);
  });

  it("moves on at once to the next stage when the candidate asked to move before the engine answered", () => {
    const staged = answered(["i1", "i2"], 2);
    const two = played(engine, staged.state, pick("i1", "B", 2), act("submit", "i1", 3), next(4), pick("i2", "B", 5));
    // The move submits i2, the policy sends the results, and the candidate waits where the move was asked.
    const moved = played(engine, two.state, next(6));
    expect(moved.state.current).toEqual(key("i2"));
    expect(described(moved.events).at(-1)).toBe("cat-requested A submit-results cat:A:1:2@6");
    const answeredMove = played(
      engine,
      moved.state,
      stage(engine, moved.state, 7, { itemIdentifiers: ["i3"], stageLength: 1 }),
    );
    expect(answeredMove.state.current).toEqual(key("i3"));
    expect(described(answeredMove.events)).toEqual(["cat-stage-added A i3@7", "moved i3@7", "presented i3@7"]);
  });
});

describe("adaptive sections in nonlinear parts and at the end", () => {
  const pool = refs("i1", "i2", "i3", "i4", "i5", "i6");
  const test = (mode: "linear" | "nonlinear" = "linear", head = ""): string =>
    `${outcome("TOTAL", "float")}${part("P", section("A", ADAPTIVE + pool), mode, "individual", head)}${processing(setOutcome("TOTAL", SUM_SCORES))}`;
  const idsOf = (request: ReturnType<typeof waiting>): string[] =>
    request.kind === "submit-results" ? request.assessmentResult.itemResults.map(({ identifier }) => identifier) : [];

  it("sends an earlier item again in a later Submit Results when a further attempt changed its result", () => {
    const loose = engineOf(test("nonlinear", '<qti-item-session-control max-attempts="0"/>'), { cat: CAT_A });
    const start = begun(loose);
    const staged = played(
      loose,
      start.state,
      stage(loose, start.state, 1, { itemIdentifiers: ["i1", "i2"], stageLength: 2 }),
    );
    const two = played(
      loose,
      staged.state,
      pick("i1", "B", 2),
      act("submit", "i1", 3),
      next(4),
      pick("i2", "A", 5),
      act("submit", "i2", 6),
    );
    expect(idsOf(waiting(loose, two.state))).toEqual(["i1", "i2"]);
    const third = played(loose, two.state, stage(loose, two.state, 7, { itemIdentifiers: ["i3"], stageLength: 1 }));
    // The candidate goes back to the first item, answers it again, and goes to the new item.
    const again = played(
      loose,
      third.state,
      { type: "move", to: key("i1"), at: 8 },
      { type: "next-attempt", item: key("i1"), at: 9 },
      pick("i1", "A", 10),
      act("submit", "i1", 11),
      { type: "move", to: key("i3"), at: 12 },
      pick("i3", "B", 13),
      act("submit", "i3", 14),
    );
    const request = waiting(loose, again.state);
    expect(idsOf(request)).toEqual(["i1", "i3"]);
    if (request.kind !== "submit-results") fail("A Submit Results request was expected.");
    // The item sent again reports its second attempt.
    const attemptsOf = request.assessmentResult.itemResults[0]?.variables.find(
      ({ identifier }) => identifier === "numAttempts",
    );
    expect(attemptsOf).toMatchObject({ candidateResponse: buildSingle("integer", 2) });
    expect(request.assessmentResult.itemResults.map(({ sequenceIndex }) => sequenceIndex)).toEqual([1, 3]);
  });

  it("sends the results not yet reported and then ends the session when the candidate ends the test", () => {
    const engine = engineOf(test(), { cat: CAT_A });
    const start = begun(engine);
    const staged = played(
      engine,
      start.state,
      stage(engine, start.state, 1, { itemIdentifiers: ["i1", "i2"], stageLength: 2 }),
    );
    const one = played(engine, staged.state, pick("i1", "B", 2), act("submit", "i1", 3));
    const ended = played(engine, one.state, { type: "end-test", at: 4 });
    expect(described(ended.events).filter((event) => event.startsWith("cat"))).toEqual([
      "cat-requested A submit-results cat:A:1:2@4",
    ]);
    // The item of the stage that was never presented leaves the plan.
    expect(ended.state.plan.parts[0]?.children[0]?.children).toEqual([{ kind: "item", key: key("i1") }]);
    const last = waiting(engine, ended.state);
    expect(idsOf(last)).toEqual(["i1"]);
    // The engine answers with a stage the candidate will never see: End Session follows.
    const aborted = played(
      engine,
      ended.state,
      stage(engine, ended.state, 5, { itemIdentifiers: ["i3"], stageLength: 1 }),
    );
    expect(described(aborted.events)).toEqual(["cat-requested A end-session cat:A:1:3@5"]);
    expect(waiting(engine, aborted.state)).toMatchObject({ kind: "end-session", sessionIdentifier: "session-1" });
    const over = played(engine, aborted.state, {
      type: "cat-response",
      request: "cat:A:1:3",
      response: { ended: true },
      at: 6,
    });
    expect(over.state.cat[0]?.status).toBe("ended");
    expect(engine.pending(over.state).cat).toEqual([]);
    expect(over.state.status).toBe("ended");
  });

  it("ends the session at once when every result was reported, and not at all when the engine ended it", () => {
    const engine = engineOf(test(), { cat: CAT_A });
    const start = begun(engine);
    const staged = played(
      engine,
      start.state,
      stage(engine, start.state, 1, { itemIdentifiers: ["i1"], stageLength: 1 }),
    );
    const reported = played(engine, staged.state, pick("i1", "B", 2), act("submit", "i1", 3));
    const withNext = played(
      engine,
      reported.state,
      stage(engine, reported.state, 4, { itemIdentifiers: ["i2"], stageLength: 1 }),
    );
    const ended = played(engine, withNext.state, { type: "end-test", at: 5 });
    expect(waiting(engine, ended.state)).toMatchObject({ kind: "end-session" });
    // When the engine ends the session by its answer to the last results, nothing more is sent.
    const finished = played(engine, reported.state, stage(engine, reported.state, 4, null));
    const over = played(engine, finished.state, { type: "end-test", at: 5 });
    expect(engine.pending(over.state).cat).toEqual([]);
  });

  it("ends a session whose answer arrives after the candidate left, and accepts the answer after the test ended", () => {
    const engine = engineOf(test(), { cat: CAT_A });
    const start = begun(engine);
    const ended = played(engine, start.state, { type: "end-test", at: 1 });
    expect(ended.state.status).toBe("ended");
    expect(waiting(engine, ended.state)).toMatchObject({ kind: "create-session" });
    const answered = played(
      engine,
      ended.state,
      stage(engine, ended.state, 2, { itemIdentifiers: ["i1"], stageLength: 1 }),
    );
    expect(waiting(engine, answered.state)).toMatchObject({ kind: "end-session", sessionIdentifier: "session-1" });
    expect(answered.state.plan.parts[0]?.children[0]?.children).toEqual([]);
  });

  it("refuses what waits for the CAT engine, and a stage with an item the section does not list", () => {
    const engine = engineOf(test(), { cat: CAT_A });
    const start = begun(engine);
    expect(refusalOf(engine, start.state, next(1)).reason).toBe("awaiting-cat");
    expect(refusalOf(engine, start.state, pick("i1", "B", 1)).reason).toBe("awaiting-cat");
    expect(
      refusalOf(engine, start.state, { type: "cat-response", request: "cat:A:1:9", response: { ended: true }, at: 1 })
        .reason,
    ).toBe("unknown-request");
    const stranger = stage(engine, start.state, 1, { itemIdentifiers: ["i1", "nope"], stageLength: 2 });
    expect(refusalOf(engine, start.state, stranger).reason).toBe("unknown-item");
    expect(
      refusalOf(engine, start.state, { type: "cat-response", request: "cat:A:1:1", response: { ended: true }, at: 1 })
        .reason,
    ).toBe("invalid-response");
    expect(
      refusalOf(engine, start.state, {
        type: "cat-response",
        request: "cat:A:1:1",
        response: { nextItems: { itemIdentifiers: ["i1"] } },
        at: 1,
      }).reason,
    ).toBe("invalid-response");
    // A candidate who waits can still turn a support on, suspend and end the test.
    expect(
      played(engine, start.state, { type: "suspend", at: 1 }, { type: "resume", at: 2 }).state.current,
    ).toBeUndefined();
  });

  it("refuses a stage that would make the plan hold more sections and items than maxPlanNodes allows", () => {
    const limited = engineOf(test(), { cat: CAT_A, options: { limits: { maxPlanNodes: 3 } } });
    const start = begun(limited);
    const tooMany = stage(limited, start.state, 1, { itemIdentifiers: ["i1", "i2", "i3"], stageLength: 3 });
    const refusal = refusalOf(limited, start.state, tooMany);
    expect(refusal.reason).toBe("invalid-response");
    expect(refusal.message).toContain("maxPlanNodes");
    const fits = stage(limited, start.state, 1, { itemIdentifiers: ["i1", "i2"], stageLength: 2 });
    expect(played(limited, start.state, fits).state.current).toEqual(key("i1"));
  });

  it("presents the first item when the answer comes while the session is suspended and the candidate resumes", () => {
    const engine = engineOf(test(), { cat: CAT_A });
    const start = begun(engine);
    const suspended = played(engine, start.state, { type: "suspend", at: 1 });
    const staged = played(
      engine,
      suspended.state,
      stage(engine, suspended.state, 2, { itemIdentifiers: ["i1"], stageLength: 1 }),
    );
    expect(staged.state.current).toBeUndefined();
    const resumed = played(engine, staged.state, { type: "resume", at: 3 });
    expect(resumed.state.current).toEqual(key("i1"));
  });

  it("ignores pre-conditions and branch rules on the items of an adaptive section, and branch rules that target them", () => {
    const never = '<qti-pre-condition><qti-base-value base-type="boolean">false</qti-base-value></qti-pre-condition>';
    const exit =
      '<qti-branch-rule target="EXIT_TEST"><qti-base-value base-type="boolean">true</qti-base-value></qti-branch-rule>';
    const jump =
      '<qti-branch-rule target="i3"><qti-base-value base-type="boolean">true</qti-base-value></qti-branch-rule>';
    const items = `<qti-assessment-item-ref identifier="i1" href="i1">${never}${exit}</qti-assessment-item-ref>${refs("i2", "i3")}`;
    const engine = engineOf(
      `${outcome("TOTAL", "float")}${part("P", `${section("B", `<qti-assessment-item-ref identifier="b1" href="b1">${jump}</qti-assessment-item-ref>`)}${section("A", ADAPTIVE + items)}`)}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
      { cat: CAT_A },
    );
    const first = played(engine, begun(engine).state, pick("b1", "B", 1), act("submit", "b1", 2));
    // The branch rule of b1 targets i3 of the adaptive section: it is ignored, and the walk enters the section.
    const entered = played(engine, first.state, next(3));
    expect(described(entered.events).at(-1)).toBe("cat-requested A create-session cat:A:1:1@3");
    const staged = played(
      engine,
      entered.state,
      stage(engine, entered.state, 4, { itemIdentifiers: ["i1", "i2"], stageLength: 2 }),
    );
    // i1 has a false pre-condition and a branch rule to the end of the test: both are ignored in an adaptive section.
    expect(staged.state.current).toEqual(key("i1"));
    const second = played(engine, staged.state, pick("i1", "B", 5), act("submit", "i1", 6), next(7));
    expect(second.state.current).toEqual(key("i2"));
  });

  it("still applies the pre-conditions of the adaptive section itself", () => {
    const skip = '<qti-pre-condition><qti-base-value base-type="boolean">false</qti-base-value></qti-pre-condition>';
    const engine = engineOf(
      `${outcome("TOTAL", "float")}${part("P", section("A", skip + ADAPTIVE + pool) + section("S", refs("s1")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
      { cat: CAT_A },
    );
    const start = begun(engine);
    expect(start.state.current).toEqual(key("s1"));
    expect(start.state.cat).toEqual([]);
  });
});

describe("adaptive sections that end at once", () => {
  const content = `${outcome("TOTAL", "float")}${part("P", section("A", ADAPTIVE + refs("i1")) + section("S", refs("s1")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`;
  const engine = engineOf(content, { cat: CAT_A });

  it("goes on to the next section when the engine answers Create Session with no item", () => {
    const start = begun(engine);
    expect(start.state.current).toBeUndefined();
    const ended = played(engine, start.state, stage(engine, start.state, 1, null));
    expect(ended.state.cat[0]).toMatchObject({ status: "ended", stage: [] });
    expect(ended.state.current).toEqual(key("s1"));
    expect(engine.pending(ended.state).cat).toEqual([]);
  });

  it("ends the part from where the first stage is awaited, and goes on to the next part", () => {
    const two = engineOf(
      `${outcome("TOTAL", "float")}${part("P", section("A", ADAPTIVE + refs("i1")))}${part("Q", section("S", refs("s1")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
      { cat: CAT_A },
    );
    const start = begun(two);
    const left = played(two, start.state, { type: "end-part", at: 1 });
    expect(left.state.current).toEqual(key("s1"));
    expect(described(left.events)).toEqual(["part-ended P@1", "section-entered S@1", "moved s1@1", "presented s1@1"]);
    // The engine has yet to answer Create Session; the session it creates is ended at once.
    expect(waiting(two, left.state)).toMatchObject({ kind: "create-session" });
    const answered = played(two, left.state, stage(two, left.state, 2, { itemIdentifiers: ["i1"], stageLength: 1 }));
    expect(waiting(two, answered.state)).toMatchObject({ kind: "end-session", sessionIdentifier: "session-1" });
    expect(answered.state.current).toEqual(key("s1"));
  });
});

describe("time limits in adaptive sections", () => {
  const limited = section("A", `<qti-time-limits max-time="10"/>${ADAPTIVE}${refs("i1", "i2", "i3")}`);
  const engine = engineOf(
    `${outcome("TOTAL", "float")}${part("P", limited + section("S", refs("s1")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
    {
      cat: CAT_A,
    },
  );

  it("closes the open attempt at the maximum time of the section, sends the results and goes on to the next section", () => {
    const start = begun(engine);
    // Time does not run while the first stage is awaited, so the deadline starts with the first item.
    expect(engine.deadlines(start.state)).toEqual([]);
    const staged = played(
      engine,
      start.state,
      stage(engine, start.state, 1000, { itemIdentifiers: ["i1", "i2"], stageLength: 2 }),
    );
    expect(engine.deadlines(staged.state)).toEqual([
      { scope: "section", identifier: "A", kind: "max-time", at: 11_000, lateSubmission: false },
    ]);
    const answered = played(
      engine,
      staged.state,
      pick("i1", "B", 2000),
      act("submit", "i1", 3000),
      next(4000),
      pick("i2", "B", 5000),
    );
    const late = played(engine, answered.state, { type: "time", at: 11_000 });
    expect(described(late.events)).toEqual([
      "time-out A@11000",
      "attempt-ended i2 close@11000",
      "response-processed i2@11000",
      "outcome-processed T@11000",
      "cat-requested A submit-results cat:A:1:2@11000",
      "section-entered S@11000",
      "moved s1@11000",
      "presented s1@11000",
    ]);
    expect(late.state.current).toEqual(key("s1"));
    const request = waiting(engine, late.state);
    if (request.kind !== "submit-results") fail("A Submit Results request was expected.");
    expect(request.assessmentResult.itemResults.map(({ identifier }) => identifier)).toEqual(["i1", "i2"]);
    const ended = played(
      engine,
      late.state,
      stage(engine, late.state, 11_001, { itemIdentifiers: ["i3"], stageLength: 1 }),
    );
    // The candidate left the section: the stage that comes is ignored, and the engine is told that the session ends.
    expect(waiting(engine, ended.state)).toMatchObject({ kind: "end-session" });
    expect(ended.state.current).toEqual(key("s1"));
  });
});

describe("outcomes that a CAT engine reports", () => {
  const outcomes = `${outcome("TOTAL", "float")}${outcome("LEVEL", "float", 'external-scored="externalMachine"')}${outcome("PLAIN", "float")}`;
  const test = `${outcomes}${part("P", section("A", ADAPTIVE + refs("i1", "i2", "i3")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`;
  const engine = engineOf(test, { cat: CAT_A });
  const reported = (name: string, value: number) =>
    ({
      kind: "outcome",
      identifier: name,
      cardinality: "single",
      baseType: "float",
      value: buildSingle("float", value),
    }) as const;
  const report = (
    variables: ReturnType<typeof reported>[],
    items: AssessmentResult["itemResults"] = [],
  ): AssessmentResult => ({
    context: { sessionIdentifiers: [{ sourceId: "https://cat.example", identifier: "run-7" }] },
    testResult: { identifier: "T", datestamp: "2026-10-30T12:00:00Z", variables, supports: [] },
    itemResults: items,
  });
  const submitted = () => {
    const start = begun(engine);
    const staged = played(
      engine,
      start.state,
      stage(engine, start.state, 1, { itemIdentifiers: ["i1", "i2"], stageLength: 1 }),
    );
    return played(engine, staged.state, pick("i1", "B", 2), act("submit", "i1", 3));
  };

  it("merges the outcomes into the declaration that takes them, keeps the others, and ignores the rest", () => {
    const itemResult = {
      identifier: "i1",
      datestamp: "2026-10-30T12:00:00Z",
      sessionStatus: "final",
      supports: [],
      variables: [reported("PROB", 0.25), reported("SCORE", 5)],
    } as const;
    const first = submitted();
    const merged = played(
      engine,
      first.state,
      stage(
        engine,
        first.state,
        4,
        { itemIdentifiers: ["i2"], stageLength: 1 },
        {
          assessmentResult: report([reported("LEVEL", 2), reported("PLAIN", 9), reported("THETA", 0.5)], [itemResult]),
        },
      ),
    );
    // LEVEL is declared external-scored by a machine and takes the value; PLAIN is declared without it and does not.
    expect(merged.state.outcomes.get("LEVEL")).toEqual(buildSingle("float", 2));
    expect(merged.state.outcomes.get("PLAIN")).toEqual(buildSingle("float", 0));
    // SCORE of the item is declared without external scoring: the engine's value is ignored.
    expect(merged.state.items[0]?.session.variables.outcomes.get("SCORE")).toEqual(buildSingle("float", 1));
    expect(merged.state.report.sessionIdentifiers).toEqual([{ sourceId: "https://cat.example", identifier: "run-7" }]);
    // The reset of outcome processing does not erase the value.
    const later = played(engine, merged.state, next(5), pick("i2", "B", 6), act("submit", "i2", 7));
    expect(later.state.outcomes.get("LEVEL")).toEqual(buildSingle("float", 2));
    const results = engine.results(later.state);
    const testVariables = results.testResult?.variables.flatMap((variable) =>
      variable.kind === "outcome" ? [[variable.identifier, variable.value, variable.externalScored]] : [],
    );
    expect(testVariables).toEqual([
      ["TOTAL", buildSingle("float", 2), undefined],
      ["LEVEL", buildSingle("float", 2), "externalMachine"],
      ["PLAIN", buildSingle("float", 0), undefined],
      ["THETA", buildSingle("float", 0.5), "externalMachine"],
    ]);
    const firstItem = results.itemResults[0]?.variables.flatMap((variable) =>
      variable.kind === "outcome" ? [[variable.identifier, variable.value, variable.externalScored]] : [],
    );
    expect(firstItem).toEqual([
      ["completionStatus", buildSingle("identifier", "unknown"), undefined],
      ["SCORE", buildSingle("float", 1), undefined],
      ["PROB", buildSingle("float", 0.25), "externalMachine"],
    ]);
    expect(results.context.sessionIdentifiers).toEqual([{ sourceId: "https://cat.example", identifier: "run-7" }]);
  });

  it("does not let the engine of a later adaptive section overwrite an outcome that another set", () => {
    const two = engineOf(
      `${outcomes}${part("P", section("A", ADAPTIVE + refs("a1")) + section("B", ADAPTIVE + refs("b1")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
      {
        cat: new Map([
          ["A", { prefix: "https://cat.example/a", sectionIdentifier: "section-a" }],
          ["B", { prefix: "https://cat.example/b", sectionIdentifier: "section-b" }],
        ]),
      },
    );
    const start = begun(two);
    const stagedA = played(two, start.state, stage(two, start.state, 1, { itemIdentifiers: ["a1"], stageLength: 1 }));
    const doneA = played(two, stagedA.state, pick("a1", "B", 2), act("submit", "a1", 3));
    const endedA = played(
      two,
      doneA.state,
      stage(two, doneA.state, 4, null, { assessmentResult: report([reported("THETA", 0.5), reported("LEVEL", 1)]) }),
    );
    const enteredB = played(two, endedA.state, next(5));
    expect(waiting(two, enteredB.state)).toMatchObject({
      kind: "create-session",
      section: "B",
      prefix: "https://cat.example/b",
    });
    const stagedB = played(
      two,
      enteredB.state,
      stage(two, enteredB.state, 6, { itemIdentifiers: ["b1"], stageLength: 1 }),
    );
    const doneB = played(two, stagedB.state, pick("b1", "B", 7), act("submit", "b1", 8));
    const endedB = played(
      two,
      doneB.state,
      stage(two, doneB.state, 9, null, {
        assessmentResult: report([reported("THETA", 9), reported("OTHER", 3), reported("LEVEL", 8)]),
      }),
    );
    const names = two
      .results(endedB.state)
      .testResult?.variables.flatMap((variable) =>
        variable.kind === "outcome" && variable.externalScored === "externalMachine"
          ? [[variable.identifier, variable.value]]
          : [],
      );
    expect(names).toEqual([
      ["LEVEL", buildSingle("float", 1)],
      ["THETA", buildSingle("float", 0.5)],
      ["OTHER", buildSingle("float", 3)],
    ]);
  });
});

describe("the state with pending work", () => {
  const outcomes = `${outcome("TOTAL", "float")}${outcome("LEVEL", "float", 'external-scored="externalMachine"')}`;
  const engine = engineOf(
    `${outcomes}${part("P", section("A", ADAPTIVE + refs("i1", "i2", "i3")), "linear")}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
    { cat: CAT_A },
  );
  const level = {
    kind: "outcome",
    identifier: "LEVEL",
    cardinality: "single",
    baseType: "float",
    value: buildSingle("float", 2),
  } as const;
  /** A state with a session that has a stage, reported items, an outcome and a request that waits for a candidate who asked to move on. */
  const busy = (): DeliveryState => {
    const start = begun(engine, { pnp: pnpOf("<line-reader/>") });
    const staged = played(
      engine,
      start.state,
      stage(engine, start.state, 1, { itemIdentifiers: ["i1", "i2"], stageLength: 1 }),
    );
    const submitted = played(engine, staged.state, pick("i1", "B", 2), act("submit", "i1", 3));
    const merged = played(
      engine,
      submitted.state,
      stage(
        engine,
        submitted.state,
        4,
        { itemIdentifiers: ["i3"], stageLength: 1 },
        {
          sessionState: "opaque",
          assessmentResult: {
            context: { sessionIdentifiers: [] },
            testResult: { identifier: "T", datestamp: "2026-10-30T12:00:00Z", supports: [], variables: [level] },
            itemResults: [],
          },
        },
      ),
    );
    return played(engine, merged.state, next(5), pick("i3", "A", 6), next(7)).state;
  };
  const firstSession = (json: Record<string, unknown>): Record<string, unknown> =>
    (json.cat as Record<string, unknown>[])[0] ?? fail("The state has no CAT session.");
  const damaged = (change: (json: Record<string, unknown>) => void): (() => unknown) => {
    const json = JSON.parse(serializeState(busy()));
    change(json);
    return () => deserializeState(JSON.stringify(json));
  };

  it("keeps the sessions of adaptive sections, their stage, reports and outcomes, through serialization", () => {
    const state = busy();
    expect(state.cat[0]).toMatchObject({ sessionState: "opaque", outcomes: [{ identifier: "LEVEL", declared: true }] });
    expect(state.needs.personalNeeds).toBeTypeOf("string");
    expect(deserializeState(serializeState(state))).toEqual(state);
  });

  it("refuses a state whose pending work is not in the format", () => {
    expect(damaged((json) => (json.scoring = JSON.parse("{}")))).toThrow(
      "The state is invalid at scoring: expected an array, found an object.",
    );
    expect(damaged((json) => (json.cat = JSON.parse('[{"section":"A"}]')))).toThrow(
      'The state is invalid at cat[0]: missing the property "instance".',
    );
    expect(damaged((json) => (firstSession(json).status = "gone"))).toThrow(
      'The state is invalid at cat[0].status: expected "running", "leaving" or "ended", found "gone".',
    );
    expect(damaged((json) => (json.report = JSON.parse("null")))).toThrow(
      "The state is invalid at report: expected an object, found null.",
    );
    expect(damaged((json) => ((json.needs as { personalNeeds: unknown }).personalNeeds = 5))).toThrow(
      "The state is invalid at needs.personalNeeds: expected a string, found 5.",
    );
    expect(damaged((json) => (firstSession(json).moving = false))).toThrow(
      "The state is invalid at cat[0].moving: expected true, found false.",
    );
  });
});

/** A promise that the test settles itself, to hold a request of a port in flight. */
function unsettled<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  const handles: { resolve?: (value: T) => void; reject?: (reason: unknown) => void } = {};
  const promise = new Promise<T>((resolve, reject) => {
    handles.resolve = resolve;
    handles.reject = reject;
  });
  return { promise, resolve: (value) => handles.resolve?.(value), reject: (reason) => handles.reject?.(reason) };
}

describe("sendCatRequest", () => {
  const pool = refs("i1", "i2", "i3");
  const engine = engineOf(
    `${outcome("TOTAL", "float")}${part("P", section("A", ADAPTIVE + pool))}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
    { cat: CAT_A },
  );
  /** The session after Create Session, with two items presented and the first answered. */
  const presented = (): DeliveryState => {
    const start = begun(engine).state;
    const first = played(engine, start, stage(engine, start, 1, { itemIdentifiers: ["i1", "i2"], stageLength: 2 }));
    return played(engine, first.state, pick("i1", "B", 2), act("submit", "i1", 3)).state;
  };

  it("makes the request of each kind through the method of the port that it needs", async () => {
    const port = fakePort([["i3"]], ["i1", "i2"]);
    const start = begun(engine).state;
    const created = await sendCatRequest(port, waiting(engine, start));
    expect(created).toEqual({
      sessionIdentifier: "session-1",
      nextItems: { itemIdentifiers: ["i1", "i2"], stageLength: 2 },
    });
    expect(port.calls).toEqual([{ method: "createSession", section: "section-1", request: {} }]);
    const left = played(engine, presented(), { type: "end-test", at: 4 }).state;
    const submitted = await sendCatRequest(port, waiting(engine, left));
    expect(submitted).toEqual({ nextItems: { itemIdentifiers: ["i3"], stageLength: 1 } });
    const submit = port.calls[1];
    if (submit?.method !== "submitResults") fail("Submit Results was expected.");
    expect([submit.section, submit.session]).toEqual(["section-1", "session-1"]);
    const answered = played(engine, left, stage(engine, left, 5, { itemIdentifiers: ["i3"], stageLength: 1 })).state;
    expect(await sendCatRequest(port, waiting(engine, answered))).toEqual({ ended: true });
    expect(port.calls[2]).toEqual({ method: "endSession", section: "section-1", session: "session-1" });
  });

  it("rejects with the error of the port and does not repeat the request", async () => {
    let calls = 0;
    const broken = {
      ...fakePort([]),
      createSession: () => {
        calls += 1;
        return Promise.reject(new Error("The CAT engine is down."));
      },
    };
    await expect(sendCatRequest(broken, waiting(engine, begun(engine).state))).rejects.toThrow(
      "The CAT engine is down.",
    );
    expect(calls).toBe(1);
  });

  it("ends the wait when the signal aborts, and lets the request of the port go on", async () => {
    const request = waiting(engine, begun(engine).state);
    const reason = new Error("The page was closed.");
    const aborted = fakePort([]);
    await expect(sendCatRequest(aborted, request, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(aborted.calls).toEqual([]);

    const answer = unsettled<CreateSessionResponse>();
    let sent = 0;
    const slow = {
      ...fakePort([]),
      createSession: () => {
        sent++;
        return answer.promise;
      },
    };
    const controller = new AbortController();
    const waited = sendCatRequest(slow, request, { signal: controller.signal });
    controller.abort(reason);
    await expect(waited).rejects.toBe(reason);
    answer.reject(new Error("The CAT engine answered too late."));
    await Promise.resolve();
    expect(sent).toBe(1);

    const quick = fakePort([]);
    const answered = await sendCatRequest(quick, request, { signal: new AbortController().signal });
    expect(answered).toMatchObject({ sessionIdentifier: "session-1" });
  });

  it("gives the port the signal of the caller with the request, so that the port can stop it", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const signal = new AbortController().signal;
    await sendCatRequest(recordingSignals(fakePort([]), signals), waiting(engine, begun(engine).state), { signal });
    await sendCatRequest(recordingSignals(fakePort([]), signals), waiting(engine, begun(engine).state));
    expect(signals).toEqual([signal, undefined]);
  });

  it("checks its arguments", async () => {
    const request = waiting(engine, begun(engine).state);
    await expect(sendCatRequest(fakePort([]), request, JSON.parse("null"))).rejects.toThrow(
      "The options must be an object, found null.",
    );
    await expect(sendCatRequest(fakePort([]), request, JSON.parse('{"signal":{}}'))).rejects.toThrow(
      "The option signal must be an AbortSignal, found an object.",
    );
    await expect(sendCatRequest(JSON.parse("null"), request)).rejects.toThrow(
      "The port must be an object with the methods of CatSessionPort, found null.",
    );
    await expect(sendCatRequest(fakePort([]), JSON.parse("null"))).rejects.toThrow(
      "The request must be a CAT request from Engine.pending, found null.",
    );
    await expect(sendCatRequest(fakePort([]), JSON.parse('{"kind":"other"}'))).rejects.toThrow(
      'The kind of the request must be "create-session", "submit-results" or "end-session", found "other".',
    );
    await expect(sendCatRequest(JSON.parse("{}"), request)).rejects.toThrow(
      "The port must have a function createSession, found undefined.",
    );
  });
});

describe("drainCat", () => {
  const pool = refs("i1", "i2", "i3", "i4");
  const engine = engineOf(
    `${outcome("TOTAL", "float")}${part("P", section("A", ADAPTIVE + pool))}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
    { cat: CAT_A },
  );
  /** A clock that reads 1000, 2000, … */
  const clock = (): (() => number) => {
    let reading = 0;
    return () => {
      reading += 1000;
      return reading;
    };
  };

  it("makes each waiting request through the port with an injected clock, until nothing waits", async () => {
    const port = fakePort([["i3"], null], ["i1", "i2"]);
    const now = clock();
    const start = begun(engine);
    const first = await drainCat(engine, start.state, port, now);
    expect(first.current).toEqual(key("i1"));
    expect(first.at).toBe(1000);
    expect(port.calls).toEqual([{ method: "createSession", section: "section-1", request: {} }]);
    const two = played(
      engine,
      first,
      pick("i1", "B", 1001),
      act("submit", "i1", 1002),
      next(1003),
      pick("i2", "B", 1004),
      act("submit", "i2", 1005),
    );
    const second = await drainCat(engine, two.state, port, now);
    expect(second.at).toBe(2000);
    expect(port.calls.map(({ method }) => method)).toEqual(["createSession", "submitResults"]);
    const call = port.calls[1];
    if (call?.method !== "submitResults") fail("Submit Results was expected.");
    expect([call.section, call.session]).toEqual(["section-1", "session-1"]);
    expect(call.request.assessmentResult.itemResults.map((r) => r.identifier)).toEqual(["i1", "i2"]);
    const three = played(engine, second, next(2001), pick("i3", "B", 2002), act("submit", "i3", 2003));
    const third = await drainCat(engine, three.state, port, now);
    expect(third.cat[0]).toMatchObject({ status: "ended" });
    expect(engine.pending(third).cat).toEqual([]);
    expect(played(engine, third, next(4000)).state.status).toBe("ended");
  });

  it("makes the last Submit Results and End Session of a candidate who ended the test", async () => {
    const port = fakePort([["i3"]], ["i1", "i2"]);
    const now = clock();
    const first = await drainCat(engine, begun(engine).state, port, now);
    const left = played(engine, first, pick("i1", "B", 1001), act("submit", "i1", 1002), {
      type: "end-test",
      at: 1003,
    });
    const done = await drainCat(engine, left.state, port, now);
    expect(port.calls.map(({ method }) => method)).toEqual(["createSession", "submitResults", "endSession"]);
    expect(port.calls[2]).toEqual({ method: "endSession", section: "section-1", session: "session-1" });
    expect(done.cat[0]?.status).toBe("ended");
  });

  it("returns the state as it is when nothing waits", async () => {
    const port = fakePort([]);
    const first = await drainCat(engine, begun(engine).state, port, clock());
    expect(await drainCat(engine, first, port, clock())).toBe(first);
  });

  it("rejects with the error of the port, and with a message when the engine refuses the answer", async () => {
    const broken = { ...fakePort([]), createSession: () => Promise.reject(new Error("The CAT engine is down.")) };
    await expect(drainCat(engine, begun(engine).state, broken, clock())).rejects.toThrow("The CAT engine is down.");
    const strange = {
      ...fakePort([]),
      createSession: async () => ({ sessionIdentifier: "s", nextItems: { itemIdentifiers: ["zzz"] } }),
    };
    await expect(drainCat(engine, begun(engine).state, strange, clock())).rejects.toThrow(
      'The answer of the CAT engine to the request cat:A:1:1 was refused: The stage names the item "zzz", which the adaptive section "A" does not list.',
    );
  });

  it("stops before its next request when the signal aborts, with the reason of the signal", async () => {
    const reason = new Error("The page was closed.");
    const aborted = AbortSignal.abort(reason);
    const idle = fakePort([]);
    await expect(drainCat(engine, begun(engine).state, idle, clock(), { signal: aborted })).rejects.toBe(reason);
    expect(idle.calls).toEqual([]);

    const first = await drainCat(engine, begun(engine).state, fakePort([["i3"]]), clock());
    const left = played(engine, first, pick("i1", "B", 1001), act("submit", "i1", 1002), {
      type: "end-test",
      at: 1003,
    });
    const controller = new AbortController();
    const port = fakePort([["i3"]]);
    const stopping = {
      ...port,
      submitResults: (...args: Parameters<typeof port.submitResults>) => {
        controller.abort(reason);
        return port.submitResults(...args);
      },
    };
    await expect(drainCat(engine, left.state, stopping, clock(), { signal: controller.signal })).rejects.toBe(reason);
    expect(port.calls.map(({ method }) => method)).toEqual(["submitResults"]);
  });

  it("gives the port the signal of the caller with each request", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const { signal } = new AbortController();
    await drainCat(engine, begun(engine).state, recordingSignals(fakePort([]), signals), clock(), { signal });
    expect(signals).toEqual([signal]);
  });

  it("ends the wait for the answer to a request when the signal aborts", async () => {
    const reason = new Error("The page was closed.");
    const controller = new AbortController();
    const answer = unsettled<CreateSessionResponse>();
    let sent = 0;
    const slow = {
      ...fakePort([]),
      createSession: () => {
        sent++;
        return answer.promise;
      },
    };
    const draining = drainCat(engine, begun(engine).state, slow, clock(), { signal: controller.signal });
    controller.abort(reason);
    await expect(draining).rejects.toBe(reason);
    answer.resolve({ sessionIdentifier: "session-1", nextItems: { itemIdentifiers: ["i1", "i2"], stageLength: 2 } });
    expect(sent).toBe(1);
  });

  it("checks its arguments", async () => {
    const state = begun(engine).state;
    const port = fakePort([]);
    await expect(drainCat(engine, state, port, clock(), JSON.parse("null"))).rejects.toThrow(
      "The options must be an object, found null.",
    );
    await expect(drainCat(engine, state, port, clock(), JSON.parse('{"signal":null}'))).rejects.toThrow(
      "The option signal must be an AbortSignal, found null.",
    );
    await expect(drainCat(engine, state, port, clock(), JSON.parse('{"signal":{}}'))).rejects.toThrow(
      "The option signal must be an AbortSignal, found an object.",
    );
    await expect(drainCat(JSON.parse("null"), state, port, clock())).rejects.toThrow(DataError);
    await expect(drainCat(engine, JSON.parse("{}"), port, clock())).rejects.toThrow(DataError);
    await expect(drainCat(engine, state, JSON.parse("null"), clock())).rejects.toThrow(
      "The port must be an object with the methods of CatSessionPort, found null.",
    );
    await expect(drainCat(engine, state, JSON.parse("{}"), clock())).rejects.toThrow(
      "The port must have a function createSession, found undefined.",
    );
    await expect(drainCat(engine, state, port, JSON.parse('"now"'))).rejects.toThrow(
      'The clock now must be a function that returns epoch milliseconds, found "now".',
    );
  });
});

describe("createEngine with adaptive sections", () => {
  const adaptive = (id: string): string => section(id, ADAPTIVE + refs(`${id}1`));
  const content = `${outcome("TOTAL", "float")}${part("P", adaptive("A"))}`;

  it("needs an entry in catSections for each adaptive section, and for no other section", () => {
    expect(() => engineOf(content)).toThrow(
      'The adaptive section "A" needs an entry in the catSections of the definition: its URL prefix and the identifier that createSection returned.',
    );
    const extra = new Map([...CAT_A, ["S", { prefix: "https://cat.example/api", sectionIdentifier: "x" }]]);
    expect(() =>
      engineOf(`${content.replace("</qti-test-part>", `${section("S", refs("s1"))}</qti-test-part>`)}`, { cat: extra }),
    ).toThrow('The catSections of the definition has an entry for "S", which is not an adaptive section of the test.');
  });

  it("refuses catSections of other types", () => {
    expect(() => engineOf(content, { cat: JSON.parse('{"A":{}}') })).toThrow(
      "The catSections of the definition must be a Map from the identifier of an adaptive section to its prefix and identifier, found an object.",
    );
    expect(() =>
      engineOf(content, { cat: new Map([["A", JSON.parse('{"prefix":1,"sectionIdentifier":"x"}')]]) }),
    ).toThrow('The prefix of the entry "A" of the catSections must be a string, found 1.');
    expect(() => engineOf(content, { cat: new Map([["A", JSON.parse("null")]]) })).toThrow(
      'The entry "A" of the catSections of the definition must be an object, found null.',
    );
  });
});

describe("results", () => {
  const engine = reportedTest();
  const resultContext = REPORT_CONTEXT;
  const played1 = () => reportedSession(engine);
  const variablesOf = (result: AssessmentResult["itemResults"][number] | undefined) =>
    new Map((result?.variables ?? []).map((variable) => [variable.identifier, variable]));

  it("reports the context, the test with its durations, context variable and outcomes, and each item presented in order", () => {
    const { state } = played1();
    expect(state.status).toBe("ended");
    const results = engine.results(state);
    expect(results.context).toEqual(resultContext);
    expect(results.itemResults.map(({ identifier, sequenceIndex }) => [identifier, sequenceIndex])).toEqual([
      ["q1", 1],
      ["w", 2],
    ]);
    const test = results.testResult;
    expect(test?.identifier).toBe("T");
    // The result of the test has no datestamp of its own: it is the time of the latest step.
    expect(test?.datestamp).toBe("1970-01-01T00:00:05.000Z");
    expect(test?.variables.map((variable) => [variable.kind, variable.identifier])).toEqual([
      ["response", "duration"],
      ["response", "P.duration"],
      ["response", "S.duration"],
      ["context", "SITE"],
      ["outcome", "TOTAL"],
    ]);
    const durations = test?.variables.flatMap((variable) =>
      variable.kind === "response" ? [variable.candidateResponse] : [],
    );
    expect(durations).toEqual([buildSingle("duration", 5), buildSingle("duration", 5), buildSingle("duration", 5)]);
    expect(test?.variables.find((variable) => variable.kind === "context")).toMatchObject({
      value: buildSingle("string", "jkt"),
    });
    expect(test?.variables.find((variable) => variable.kind === "outcome")).toMatchObject({
      value: buildSingle("float", 1),
    });
  });

  it("reports an item with the datestamp of its last event, its time, responses, statuses, outcomes and comment", () => {
    const results = engine.results(played1().state);
    const [first] = results.itemResults;
    expect(first).toMatchObject({
      identifier: "q1",
      sequenceIndex: 1,
      // The submission at 2000; leaving the item at 3000 closes a closed session and is no event of it.
      datestamp: "1970-01-01T00:00:02.000Z",
      sessionStatus: "final",
      candidateComment: "A good question",
    });
    const variables = variablesOf(first);
    // The item was shown from 0 to 2000 ms: its duration is reported although the item is not time dependent.
    expect(variables.get("duration")).toMatchObject({
      kind: "response",
      candidateResponse: buildSingle("duration", 2),
    });
    expect(variables.get("numAttempts")).toMatchObject({ candidateResponse: buildSingle("integer", 1) });
    expect(variables.get("RESPONSE")).toMatchObject({
      kind: "response",
      cardinality: "single",
      baseType: "identifier",
      candidateResponse: buildSingle("identifier", "B"),
      scoreStatus: "scored",
      answeredStatus: "answered",
    });
    expect(variables.get("SCORE")).toMatchObject({ kind: "outcome", value: buildSingle("float", 1) });
    expect(variables.get("completionStatus")).toMatchObject({
      kind: "outcome",
      value: buildSingle("identifier", "unknown"),
    });
  });

  it("reports the order in which the choices were shown when they are shuffled", () => {
    const [first] = engine.results(played1().state).itemResults;
    const sequence = variablesOf(first).get("RESPONSE");
    const item = choice("q1");
    // The first item draws its order first from the generator of seed 1.
    const [expected] = drawOrders(
      describeInteractions(item)[0] ?? fail("The item has an interaction."),
      createRandom(1),
    );
    expect(sequence).toMatchObject({ choiceSequence: expected });
    expect([...(expected ?? [])].sort()).toEqual(["A", "B", "C"]);
  });

  it("lists the supports used: those of the profile as assigned, the program's as universal", () => {
    const [first, second] = engine.results(played1().state).itemResults;
    expect(first?.supports).toEqual([
      { name: "line-reader", assignment: "assigned" },
      { name: "calculator-on-screen", assignment: "universal" },
    ]);
    // The calculator was on when the essay was presented, so it counts for that item too.
    expect(second?.supports).toEqual(first?.supports);
    expect(engine.results(played1().state).testResult?.supports).toEqual(first?.supports);
  });

  it("reports an item awaiting an external score as provisional, and as final once the score arrives", () => {
    const { state } = played1();
    const provisional = engine.results(state).itemResults[1];
    expect(provisional?.sessionStatus).toBe("pendingExternalScoring");
    expect(variablesOf(provisional).get("RESPONSE")).toMatchObject({
      scoreStatus: "notscored",
      answeredStatus: "answered",
    });
    const supplied = played(engine, state, {
      type: "supply-scores",
      request: "item:w:1:SCORE",
      value: buildSingle("float", 8),
      scorer: "human",
      at: 6000,
    });
    const final = engine.results(supplied.state);
    expect(final.itemResults[1]?.sessionStatus).toBe("final");
    expect(variablesOf(final.itemResults[1]).get("RESPONSE")).toMatchObject({ scoreStatus: "scored" });
    expect(variablesOf(final.itemResults[1]).get("SCORE")).toMatchObject({
      value: buildSingle("float", 8),
      externalScored: "human",
      interpretation: "Essay score",
      normalMaximum: 10,
    });
    expect(final.testResult?.variables.find(({ identifier }) => identifier === "TOTAL")).toMatchObject({
      value: buildSingle("float", 9),
    });
    expect(final.testResult?.datestamp).toBe("1970-01-01T00:00:06.000Z");
  });

  it("gives the context its default, and no test result for an item delivered alone", () => {
    const solo = begun(engine);
    expect(engine.results(solo.state).context).toEqual({ sessionIdentifiers: [] });
    const item = createEngine({ kind: "item", item: choice("practice"), base: "practice.xml" });
    const started = item.start({ seed: 1, at: 0 });
    if (!started.ok) fail("The start was refused.");
    const alone = item.results(started.state);
    expect(alone.testResult).toBeUndefined();
    expect(alone.itemResults.map(({ identifier, sessionStatus }) => [identifier, sessionStatus])).toEqual([
      ["practice", "pendingSubmission"],
    ]);
  });

  it("writes a document that reads back as the same report", () => {
    const supplied = played(engine, played1().state, {
      type: "supply-scores",
      request: "item:w:1:SCORE",
      value: buildSingle("float", 8),
      scorer: "human",
      at: 6000,
    });
    for (const state of [played1().state, supplied.state, begun(engine, { resultContext }).state]) {
      const results = engine.results(state);
      expect(readResults(writeResults(results))).toEqual(results);
    }
  });

  it("copies the context of the results at the start and refuses one of another type", () => {
    const given = {
      sourcedId: "candidate-2",
      sessionIdentifiers: [{ sourceId: "https://lms.example/", identifier: "S-2" }],
    };
    const { state } = begun(engine, { resultContext: { ...given, extra: 1 } as typeof given });
    expect(state.report).toEqual(given);
    const bad = (resultContext: unknown) => () =>
      engine.start({ seed: 1, at: 0, resultContext: resultContext as never });
    expect(bad(JSON.parse("null"))).toThrow(
      "The options object is invalid at resultContext: expected an object, found null.",
    );
    expect(bad(JSON.parse('{"sessionIdentifiers":"S-1"}'))).toThrow(
      'The sessionIdentifiers of the option resultContext must be an array, found "S-1".',
    );
    expect(bad(JSON.parse('{"sourcedId":3,"sessionIdentifiers":[]}'))).toThrow(
      "The sourcedId of the option resultContext must be a string, found 3.",
    );
    expect(bad(JSON.parse('{"sessionIdentifiers":[{"sourceId":"a"}]}'))).toThrow(
      "The identifier of a session identifier of the option resultContext must be a string, found undefined.",
    );
  });

  it("checks the state and the request it is given", () => {
    expect(() => engine.results(JSON.parse("null"))).toThrow(DataError);
    expect(() => engine.pending(JSON.parse("{}"))).toThrow(DataError);
    const { state } = played1();
    expect(() => engine.scorerView(state, JSON.parse("1"))).toThrow("The request must be a string, found 1.");
  });
});

describe("datestamps and times", () => {
  const engine = reportedTest();
  const First = -62_135_596_800_000;
  const Last = 253_402_300_799_999;
  const stampOf = (at: number): string => {
    const started = engine.start({ seed: 1, at });
    if (!started.ok) fail("The start was refused.");
    return engine.results(started.state).testResult?.datestamp ?? fail("The report has no test result.");
  };

  it("writes the datestamp as RFC 3339 date-time with the offset Z, which an xs:dateTime may lack", () => {
    expect(stampOf(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(stampOf(1_761_825_600_123)).toBe("2025-10-30T12:00:00.123Z");
    expect(stampOf(First)).toBe("0001-01-01T00:00:00.000Z");
    expect(stampOf(Last)).toBe("9999-12-31T23:59:59.999Z");
  });

  it("gives every time between the years 1 and 9999 a datestamp that reads back as the same time", () => {
    fc.assert(
      fc.property(fc.integer({ min: First, max: Last }), (at) => {
        const text = stampOf(at);
        expect(text).toMatch(RFC_3339);
        expect(isXsdDateTime(text)).toBe(true);
        expect(Date.parse(text)).toBe(at);
      }),
    );
  });

  it("refuses a time outside the years 1 to 9999, which no datestamp can show", () => {
    expect(() => engine.start({ seed: 1, at: Last + 1 })).toThrow(
      "The options object is invalid at at: expected a value of at most 253402300799999, found 253402300800000.",
    );
    expect(() => engine.start({ seed: 1, at: First - 1 })).toThrow(DataError);
    const { state } = begun(engine);
    expect(() => engine.apply(state, { type: "time", at: Last + 1 })).toThrow(
      "The time of the action must be epoch milliseconds from the year 1 to the year 9999, found 253402300800000.",
    );
    expect(() => stamp(state, { type: "time" }, Number.POSITIVE_INFINITY)).toThrow(DataError);
    expect(stamp(state, { type: "time" }, Last).at).toBe(Last);
  });
});

describe("properties", () => {
  const block = covers("CONTENT", [["w1", "Task 1"]]);
  const pool = ["a1", "a2", "a3", "a4"];
  const conventional = section("S", refs("w1", "q1", "L1"));
  const adaptive = section("A", ADAPTIVE + refs(...pool));
  /** A test with a conventional and an adaptive section, in either order. */
  const walkers = [conventional + adaptive, adaptive + conventional].map((sections) =>
    engineOf(
      `${outcome("TOTAL", "float")}${outcome("CONTENT", "float", 'external-scored="human"')}${block}${part("P", sections)}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
      { items: { w1: essay("w1"), L1: linkResolution("L1") }, cat: CAT_A },
    ),
  );
  const response = (ref: string, at: number): Action => (ref === "w1" ? write(ref, "words", at) : pick(ref, "B", at));

  /** The action that the number `n` chooses in a state: some are impossible there, and the engine refuses them. */
  function chosen(walker: Engine, state: DeliveryState, n: number): Action {
    const at = state.at + (n % 4);
    const { scoring, cat } = walker.pending(state);
    const host = [
      ...scoring.map(
        (request): Action => ({
          type: "supply-scores",
          request: request.id,
          value: buildSingle("float", n % 11),
          scorer: "human",
          at,
        }),
      ),
      ...cat.map((request): Action => {
        if (request.kind === "end-session")
          return { type: "cat-response", request: request.id, response: { ended: true }, at };
        const items = [pool[n % 4] ?? "a1", pool[(n >> 2) % 4] ?? "a2"].slice(0, 1 + (n % 2));
        const next =
          n % 3 === 0 && request.kind === "submit-results"
            ? null
            : { itemIdentifiers: items, stageLength: items.length };
        return {
          type: "cat-response",
          request: request.id,
          response:
            request.kind === "create-session" ? { sessionIdentifier: "s", nextItems: next ?? {} } : { nextItems: next },
          at,
        };
      }),
    ];
    const ref = state.current?.ref ?? "q1";
    const instance = state.current?.instance ?? 1;
    const candidate: Action[] = [
      { ...response(ref, at), item: key(ref, instance) } as Action,
      act("submit", ref, at, instance),
      act("skip", ref, at, instance),
      next(at),
      next(at),
      { type: "end-part", at },
      { type: "suspend", at },
      { type: "resume", at },
      { type: "time", at },
      ...(n % 17 === 0 ? [{ type: "end-test", at } as const] : []),
    ];
    const options = [...candidate, ...host, ...host];
    return options[n % options.length] ?? { type: "time", at };
  }

  /** Plays the numbers, keeps the accepted actions, and checks what holds after every step. */
  function walk(
    walker: Engine,
    numbers: readonly number[],
  ): { readonly state: DeliveryState; readonly log: readonly Action[] } {
    const first = walker.start({ seed: 7, at: 0 });
    if (!first.ok) fail("The start was refused.");
    let state = first.state;
    const log: Action[] = [];
    for (const n of numbers) {
      const action = chosen(walker, state, n);
      const before = serializeState(state);
      // The view builds in every state, also while a CAT engine is awaited, and lists the types the engine accepts.
      const view = walker.view(state, action.at);
      expect(readView(writeView(view))).toEqual(view);
      const step = walker.apply(state, action);
      // A resume of a session that runs changes nothing and is no action to offer.
      const offered = !HostTypes.includes(action.type) && !(action.type === "resume" && state.status === "in-progress");
      if (step.ok && offered) expect(view.actions).toContain(action.type);
      // A step never changes the state it starts from, and a refusal leaves no trace.
      expect(serializeState(state)).toBe(before);
      if (!step.ok) continue;
      state = step.state;
      log.push(action);
      const text = serializeState(state);
      expect(serializeState(deserializeState(text))).toBe(text);
      const { scoring } = walker.pending(state);
      expect(scoring.every((request) => request.supplied === undefined)).toBe(true);
      expect(new Set(state.scoring.map(({ id }) => id)).size).toBe(state.scoring.length);
      expect(state.scoring.every((request) => request.requestedAt <= state.at)).toBe(true);
      const report = walker.results(state);
      expect(readResults(writeResults(report))).toEqual(report);
    }
    return { state, log };
  }

  const HostTypes: readonly Action["type"][] = ["time", "supply-scores", "cat-response"];
  const walks = fc.record({
    engine: fc.constantFrom(...walkers),
    numbers: fc.array(fc.integer({ min: 0, max: 2000 }), { minLength: 1, maxLength: 40 }),
  });

  it("never throws on a state of its test, keeps every state serializable, and writes a valid report", () => {
    fc.assert(
      fc.property(walks, ({ engine, numbers }) => void walk(engine, numbers)),
      { numRuns: 80, seed: 20_261_030 },
    );
  });

  it("rebuilds the same state by replaying the accepted actions from the seed", () => {
    fc.assert(
      fc.property(walks, ({ engine: walker, numbers }) => {
        const { state, log } = walk(walker, numbers);
        const replay = walker.start({ seed: 7, at: 0 });
        if (!replay.ok) fail("The start was refused.");
        let again = replay.state;
        for (const action of log) {
          const step = walker.apply(again, action);
          if (!step.ok) fail(`The replay refused ${action.type}: ${step.refusal.reason}.`);
          again = step.state;
        }
        expect(serializeState(again)).toBe(serializeState(state));
      }),
      { numRuns: 60, seed: 20_261_031 },
    );
  });

  it("asks for every external score once the test ended, and has nothing pending once the host answered all", () => {
    fc.assert(
      fc.property(walks, ({ engine: walker, numbers }) => {
        const walked = walk(walker, numbers);
        const ended = walker.apply(walked.state, { type: "end-test", at: walked.state.at + 1 });
        let state = ended.ok ? ended.state : walked.state;
        if (state.status !== "ended") return;
        // The essay and the test outcome, each once, if they were presented or the test ended.
        const ids = state.scoring.map(({ id }) => id);
        expect(ids).toContain("test:CONTENT");
        for (let round = 0; round < 12; round++) {
          const { scoring, cat } = walker.pending(state);
          const request = scoring[0];
          const waitingCat = cat[0];
          if (request !== undefined) {
            state = played(walker, state, {
              type: "supply-scores",
              request: request.id,
              value: buildSingle("float", 1),
              scorer: "human",
              at: state.at,
            }).state;
          } else if (waitingCat !== undefined) {
            const response =
              waitingCat.kind === "end-session"
                ? { ended: true as const }
                : { sessionIdentifier: "s", nextItems: null };
            state = played(walker, state, {
              type: "cat-response",
              request: waitingCat.id,
              response,
              at: state.at,
            }).state;
          }
        }
        expect(walker.pending(state)).toEqual({ scoring: [], cat: [] });
        const statuses = walker.results(state).itemResults.map(({ sessionStatus }) => sessionStatus);
        expect(statuses).not.toContain("pendingExternalScoring");
      }),
      { numRuns: 60, seed: 20_261_032 },
    );
  });
});
