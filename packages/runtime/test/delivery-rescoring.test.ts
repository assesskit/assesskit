import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Action,
  ASI_NAMESPACE,
  type AssessmentItem,
  type AssessmentResult,
  createItemVariables,
  createRandom,
  DataError,
  type DeliveryState,
  type Engine,
  type ItemResult,
  type ItemVariables,
  type OutcomeVariable,
  ProcessingError,
  type ResponseVariable,
  readAsi,
  readItemVariables,
  readResults,
  readTestInputs,
  runOutcomeProcessing,
  runResponseProcessing,
  single,
  type TestStructure,
  type Value,
  validateResults,
  writeResults,
} from "../src/index.js";
import { fuzzJson } from "./fuzz.js";
import {
  ADAPTIVE,
  act,
  begun,
  CAT_A,
  engineOf,
  fail,
  key,
  next,
  outcome,
  part,
  played,
  processing,
  refs,
  SUM_SCORES,
  section,
  setOutcome,
  stage,
  structureOf,
  waiting,
} from "./pending-fixtures.js";

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

/** An item from its attributes and content. */
function itemOf(identifier: string, attributes: string, content: string): AssessmentItem {
  const document = readAsi(
    `<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="${identifier}" title="Item ${identifier}" time-dependent="false" ${attributes}>${content}</qti-assessment-item>`,
  );
  return document.kind === "item" ? document.item : fail(`Expected an item, found ${document.kind}.`);
}

const MATCH_CORRECT = "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct";

/** A choice item scored 1 for the choice `correct`. */
function keyed(identifier: string, correct: string, attributes = ""): AssessmentItem {
  return itemOf(
    identifier,
    attributes,
    `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
      <qti-correct-response><qti-value>${correct}</qti-value></qti-correct-response>
    </qti-response-declaration>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
    <qti-item-body>
      <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
        <qti-simple-choice identifier="A">A</qti-simple-choice><qti-simple-choice identifier="B">B</qti-simple-choice><qti-simple-choice identifier="C">C</qti-simple-choice>
      </qti-choice-interaction>
    </qti-item-body>
    <qti-response-processing template="${MATCH_CORRECT}"/>`,
  );
}

/** An item whose template processing draws a number from 1 to 9 and makes it the correct response. */
const drawn = (identifier: string): AssessmentItem =>
  itemOf(
    identifier,
    "",
    `<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="integer"/>
  <qti-template-declaration identifier="N" cardinality="single" base-type="integer"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-template-processing>
    <qti-set-template-value identifier="N"><qti-random-integer min="1" max="9"/></qti-set-template-value>
    <qti-set-correct-response identifier="RESPONSE"><qti-variable identifier="N"/></qti-set-correct-response>
  </qti-template-processing>
  <qti-item-body><p><qti-text-entry-interaction response-identifier="RESPONSE"/></p></qti-item-body>
  <qti-response-processing template="${MATCH_CORRECT}"/>`,
  );

/** The items of the test, by item reference; `q1` is keyed `B`. */
const ITEMS: Readonly<Record<string, AssessmentItem>> = { q1: keyed("q1", "B"), q2: keyed("q2", "B"), d1: drawn("d1") };

/**
 * A test of one linear part with four instances selected with replacement from three item references, whose outcomes read
 * the item sessions in the ways that a scope has: the aggregates, `ITEM.VAR`, `ITEM.n.VAR`, and the durations.
 */
const CONTENT = `<qti-context-declaration identifier="SITE" cardinality="single" base-type="string"/>${outcome("TOTAL", "float")}${outcome("SELECTED", "integer")}${outcome("CORRECT", "integer")}${outcome("FIRST", "float")}${outcome("SECOND", "float")}${outcome("LATEST", "float")}${outcome("TIME", "duration")}${outcome("WHERE", "string")}${outcome("THETA", "float", 'external-scored="externalMachine"')}${outcome("BONUS", "float", "", "5")}${part(
  "P",
  section("S", `<qti-selection select="4" with-replacement="true"/>${refs("q1", "q2", "d1")}`),
)}${processing(
  setOutcome("TOTAL", SUM_SCORES),
  setOutcome("SELECTED", "<qti-number-selected/>"),
  setOutcome("CORRECT", "<qti-number-correct/>"),
  setOutcome("FIRST", '<qti-variable identifier="q1.1.SCORE"/>'),
  setOutcome("SECOND", '<qti-variable identifier="q1.2.SCORE"/>'),
  setOutcome("LATEST", '<qti-variable identifier="q1.SCORE"/>'),
  setOutcome("TIME", '<qti-variable identifier="duration"/>'),
  setOutcome("WHERE", '<qti-variable identifier="SITE"/>'),
)}`;

const STRUCTURE: TestStructure = structureOf(CONTENT);

/** What a session of the test is played with. */
interface Sitting {
  readonly engine: Engine;
  readonly state: DeliveryState;
}

/**
 * Answers the instance shown and submits it, `count` times, moving on between; then ends the test unless it has ended.
 * Under the seed 4 the plan is `q1`, `q1`, `q1` and `d1`.
 */
function sit(items: Readonly<Record<string, AssessmentItem>>, count: number, seed = 4): Sitting {
  const engine = engineOf(CONTENT, { items });
  let { state } = begun(engine, { seed, context: new Map([["SITE", single("string", "jkt")]]) });
  for (let turn = 0; turn < count; turn += 1) {
    const current = state.current ?? fail("The session has no item.");
    const at = 1000 * (turn + 1);
    const response = current.ref === "d1" ? single("integer", 5) : single("identifier", turn % 2 === 0 ? "B" : "C");
    state = played(
      engine,
      state,
      { type: "set-responses", item: current, responses: new Map([["RESPONSE", response]]), at },
      act("submit", current.ref, at + 300, current.instance),
      ...(turn < count - 1 ? [next(at + 600)] : []),
    ).state;
  }
  if (state.status !== "ended") state = played(engine, state, { type: "end-test", at: 1000 * (count + 1) }).state;
  return { engine, state };
}

/** The items of the fixture by item reference identifier. */
const ITEM_MAP: ReadonlyMap<string, AssessmentItem> = new Map(Object.entries(ITEMS));

/** What a rescoring changes about the recipe of `docs/runtime/delivery.md`. */
interface Rescoring {
  /** The item references whose response processing runs again. Default: all of the items. */
  readonly corrected?: ReadonlySet<string>;
  /** Changes the variables that `readItemVariables` returned, as a host puts a new key in. Default: none. */
  readonly fix?: (variables: ItemVariables, result: ItemResult) => ItemVariables;
  /** Changes the outcomes that `readTestInputs` returned, as a host sets a new `THETA`. Default: none. */
  readonly outcomes?: (outcomes: ReadonlyMap<string, Value | null>) => ReadonlyMap<string, Value | null>;
  /** The seed of the draws of processing. Default: 1. */
  readonly seed?: number;
  /** The structure of the test. Default: that of the fixture. */
  readonly structure?: TestStructure;
}

/** The outcomes of the recipe of `docs/runtime/delivery.md`: response processing of the corrected items, then the test. */
function rescored(
  report: AssessmentResult,
  items: ReadonlyMap<string, AssessmentItem>,
  options: Rescoring = {},
): ReadonlyMap<string, Value | null> {
  const {
    corrected = new Set(items.keys()),
    fix = (variables) => variables,
    outcomes = (kept) => kept,
    seed = 1,
    structure = STRUCTURE,
  } = options;
  const context = { random: createRandom(seed) };
  const variables = new Map<number, ItemVariables>();
  report.itemResults.forEach((itemResult, position) => {
    const item = items.get(itemResult.identifier);
    if (item === undefined || !corrected.has(itemResult.identifier)) return;
    if (itemResult.sessionStatus === "initial" || itemResult.sessionStatus === "pendingSubmission") return;
    variables.set(position, runResponseProcessing(item, fix(readItemVariables(item, itemResult), itemResult), context));
  });
  const inputs = readTestInputs(structure, report, items, { variables });
  return runOutcomeProcessing(structure.test.model, outcomes(inputs.outcomes), inputs.scope, context);
}

/**
 * A test of one nonlinear part that submits its items together, with three instances of `q1`, whose outcomes read `q1.SCORE`
 * and each instance.
 */
const TOGETHER = `${outcome("LATEST", "float")}${outcome("FIRST", "float")}${outcome("SECOND", "float")}${outcome("THIRD", "float")}${part(
  "P",
  section("S", `<qti-selection select="3" with-replacement="true"/>${refs("q1")}`),
  "nonlinear",
  "simultaneous",
)}${processing(
  setOutcome("LATEST", '<qti-variable identifier="q1.SCORE"/>'),
  setOutcome("FIRST", '<qti-variable identifier="q1.1.SCORE"/>'),
  setOutcome("SECOND", '<qti-variable identifier="q1.2.SCORE"/>'),
  setOutcome("THIRD", '<qti-variable identifier="q1.3.SCORE"/>'),
)}`;

/** A session of {@link TOGETHER} that answers the first instance, jumps to the third, answers it right and the second wrong. */
function jumped(): Sitting {
  const engine = engineOf(TOGETHER, { items: ITEMS });
  const answer = (instance: number, choice: string, at: number): Action => ({
    type: "set-responses",
    item: key("q1", instance),
    responses: new Map([["RESPONSE", single("identifier", choice)]]),
    at,
  });
  const { state } = played(
    engine,
    begun(engine).state,
    answer(1, "C", 100),
    { type: "move", to: key("q1", 3), at: 200 },
    answer(3, "B", 300),
    { type: "move", to: key("q1", 2), at: 400 },
    answer(2, "C", 500),
    { type: "end-test", at: 600 },
  );
  return { engine, state };
}

/**
 * The outcomes of the session without `TIME`: the engine reads the clock when it last processed outcomes, and a report
 * holds the clock at its end, so the two differ by the time that passed after the last submission.
 */
function untimed(outcomes: ReadonlyMap<string, Value | null>): ReadonlyMap<string, Value | null> {
  return new Map([...outcomes].filter(([identifier]) => identifier !== "TIME"));
}

/** The first item result of a report that has the identifier. */
function resultOf(report: AssessmentResult, identifier: string): ItemResult {
  return report.itemResults.find((each) => each.identifier === identifier) ?? fail(`No result for ${identifier}.`);
}

const response = (result: ItemResult, identifier: string): ResponseVariable =>
  result.variables.find(
    (each): each is ResponseVariable => each.kind === "response" && each.identifier === identifier,
  ) ?? fail(`No response variable ${identifier}.`);

describe("the results of the instances not presented", () => {
  const { engine, state } = sit(ITEMS, 2);
  const report = engine.results(state);

  it("lists every planned instance in plan order, those not presented with the sequence indexes after the others", () => {
    expect(state.plan.parts[0]?.children[0]?.children).toHaveLength(4);
    expect(report.itemResults.map(({ sequenceIndex }) => sequenceIndex)).toEqual([1, 2, 3, 4]);
    expect(report.itemResults.map(({ sessionStatus }) => sessionStatus)).toEqual([
      "final",
      "final",
      "initial",
      "initial",
    ]);
    const planned = state.plan.parts[0]?.children[0]?.children.flatMap((child) =>
      child.kind === "item" ? [child] : [],
    );
    expect(report.itemResults.slice(2).map(({ identifier }) => identifier)).toEqual(
      (planned ?? []).slice(2).map(({ key: planned }) => planned.ref),
    );
  });

  it("holds numAttempts 0, duration 0 and the datestamp of the test result, and no other variable", () => {
    const [, , first] = report.itemResults;
    expect(first?.datestamp).toBe(report.testResult?.datestamp);
    expect(first?.variables).toEqual([
      {
        kind: "response",
        identifier: "numAttempts",
        cardinality: "single",
        baseType: "integer",
        candidateResponse: single("integer", 0),
        extensions: [],
      },
      {
        kind: "response",
        identifier: "duration",
        cardinality: "single",
        baseType: "duration",
        candidateResponse: single("duration", 0),
        extensions: [],
      },
    ]);
    expect(first?.supports).toEqual([]);
  });

  it("is a valid report that survives writing and reading", () => {
    expect(validateResults(report)).toEqual([]);
    expect(readResults(writeResults(report))).toEqual(report);
  });

  it("lists the instances in plan order after the jumps of a nonlinear part, each with its place in the presentation", () => {
    const { engine, state } = jumped();
    const report = engine.results(state);
    expect(report.itemResults.map(({ sequenceIndex }) => sequenceIndex)).toEqual([1, 3, 2]);
    expect(report.itemResults.map((result) => response(result, "RESPONSE").candidateResponse)).toEqual([
      single("identifier", "C"),
      single("identifier", "C"),
      single("identifier", "B"),
    ]);
  });

  it("lists nothing more when the session presented every instance", () => {
    const all = sit(ITEMS, 4);
    expect(all.engine.results(all.state).itemResults.map(({ sessionStatus }) => sessionStatus)).toEqual([
      "final",
      "final",
      "final",
      "final",
    ]);
  });

  it("lists no instance of an item delivered alone twice", () => {
    const alone = engineOf(`${part("P", section("S", refs("q1")))}`);
    const state = begun(alone).state;
    expect(alone.results(state).itemResults.map(({ identifier }) => identifier)).toEqual(["q1"]);
  });
});

describe("the key that template processing set", () => {
  const { engine, state } = sit(ITEMS, 4);
  const report = engine.results(state);
  const drawnResults = report.itemResults.filter(({ identifier }) => identifier === "d1");

  it("is written as the correct response of the variable", () => {
    expect(drawnResults.length).toBeGreaterThan(0);
    for (const result of drawnResults) {
      const reported = response(result, "RESPONSE").correctResponse?.value;
      const template = result.variables.find((each) => each.kind === "template" && each.identifier === "N");
      expect(reported).toEqual(template?.kind === "template" ? template.value : undefined);
    }
  });

  it("is not written for a key that the declaration holds", () => {
    expect(response(resultOf(report, "q1"), "RESPONSE").correctResponse).toBeUndefined();
  });

  it("is left out of the report to a CAT engine", () => {
    const cat = engineOf(
      `${outcome("TOTAL", "float")}${part("P", section("A", ADAPTIVE + refs("d1", "i2")))}${processing(setOutcome("TOTAL", SUM_SCORES))}`,
      { cat: CAT_A, items: { d1: drawn("d1") } },
    );
    const start = begun(cat);
    const answered = played(
      cat,
      start.state,
      stage(cat, start.state, 1, { itemIdentifiers: ["d1"], stageLength: 1 }),
      {
        type: "set-responses",
        item: key("d1"),
        responses: new Map([["RESPONSE", single("integer", 4)]]),
        at: 2,
      },
      act("submit", "d1", 3),
    );
    const request = waiting(cat, answered.state);
    if (request.kind !== "submit-results") fail("A Submit Results request was expected.");
    expect(response(request.assessmentResult.itemResults[0] ?? fail("No result."), "RESPONSE").correctResponse).toBe(
      undefined,
    );
    expect(
      response(cat.results(answered.state).itemResults[0] ?? fail("No result."), "RESPONSE").correctResponse,
    ).toBeDefined();
  });
});

/** A response variable as a result holds it. */
const responseVar = (identifier: string, baseType: "identifier" | "integer" | "duration", value: Value | null) =>
  ({
    kind: "response",
    identifier,
    cardinality: "single",
    baseType,
    candidateResponse: value,
    extensions: [],
  }) satisfies ResponseVariable;

/** An outcome variable as a result holds it. */
const outcomeVar = (identifier: string, baseType: "identifier" | "integer" | "float", value: Value | null) =>
  ({ kind: "outcome", identifier, cardinality: "single", baseType, value }) satisfies OutcomeVariable;

/** An item with every kind of variable: a template that sets a key, a context, and an outcome that a scorer sets. */
const MIXED = itemOf(
  "mixed",
  "",
  `<qti-context-declaration identifier="LEVEL" cardinality="single" base-type="integer">
    <qti-default-value><qti-value>1</qti-value></qti-default-value>
  </qti-context-declaration>
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-response-declaration identifier="NUMBER" cardinality="single" base-type="integer"/>
  <qti-template-declaration identifier="N" cardinality="single" base-type="integer"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-outcome-declaration identifier="LEFT" cardinality="single" base-type="integer">
    <qti-default-value><qti-value>7</qti-value></qti-default-value>
  </qti-outcome-declaration>
  <qti-outcome-declaration identifier="RATING" cardinality="single" base-type="float" external-scored="human"/>
  <qti-template-processing>
    <qti-set-template-value identifier="N"><qti-random-integer min="1" max="9"/></qti-set-template-value>
    <qti-set-correct-response identifier="NUMBER"><qti-variable identifier="N"/></qti-set-correct-response>
  </qti-template-processing>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-simple-choice identifier="A">A</qti-simple-choice><qti-simple-choice identifier="B">B</qti-simple-choice>
    </qti-choice-interaction>
    <p><qti-text-entry-interaction response-identifier="NUMBER"/></p>
  </qti-item-body>
  <qti-response-processing template="${MATCH_CORRECT}"/>`,
);

/** The variables that a result of {@link MIXED} holds after an attempt. */
const STORED: ItemResult["variables"] = [
  responseVar("numAttempts", "integer", single("integer", 1)),
  responseVar("duration", "duration", single("duration", 12.5)),
  {
    ...responseVar("RESPONSE", "identifier", single("identifier", "A")),
    correctResponse: { value: single("identifier", "C") },
  },
  { ...responseVar("NUMBER", "integer", single("integer", 4)), correctResponse: { value: single("integer", 6) } },
  { kind: "template", identifier: "N", cardinality: "single", baseType: "integer", value: single("integer", 6) },
  { kind: "context", identifier: "LEVEL", cardinality: "single", baseType: "integer", value: single("integer", 3) },
  outcomeVar("completionStatus", "identifier", single("identifier", "unknown")),
  outcomeVar("SCORE", "float", single("float", 9)),
  outcomeVar("LEFT", "integer", single("integer", 1)),
  outcomeVar("RATING", "float", single("float", 4)),
];

describe("readItemVariables", () => {
  const read = readItemVariables(MIXED, { variables: STORED });

  it("takes the responses, attempts, duration, template and context variables and completion from the result", () => {
    expect(read.responses.get("RESPONSE")).toEqual(single("identifier", "A"));
    expect(read.responses.get("NUMBER")).toEqual(single("integer", 4));
    expect(read.responses.get("numAttempts")).toEqual(single("integer", 1));
    expect(read.responses.get("duration")).toEqual(single("duration", 12.5));
    expect(read.templates.get("N")).toEqual(single("integer", 6));
    expect(read.contexts.get("LEVEL")).toEqual(single("integer", 3));
    expect(read.outcomes.get("completionStatus")).toEqual(single("identifier", "unknown"));
  });

  it("resets the outcomes that processing sets, as the engine does, and keeps the ones that a scorer sets", () => {
    expect(read.outcomes.get("SCORE")).toEqual(single("float", 0));
    expect(read.outcomes.get("LEFT")).toEqual(single("integer", 7));
    expect(read.outcomes.get("RATING")).toEqual(single("float", 4));
  });

  it("takes the declared key, and the result's key for a variable that qti-set-correct-response sets", () => {
    expect(read.correctResponses.get("RESPONSE")).toEqual(single("identifier", "B"));
    expect(read.correctResponses.get("NUMBER")).toEqual(single("integer", 6));
  });

  it("takes the declared defaults, which a result does not hold", () => {
    expect(read.defaults.get("LEVEL")).toEqual(single("integer", 1));
    expect(read.defaults.get("LEFT")).toEqual(single("integer", 7));
  });

  it("starts a variable that the result omits as the item declares it, as for an instance not presented", () => {
    const start = readItemVariables(MIXED, { variables: [] });
    expect(start).toEqual(createItemVariables(MIXED));
    expect(start.correctResponses.get("NUMBER")).toBeNull();
  });

  it("leaves out what the item does not declare", () => {
    const more = readItemVariables(MIXED, {
      variables: [
        ...STORED,
        responseVar("EXTRA", "integer", single("integer", 1)),
        outcomeVar("TALLY", "integer", single("integer", 2)),
      ],
    });
    expect([...more.responses.keys()].sort()).toEqual(["NUMBER", "RESPONSE", "duration", "numAttempts"]);
    expect(more.outcomes.has("TALLY")).toBe(false);
  });

  it("changes nothing in the result and shares no map with it", () => {
    const before = JSON.stringify(STORED);
    const again = readItemVariables(MIXED, { variables: STORED });
    expect(JSON.stringify(STORED)).toBe(before);
    expect(again.responses).not.toBe(read.responses);
    expect(again).toEqual(read);
  });

  it("scores again to what the engine scored, as response processing runs on its variables", () => {
    const context = { random: createRandom(1) };
    const scored = runResponseProcessing(MIXED, readItemVariables(MIXED, { variables: STORED }), context);
    // RESPONSE A against the declared key B scores 0; the other response variable has no processing
    expect(scored.outcomes.get("SCORE")).toEqual(single("float", 0));
    expect(scored.outcomes.get("RATING")).toEqual(single("float", 4));
  });

  it("refuses an adaptive item, whose outcomes depend on every attempt", () => {
    const adaptive = keyed("ad", "B", 'adaptive="true"');
    expect(() => readItemVariables(adaptive, { variables: [] })).toThrow(DataError);
    expect(() => readItemVariables(adaptive, { variables: [] })).toThrow(/Replay its attempts/);
  });

  it("refuses a value that does not fit the declaration, as when the fix changed the declaration", () => {
    const changed = [...STORED, responseVar("RESPONSE", "integer", single("integer", 2))];
    expect(() => readItemVariables(MIXED, { variables: changed })).toThrow(DataError);
    expect(() => readItemVariables(MIXED, { variables: changed })).toThrow(/RESPONSE.*the item mixed/);
  });

  it("passes the ProcessingError of a declared value that is not in the lexical form of its base type", () => {
    const bad = itemOf(
      "bad",
      "",
      `<qti-response-declaration identifier="R" cardinality="single" base-type="integer">
        <qti-default-value><qti-value>abc</qti-value></qti-default-value>
      </qti-response-declaration><qti-item-body/>`,
    );
    expect(() => readItemVariables(bad, { variables: [] })).toThrow(ProcessingError);
  });

  it("refuses arguments of other types", () => {
    expect(() => readItemVariables(json("null"), { variables: [] })).toThrow(DataError);
    expect(() => readItemVariables(json('{"kind":"test"}'), { variables: [] })).toThrow(DataError);
    expect(() => readItemVariables(MIXED, json("null"))).toThrow(DataError);
    expect(() => readItemVariables(MIXED, json('{"variables":"none"}'))).toThrow(DataError);
    expect(() => readItemVariables(MIXED, json('{"variables":[null]}'))).toThrow(DataError);
    expect(() =>
      readItemVariables(MIXED, json('{"variables":[{"kind":"context","identifier":"LEVEL","value":"x"}]}')),
    ).toThrow(DataError);
    expect(() =>
      readItemVariables(
        MIXED,
        json('{"variables":[{"kind":"response","identifier":"RESPONSE","correctResponse":null}]}'),
      ),
    ).toThrow(DataError);
    expect(() =>
      readItemVariables(
        MIXED,
        json('{"variables":[{"kind":"response","identifier":"RESPONSE","candidateResponse":5}]}'),
      ),
    ).toThrow("The value of the response variable RESPONSE of the result must be an object, found 5.");
  });
});

/** The report of a session with the item results at positions changed. */
function changed(
  report: AssessmentResult,
  change: (result: ItemResult, position: number) => ItemResult,
): AssessmentResult {
  return { ...report, itemResults: report.itemResults.map(change) };
}

/** A result with the value of an outcome set. */
function withOutcome(result: ItemResult, identifier: string, value: Value): ItemResult {
  return {
    ...result,
    variables: result.variables.map((each) =>
      each.kind === "outcome" && each.identifier === identifier ? { ...each, value } : each,
    ),
  };
}

/** A report whose test result has a variable added or replaced. */
function withTestVariable(report: AssessmentResult, variable: OutcomeVariable): AssessmentResult {
  const test = report.testResult ?? fail("The report has no test result.");
  const others = test.variables.filter((each) => each.identifier !== variable.identifier);
  return { ...report, testResult: { ...test, variables: [...others, variable] } };
}

describe("readTestInputs", () => {
  const { engine, state } = sit(ITEMS, 3);
  const report = engine.results(state);

  it("reads only the declared outcomes that a scorer sets, as the report holds them", () => {
    const inputs = readTestInputs(
      STRUCTURE,
      withTestVariable(report, outcomeVar("THETA", "float", single("float", 2.5))),
      ITEM_MAP,
    );
    expect([...inputs.outcomes]).toEqual([["THETA", single("float", 2.5)]]);
  });

  it("leaves out an outcome that no declaration takes, as a CAT engine's extras are", () => {
    const extra = withTestVariable(report, outcomeVar("EXTRA", "float", single("float", 1)));
    expect(readTestInputs(STRUCTURE, extra, ITEM_MAP).outcomes.has("EXTRA")).toBe(false);
    expect(rescored(extra, ITEM_MAP).has("EXTRA")).toBe(false);
  });

  it("lists the sessions of the item results in the order of the report, filtered as the engine filters", () => {
    const { scope } = readTestInputs(STRUCTURE, report, ITEM_MAP);
    expect([...scope.itemSessions({})].map(({ ref }) => ref.identifier)).toEqual(
      report.itemResults.map(({ identifier }) => identifier),
    );
    expect([...scope.itemSessions({ sectionIdentifier: "S" })]).toHaveLength(report.itemResults.length);
    expect([...scope.itemSessions({ sectionIdentifier: "elsewhere" })]).toEqual([]);
    expect([...scope.itemSessions({ includeCategories: ["hard"] })]).toEqual([]);
    expect([...scope.itemSessions({ excludeCategories: ["hard"] })]).toHaveLength(report.itemResults.length);
  });

  it("gives ITEM.n the nth result of the reference, and nothing for an instance the report lacks", () => {
    const { scope } = readTestInputs(STRUCTURE, report, ITEM_MAP);
    expect(scope.itemSession("q1", 2)?.variables.outcomes.get("SCORE")).toEqual(single("float", 0));
    expect(scope.itemSession("q1", 4)).toBeUndefined();
    expect(scope.itemSession("q1", 0)).toBeUndefined();
    expect(scope.itemSession("q2", 1)).toBeUndefined();
    expect(scope.itemSession("elsewhere", undefined)).toBeUndefined();
  });

  it("reads the durations, the context variables and the item references as the engine's scope does", () => {
    const { scope } = readTestInputs(STRUCTURE, report, ITEM_MAP);
    expect(scope.variable("duration")).toEqual(single("duration", 4));
    expect(scope.variable("P.duration")).toEqual(single("duration", 4));
    expect(scope.variable("S.duration")).toEqual(single("duration", 4));
    expect(scope.variable("elsewhere.duration")).toBeUndefined();
    expect(scope.variable("SITE")).toEqual(single("string", "jkt"));
    expect(scope.variable("QTI_CONTEXT")).toBeNull();
    expect(scope.variable("q1.SCORE")).toBeNull();
    expect(scope.variable("elsewhere")).toBeUndefined();
  });

  it("reads 0 seconds for a scope that the report has no duration for", () => {
    const test = report.testResult ?? fail("The report has no test result.");
    const variables = test.variables.filter(({ identifier }) => !identifier.endsWith("duration"));
    const { scope } = readTestInputs(STRUCTURE, { ...report, testResult: { ...test, variables } }, ITEM_MAP);
    for (const name of ["duration", "P.duration", "S.duration"])
      expect(scope.variable(name)).toEqual(single("duration", 0));
  });

  it("starts a context variable that the report omits from its declared default", () => {
    const test = report.testResult ?? fail("The report has no test result.");
    const without = {
      ...report,
      testResult: { ...test, variables: test.variables.filter(({ identifier }) => identifier !== "SITE") },
    };
    expect(readTestInputs(STRUCTURE, without, ITEM_MAP).scope.variable("SITE")).toBeNull();
  });

  describe("ITEM.VAR", () => {
    const sat = sit(ITEMS, 3);
    const three = sat.engine.results(sat.state);
    const times = ["2026-01-01T00:00:01Z", "2026-01-01T00:00:03Z", "2026-01-01T00:00:02Z"];
    const dated = (stamps: readonly string[], status?: (position: number) => ItemResult["sessionStatus"]) =>
      changed(three, (result, position) => ({
        ...result,
        datestamp: stamps[position] ?? result.datestamp,
        ...(status === undefined ? {} : { sessionStatus: status(position) }),
      }));
    /** What LATEST reads from the stored scores, which response processing is not run again to change. */
    const latest = (rows: AssessmentResult) => rescored(rows, ITEM_MAP, { corrected: new Set() }).get("LATEST");

    it("reads the result with the latest datestamp among those with an attempt", () => {
      // The stored scores of the three results of q1 are 1, 0 and 1.
      expect(latest(dated(times))).toEqual(single("float", 0));
    });

    it("reads the later result when datestamps tie", () => {
      expect(latest(dated(["2026-01-01T00:00:01Z", "2026-01-01T00:00:01Z", "2026-01-01T00:00:01Z"]))).toEqual(
        single("float", 1),
      );
    });

    it("skips a result that is pending submission, whose responses were never submitted", () => {
      expect(latest(dated(times, (position) => (position === 1 ? "pendingSubmission" : "final")))).toEqual(
        single("float", 1),
      );
    });

    it("compares datestamps as instants, whatever their offsets", () => {
      const stamps = ["2026-01-01T05:00:00+05:00", "2026-01-01T00:00:00Z", "2025-12-31T23:59:59Z"];
      expect(latest(dated(stamps))).toEqual(single("float", 0));
    });

    it("reads the last result of the reference when none has an attempt", () => {
      const none = changed(three, (result) => ({
        ...result,
        variables: result.variables.map((each) =>
          each.kind === "response" && each.identifier === "numAttempts"
            ? { ...each, candidateResponse: single("integer", 0) }
            : each,
        ),
      }));
      const marked = changed(none, (result, position) =>
        position === 2
          ? withOutcome(result, "SCORE", single("float", 1))
          : withOutcome(result, "SCORE", single("float", 0)),
      );
      expect(latest(marked)).toEqual(single("float", 1));
    });
  });

  describe("the option variables", () => {
    it("replaces the variables of the report at the positions given", () => {
      const first = readItemVariables(ITEMS.q1 ?? fail("No q1."), report.itemResults[0] ?? fail("No result."));
      const scored = { ...first, outcomes: new Map(first.outcomes).set("SCORE", single("float", 5)) };
      const { scope } = readTestInputs(STRUCTURE, report, ITEM_MAP, { variables: new Map([[0, scored]]) });
      expect(scope.itemSession("q1", 1)?.variables).toBe(scored);
      expect(scope.itemSession("q1", 2)?.variables.outcomes.get("SCORE")).toEqual(single("float", 0));
    });

    it("refuses a position that is not one of the item results", () => {
      const variables = readItemVariables(ITEMS.q1 ?? fail("No q1."), { variables: [] });
      for (const position of [report.itemResults.length, -1, 1.5]) {
        expect(() =>
          readTestInputs(STRUCTURE, report, ITEM_MAP, { variables: new Map([[position, variables]]) }),
        ).toThrow(DataError);
      }
      expect(() => readTestInputs(STRUCTURE, report, ITEM_MAP, { variables: new Map([[99, variables]]) })).toThrow(
        /position 99.*item results/,
      );
    });
  });

  describe("failures", () => {
    it("refuses a report without a test result, which an item delivered alone has", () => {
      const alone = { context: report.context, itemResults: report.itemResults };
      expect(() => readTestInputs(STRUCTURE, alone, ITEM_MAP)).toThrow(/no test result/);
    });

    it("refuses an item result for a reference that the test or the items lack, and names it", () => {
      const first = report.itemResults[0] ?? fail("No result.");
      const unknown = { ...report, itemResults: [{ ...first, identifier: "elsewhere" }] };
      expect(() => readTestInputs(STRUCTURE, unknown, ITEM_MAP)).toThrow(/"elsewhere".*no item reference/);
      const lacking = new Map([...ITEM_MAP].filter(([identifier]) => identifier !== first.identifier));
      expect(() => readTestInputs(STRUCTURE, report, lacking)).toThrow(
        new RegExp(`"${first.identifier}".*items do not hold`),
      );
    });

    it("refuses a value of the report that does not fit the declaration of the fixed item", () => {
      const wrong = changed(report, (result, position) =>
        position === 0
          ? {
              ...result,
              variables: result.variables.map((each) =>
                each.kind === "response" && each.identifier === "RESPONSE"
                  ? { ...each, candidateResponse: single("integer", 1) }
                  : each,
              ),
            }
          : result,
      );
      expect(() => readTestInputs(STRUCTURE, wrong, ITEM_MAP)).toThrow(/RESPONSE.*declaration changed/);
    });

    it("refuses a datestamp that is not a date and time", () => {
      const first = report.itemResults[0] ?? fail("No result.");
      const soon = { ...report, itemResults: [{ ...first, datestamp: "soon" }] };
      expect(() => readTestInputs(STRUCTURE, soon, ITEM_MAP)).toThrow(/datestamp.*"soon"/);
    });

    it("refuses arguments of other types", () => {
      expect(() => readTestInputs(json("null"), report, ITEM_MAP)).toThrow(DataError);
      expect(() => readTestInputs(json("{}"), report, ITEM_MAP)).toThrow(DataError);
      expect(() => readTestInputs(STRUCTURE, json("null"), ITEM_MAP)).toThrow(DataError);
      expect(() => readTestInputs(STRUCTURE, json('{"itemResults":"none"}'), ITEM_MAP)).toThrow(DataError);
      expect(() => readTestInputs(STRUCTURE, { ...report, itemResults: json("[null]") }, ITEM_MAP)).toThrow(DataError);
      expect(() => readTestInputs(STRUCTURE, { ...report, testResult: json("null") }, ITEM_MAP)).toThrow(DataError);
      expect(() => readTestInputs(STRUCTURE, { ...report, testResult: json('{"variables":3}') }, ITEM_MAP)).toThrow(
        DataError,
      );
      expect(() => readTestInputs(STRUCTURE, report, json("{}"))).toThrow(DataError);
      expect(() => readTestInputs(STRUCTURE, report, ITEM_MAP, json("null"))).toThrow(DataError);
      expect(() => readTestInputs(STRUCTURE, report, ITEM_MAP, json('{"variables":{}}'))).toThrow(DataError);
    });
  });
});

describe("rescoring a report", () => {
  it("gives the outcomes of the session when the content is unchanged, whatever was reached", () => {
    for (const seed of [1, 4, 6]) {
      for (const count of [0, 1, 2, 3, 4]) {
        const { engine, state } = sit(ITEMS, count, seed);
        const report = engine.results(state);
        expect(untimed(rescored(report, ITEM_MAP))).toEqual(untimed(state.outcomes));
        expect(untimed(rescored(report, ITEM_MAP, { corrected: new Set() }))).toEqual(untimed(state.outcomes));
      }
    }
  });

  it("gives the outcomes of a part that submits its items together, after jumps between the instances of an item", () => {
    const { engine, state } = jumped();
    expect(state.outcomes.get("LATEST")).toEqual(single("float", 1));
    const structure = structureOf(TOGETHER);
    expect(rescored(engine.results(state), ITEM_MAP, { structure })).toEqual(state.outcomes);
    expect(rescored(engine.results(state), ITEM_MAP, { structure, corrected: new Set() })).toEqual(state.outcomes);
  });

  it("scores a corrected key as an engine of the fixed item does with the same actions", () => {
    const fixed = { ...ITEMS, q1: keyed("q1", "C") };
    const before = sit(ITEMS, 4);
    const replay = sit(fixed, 4);
    const rescoredTotal = rescored(before.engine.results(before.state), new Map(Object.entries(fixed)), {
      corrected: new Set(["q1"]),
    });
    expect(untimed(rescoredTotal)).toEqual(untimed(replay.state.outcomes));
    expect(rescoredTotal.get("TOTAL")).not.toEqual(before.state.outcomes.get("TOTAL"));
  });

  it("keeps a key that template processing drew, and scores to a new one that the caller sets", () => {
    const { engine, state } = sit(ITEMS, 4);
    const report = engine.results(state);
    const drawn = resultOf(report, "d1");
    const template = drawn.variables.find((each) => each.kind === "template" && each.identifier === "N");
    const number =
      template?.kind === "template" && template.value?.cardinality === "single" ? template.value.value : undefined;
    // q1 scores 1, 0, 1 for the answers B, C, B; the answer 5 to d1 scores when the draw was 5.
    expect(rescored(report, ITEM_MAP).get("TOTAL")).toEqual(single("float", number === 5 ? 3 : 2));
    const fixed = rescored(report, ITEM_MAP, {
      fix: (variables, result) =>
        result.identifier === "d1"
          ? {
              ...variables,
              correctResponses: new Map(variables.correctResponses).set("RESPONSE", single("integer", 5)),
            }
          : variables,
    });
    expect(fixed.get("TOTAL")).toEqual(single("float", 3));
  });

  it("keeps an outcome that a scorer set, and takes the new value that the caller sets first", () => {
    const { engine, state } = sit(ITEMS, 2);
    const report = withTestVariable(engine.results(state), outcomeVar("THETA", "float", single("float", 2.5)));
    expect(rescored(report, ITEM_MAP).get("THETA")).toEqual(single("float", 2.5));
    const set = rescored(report, ITEM_MAP, { outcomes: (kept) => new Map(kept).set("THETA", single("float", 1)) });
    expect(set.get("THETA")).toEqual(single("float", 1));
  });

  it("starts every other outcome from its default, as the specification resets them", () => {
    const { engine, state } = sit(ITEMS, 2);
    const stale = withTestVariable(engine.results(state), outcomeVar("BONUS", "float", single("float", 99)));
    expect(rescored(stale, ITEM_MAP).get("BONUS")).toEqual(single("float", 5));
  });

  it("reads the duration of the test from the end of the session, which the last outcome processing may precede", () => {
    const { engine, state } = sit(ITEMS, 2);
    expect(state.outcomes.get("TIME")).toEqual(single("duration", 2.3));
    expect(rescored(engine.results(state), ITEM_MAP).get("TIME")).toEqual(single("duration", 3));
  });

  it("scores an instance not reached as the engine counts it, selected and nothing else", () => {
    const { engine, state } = sit(ITEMS, 1);
    const outcomes = rescored(engine.results(state), ITEM_MAP);
    expect(outcomes.get("SELECTED")).toEqual(single("integer", 4));
    expect(outcomes.get("TOTAL")).toEqual(single("float", 1));
  });

  it("scores a rescoring that runs a corrected item with fresh draws from the random source of the caller", () => {
    const { engine, state } = sit(ITEMS, 4);
    const report = engine.results(state);
    expect(untimed(rescored(report, ITEM_MAP, { seed: 99 }))).toEqual(untimed(state.outcomes));
  });
});

describe("properties", () => {
  it("reads a result or a report of any other shape with a DataError, and nothing else", () => {
    // Under the seed 4 the fourth instance is `d1`, whose result holds the key that template processing set.
    const { engine, state } = sit(ITEMS, 4);
    const report: AssessmentResult = JSON.parse(JSON.stringify(engine.results(state)));
    fuzzJson((json) => readTestInputs(STRUCTURE, json as AssessmentResult, ITEM_MAP), [report]);
    fuzzJson((json) => readItemVariables(ITEMS.d1 ?? fail("No item."), json as ItemResult), [resultOf(report, "d1")]);
  });

  it("reads the same inputs from a report that was written and read as from the report itself", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 0, max: 4 }), (seed, count) => {
        const { engine, state } = sit(ITEMS, count, seed);
        const report = engine.results(state);
        const stored = readResults(writeResults(report));
        expect(rescored(stored, ITEM_MAP)).toEqual(rescored(report, ITEM_MAP));
        expect(untimed(rescored(stored, ITEM_MAP))).toEqual(untimed(state.outcomes));
      }),
      { numRuns: 40 },
    );
  });
});
