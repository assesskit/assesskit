import { readScoringRubrics } from "@assesskit/runtime/asi";
import { type DeliveryState, type ScorerView, type ScoringRequest, viewToJson } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { container, fromWireValue, record, single, type Value } from "@assesskit/runtime/values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import scoringGuide from "../../../docs/player/scoring.md?raw";
import { checkSubmission, type Submission } from "../src/protocol/index.js";
import { toSubmission, toSupplyScores } from "../src/scoring/index.js";
import { runGuideSamples } from "./guide-samples.js";
import {
  accepted,
  act,
  answer,
  begin,
  covers,
  essay,
  fail,
  firstScorerView,
  itemEngine,
  pick,
  play,
  RUBRIC_WORD,
  rubricMarkup,
  write,
  writingEngine,
} from "./scoring-fixture.js";

/** Parses JSON text, so that a test passes input as JavaScript or JSON delivers it. */
const json = (text: string): unknown => JSON.parse(text);

/** The scorer view of the essay `e` after the candidate wrote and submitted. */
function essayView(text = "Dear Sir"): { view: ScorerView; state: DeliveryState } {
  const engine = itemEngine(essay("e"));
  const state = play(engine, begin(engine), write("e", text, 1_000), act("submit", "e", 2_000));
  return { view: firstScorerView(engine, state), state };
}

/** A single value in the runtime's wire form, whose `value` is the JSON of BPIG Appendix C: `{ "base": { "<base type>": <value> } }`. */
const wire = (baseType: string, value: unknown): unknown => ({
  cardinality: "single",
  baseType,
  value: { base: { [baseType]: value } },
});

/** The writing test: two essays that the outcome `WRITING` covers, with labels and notes for the rater. */
const WRITING = covers(
  "WRITING",
  [
    ["w1", "Task 1: essay"],
    ["w2", "Task 2: letter"],
  ],
  "<p>Rate the content once, across both tasks.</p>",
);

describe("toSubmission", () => {
  it("turns the request of an item outcome into one outcome, with its covers, body and keys", () => {
    const { view } = essayView();
    const submission = toSubmission(view);
    expect(submission).toMatchObject({
      request: "item:e:1:SCORE",
      outcome: "SCORE",
      mode: "human",
      declaration: {
        cardinality: "single",
        baseType: "float",
        normalMinimum: 0,
        normalMaximum: 10,
        interpretation: "Essay score",
      },
      requestedAt: 2_000,
      rubric: [],
      parts: [
        {
          item: { ref: "e", instance: 1 },
          responseIdentifier: "RESPONSE",
          presented: true,
          interaction: "extended-text-interaction",
          value: wire("string", "Dear Sir"),
        },
      ],
      items: [{ key: { ref: "e", instance: 1 }, title: "Item e", presented: true, templateValues: [] }],
    });
    // The correct response of a response without a key is NULL, which the submission writes as null.
    expect(submission.items[0]?.correctResponses).toEqual([{ identifier: "RESPONSE", value: null }]);
    expect(submission.supplied).toBeUndefined();
    expect(submission.lti).toBeUndefined();
    expect(submission.variableIdentifierRef).toBeUndefined();
  });

  it("carries the body as the candidate saw it, followed by the rubric blocks that only the scorer sees", () => {
    const text = JSON.stringify(toSubmission(essayView().view).items[0]?.body);
    expect(text.indexOf("Write about e.")).toBeGreaterThan(-1);
    expect(text.indexOf("Give 0 to 10 points for e.")).toBeGreaterThan(text.indexOf("Write about e."));
  });

  it("lists each cover of a test outcome in order with its label, and an item that was not presented empty", () => {
    const engine = writingEngine({ w1: essay("w1", "none"), w2: essay("w2", "none") }, WRITING);
    const first = play(engine, begin(engine), write("w1", "First task", 1_000), act("submit", "w1", 2_000));
    const ended = play(engine, first, { type: "end-test", at: 3_000 });
    const submission = toSubmission(firstScorerView(engine, ended));
    expect(submission).toMatchObject({ request: "test:WRITING", outcome: "WRITING", requestedAt: 3_000 });
    expect(submission.declaration).toEqual({
      cardinality: "single",
      baseType: "float",
      normalMaximum: 6,
      masteryValue: 4,
    });
    expect(submission.parts.map(({ item, label, presented, value }) => [item.ref, label, presented, value])).toEqual([
      ["w1", "Task 1: essay", true, wire("string", "First task")],
      ["w2", "Task 2: letter", false, null],
    ]);
    expect(submission.items.map(({ key: { ref }, presented, body }) => [ref, presented, body.length > 0])).toEqual([
      ["w1", true, true],
      ["w2", false, false],
    ]);
    expect(submission.items[1]).toMatchObject({ templateValues: [], correctResponses: [] });
    // The notes of the covers block are the rubric of the rater.
    expect(JSON.stringify(submission.rubric)).toContain("Rate the content once, across both tasks.");
  });

  it("carries the scoring rubric of an item outcome, as the runtime reads it from the item, and leaves it out when there is none", () => {
    const rated = essay("e", "human", rubricMarkup("SCORE"));
    const engine = itemEngine(rated);
    const state = play(engine, begin(engine), write("e", "Dear Sir", 1_000), act("submit", "e", 2_000));
    const submission = toSubmission(firstScorerView(engine, state));
    expect(submission.scoringRubric).toEqual(readScoringRubrics(rated).get("SCORE"));
    expect(submission.scoringRubric).toMatchObject({ kind: "holistic", language: "en" });
    expect(submission.scoringRubric?.criteria[0]?.description).toBe(`How well the ${RUBRIC_WORD} are organized.`);
    const parsed = json(JSON.stringify(submission)) as Submission;
    expect(() => checkSubmission(parsed)).not.toThrow();
    expect(parsed).toEqual(submission);
    expect("scoringRubric" in essayView().view).toBe(false);
    expect("scoringRubric" in toSubmission(essayView().view)).toBe(false);
  });

  it("carries the scoring rubric of a test outcome, and none of the rubrics of its items", () => {
    const engine = writingEngine(
      { w1: essay("w1", "none"), w2: essay("w2", "none") },
      WRITING + rubricMarkup("WRITING"),
    );
    const ended = play(engine, begin(engine), { type: "end-test", at: 1_000 });
    const submission = toSubmission(firstScorerView(engine, ended));
    expect(submission.scoringRubric).toMatchObject({ outcomeIdentifier: "WRITING", kind: "holistic" });
    expect(submission.scoringRubric?.criteria[0]?.levels.map(({ score }) => score)).toEqual([0, 3, 6]);
    expect(() => checkSubmission(json(JSON.stringify(submission)))).not.toThrow();
  });

  it("keeps the text of a scoring rubric out of the view of the candidate", () => {
    const engine = itemEngine(essay("e", "human", rubricMarkup("SCORE")));
    const started = begin(engine);
    const state = play(engine, started, write("e", "Dear Sir", 1_000), act("submit", "e", 2_000));
    for (const text of [
      JSON.stringify(viewToJson(engine.view(started, 0))),
      JSON.stringify(viewToJson(engine.view(state, 3_000))),
    ]) {
      expect(text).not.toContain(RUBRIC_WORD);
      expect(text).not.toContain("Clear order.");
    }
  });

  it("gives the correct responses and the template values of an item as wire values", () => {
    const engine = itemEngine(pick("p"));
    const state = play(engine, begin(engine), answer("p", single("identifier", "A"), 1_000), act("submit", "p", 2_000));
    const [item] = toSubmission(firstScorerView(engine, state)).items;
    expect(item?.correctResponses).toEqual([{ identifier: "RESPONSE", value: wire("identifier", "B") }]);
    expect(item?.templateValues).toEqual([{ identifier: "N", value: wire("integer", 4) }]);
    expect(JSON.stringify(item?.body)).toContain("Choose the letter for");
  });

  it("carries the value supplied before, with its time and scorer", () => {
    const engine = itemEngine(essay("e"));
    const { state } = essayView();
    const [request] = engine.pending(state).scoring;
    const scored = play(engine, state, {
      ...toSupplyScores(request ?? fail("No request waits."), 7.5, "human"),
      at: 3_000,
    });
    const submission = toSubmission(engine.scorerView(scored, "item:e:1:SCORE"));
    expect(submission.supplied).toEqual({
      value: wire("float", 7.5),
      at: 3_000,
      scorer: "human",
    });
  });

  it("carries the variable reference and the flag of a link to a tool", () => {
    const { view } = essayView();
    const linked: ScorerView = {
      ...view,
      request: { ...view.request, variableIdentifierRef: "http://example.org/ref", lti: true },
    };
    expect(toSubmission(linked)).toMatchObject({ variableIdentifierRef: "http://example.org/ref", lti: true });
  });

  it("keeps a file as a reference that the host resolves, and NULL as null", () => {
    const { view } = essayView();
    const file = single("file", { reference: "uploads/a1", mimeType: "audio/wav", fileName: "speech.wav" });
    const [cover] = view.request.covers;
    const filed: ScorerView = {
      ...view,
      request: { ...view.request, covers: [{ ...(cover ?? fail("No cover.")), response: file }] },
    };
    expect(toSubmission(filed).parts[0]?.value).toEqual(
      wire("file", { reference: "uploads/a1", mime: "audio/wav", name: "speech.wav" }),
    );
    const empty: ScorerView = {
      ...view,
      request: { ...view.request, covers: [{ ...(cover ?? fail("No cover.")), response: null }] },
    };
    expect(toSubmission(empty).parts[0]?.value).toBeNull();
  });

  it("is JSON as it is: parsing its text gives it back, and the check accepts it", () => {
    const submission = toSubmission(essayView("Line one\nLine two").view);
    const parsed: unknown = json(JSON.stringify(submission));
    expect(parsed).toEqual(submission);
    expect(() => checkSubmission(parsed)).not.toThrow();
  });

  it("rejects what is not a scorer view of the engine", () => {
    expect(() => toSubmission(json("null") as ScorerView)).toThrow(
      new DataError("The scorer view must be an object, found null."),
    );
    expect(() => toSubmission(json("{}") as ScorerView)).toThrow(
      new DataError("The request of the scorer view must be an object, found undefined."),
    );
    const { view } = essayView();
    const parsed = json(JSON.stringify(view)) as ScorerView;
    // JSON turns the maps of the items into objects.
    expect(() => toSubmission(parsed)).toThrow(
      new DataError("The templateValues of an item of the scorer view must be a Map, found an object."),
    );
    expect(() => toSubmission({ ...view, items: json("{}") as ScorerView["items"] })).toThrow(
      new DataError("The items of the scorer view must be an array, found an object."),
    );
    expect(() => toSubmission({ ...view, rubric: json('"x"') as ScorerView["rubric"] })).toThrow(
      new DataError('The rubric of the scorer view must be an array, found "x".'),
    );
    expect(() =>
      toSubmission({ ...view, request: { ...view.request, covers: json("[null]") as ScoringRequest["covers"] } }),
    ).toThrow(new DataError("A cover of the scorer view must be an object, found null."));
    expect(() => toSubmission({ ...view, request: { ...view.request, id: json("5") as string } })).toThrow(
      new DataError("A submission is invalid at request: expected a string, found 5."),
    );
  });
});

/** The request of the essay, which waits for a score. */
function essayRequest(): ScoringRequest {
  const engine = itemEngine(essay("e"));
  const { state } = essayView();
  return engine.pending(state).scoring[0] ?? fail("No request waits.");
}

describe("toSupplyScores", () => {
  const request = essayRequest();

  it("builds the action with one value, the id of the request and the scorer", () => {
    const value = single("float", 7.5);
    expect(toSupplyScores(request, value, "human")).toEqual({
      type: "supply-scores",
      request: "item:e:1:SCORE",
      value,
      scorer: "human",
    });
    expect(toSupplyScores(request, value, "externalMachine").scorer).toBe("externalMachine");
  });

  it("takes a number as a single value of the base type of the outcome", () => {
    expect(toSupplyScores(request, 7.5, "human").value).toEqual(single("float", 7.5));
    expect(toSupplyScores(request, 0, "human").value).toEqual(single("float", 0));
  });

  it("promotes an integer value to the float outcome, as the engine does", () => {
    expect(toSupplyScores(request, single("integer", 7), "human").value).toEqual(single("float", 7));
  });

  it("takes a string, a boolean and an identifier for the outcomes of those base types", () => {
    const declared = (baseType: "string" | "boolean" | "identifier" | "integer"): ScoringRequest => ({
      ...request,
      declaration: { cardinality: "single", baseType },
    });
    expect(toSupplyScores(declared("string"), "good", "human").value).toEqual(single("string", "good"));
    expect(toSupplyScores(declared("boolean"), true, "human").value).toEqual(single("boolean", true));
    expect(toSupplyScores(declared("identifier"), "PASS", "human").value).toEqual(single("identifier", "PASS"));
    expect(toSupplyScores(declared("integer"), 3, "human").value).toEqual(single("integer", 3));
  });

  it("accepts NULL, and the empty string, which is NULL", () => {
    expect(toSupplyScores(request, null, "human").value).toBeNull();
    const text: ScoringRequest = { ...request, declaration: { cardinality: "single", baseType: "string" } };
    expect(toSupplyScores(text, "", "human").value).toBeNull();
  });

  it("checks a value against the declaration before the engine does", () => {
    expect(() => toSupplyScores(request, single("string", "good"), "human")).toThrow(
      new DataError("The outcome SCORE is a single float, found a single string."),
    );
    expect(() => toSupplyScores(request, container("multiple", "float", [1, 2]) ?? null, "human")).toThrow(
      new DataError("The outcome SCORE is a single float, found a multiple float."),
    );
    expect(() => toSupplyScores(request, record([["a", single("integer", 1)]]) ?? null, "human")).toThrow(
      new DataError("The outcome SCORE is a single float, found a record."),
    );
    const integer: ScoringRequest = { ...request, declaration: { cardinality: "single", baseType: "integer" } };
    expect(() => toSupplyScores(integer, single("float", 1.5), "human")).toThrow(
      new DataError("The outcome SCORE is a single integer, found a single float."),
    );
  });

  it("refuses a number, a string or a boolean for an outcome that is not single, or not of that base type", () => {
    const many: ScoringRequest = { ...request, declaration: { cardinality: "multiple", baseType: "float" } };
    expect(() => toSupplyScores(many, 1, "human")).toThrow(
      /^The outcome SCORE is a multiple float, which a number does not fit: give a value that the values of the runtime build\.$/,
    );
    // the runtime checks a plain value against the base type, and its DataError passes through.
    expect(() => toSupplyScores(request, "good", "human")).toThrow(
      'A value of base type float must be a number, found "good".',
    );
    expect(() => toSupplyScores(request, true, "human")).toThrow(
      "A value of base type float must be a number, found true.",
    );
  });

  it("accepts a value for a multiple outcome that has the cardinality and the base type", () => {
    const many: ScoringRequest = { ...request, declaration: { cardinality: "multiple", baseType: "identifier" } };
    const value = container("multiple", "identifier", ["a", "b"]);
    expect(toSupplyScores(many, value, "human").value).toEqual(value);
  });

  it("rejects a request, a scorer or a score of another type", () => {
    expect(() => toSupplyScores(json("null") as ScoringRequest, 1, "human")).toThrow(
      new DataError("The request must be an object, found null."),
    );
    expect(() => toSupplyScores({ ...request, id: json("5") as string }, 1, "human")).toThrow(
      new DataError("The id of the request must be a non-empty string, found 5."),
    );
    expect(() =>
      toSupplyScores({ ...request, declaration: json('{"cardinality":"single"}') as never }, 1, "human"),
    ).toThrow(/^The declaration of a submission is invalid: missing the property "baseType"/);
    expect(() => toSupplyScores(request, 1, json('"robot"') as "human")).toThrow(
      new DataError('The scorer must be "human" or "externalMachine", found "robot".'),
    );
    expect(() => toSupplyScores(request, json("{}") as Value, "human")).toThrow(DataError);
    expect(() => toSupplyScores(request, json("[1]") as unknown as number, "human")).toThrow(DataError);
  });

  it("is accepted by the engine after the test ended, and supplying again replaces the score", () => {
    const engine = writingEngine({ w1: essay("w1", "none"), w2: essay("w2", "none") }, WRITING);
    const first = play(engine, begin(engine), write("w1", "First task", 1_000), act("submit", "w1", 2_000));
    const ended = play(engine, first, { type: "end-test", at: 3_000 });
    expect(ended.status).toBe("ended");
    const [pending] = engine.pending(ended).scoring;
    const open = pending ?? fail("No request waits.");

    const scored = accepted(engine.apply(ended, { ...toSupplyScores(open, 3, "human"), at: 4_000 }));
    expect(scored.events.map(({ type }) => type)).toContain("scores-applied");
    expect(engine.pending(scored.state).scoring).toEqual([]);
    expect(
      engine.results(scored.state).testResult?.variables.find(({ identifier }) => identifier === "WRITING"),
    ).toMatchObject({
      value: single("float", 3),
    });

    const replaced = accepted(
      engine.apply(scored.state, { ...toSupplyScores(open, 5.5, "externalMachine"), at: 5_000 }),
    );
    expect(replaced.events.map(({ type }) => type)).toContain("scores-replaced");
    const request = replaced.state.scoring.find(({ id }) => id === open.id);
    expect(request?.supplied).toEqual({ value: single("float", 5.5), at: 5_000, scorer: "externalMachine" });
  });

  it("is refused by the engine when the request does not exist", () => {
    const engine = itemEngine(essay("e"));
    const { state } = essayView();
    const stray: ScoringRequest = { ...essayRequest(), id: "item:other:1:SCORE" };
    const step = engine.apply(state, { ...toSupplyScores(stray, 1, "human"), at: 3_000 });
    expect(step.ok ? "accepted" : step.refusal.code).toBe("unknown-request");
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const modules = {
      "@assesskit/player/scoring": await import("../src/scoring/index.js"),
      "@assesskit/runtime/asi": await import("@assesskit/runtime/asi"),
      "@assesskit/runtime/delivery": await import("@assesskit/runtime/delivery"),
      "@assesskit/runtime/values": await import("@assesskit/runtime/values"),
    };
    expect(await runGuideSamples(scoringGuide, modules)).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  const EssayRequest = essayRequest();

  it("takes a submission from the engine to a score and back: values decode as the candidate gave them, and the last score stands", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, unit: "binary" }),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        (text, first, second) => {
          const engine = itemEngine(essay("e"));
          const state = play(engine, begin(engine), write("e", text, 1_000), act("submit", "e", 2_000));
          const [request] = engine.pending(state).scoring;
          const open = request ?? fail("No request waits.");
          const submission: Submission = json(
            JSON.stringify(toSubmission(engine.scorerView(state, open.id))),
          ) as Submission;
          checkSubmission(submission);
          expect(submission.request).toBe(open.id);
          expect(fromWireValue(submission.parts[0]?.value)).toEqual(single("string", text));

          const scored = accepted(engine.apply(state, { ...toSupplyScores(open, first, "human"), at: 3_000 }));
          expect(engine.pending(scored.state).scoring).toEqual([]);
          const again = accepted(engine.apply(scored.state, { ...toSupplyScores(open, second, "human"), at: 4_000 }));
          expect(again.events.map(({ type }) => type)).toContain("scores-replaced");
          const supplied = again.state.scoring.find(({ id }) => id === open.id)?.supplied;
          expect(supplied?.value).toEqual(single("float", second));
          // The submission read again carries the score that stands.
          const after = toSubmission(engine.scorerView(again.state, open.id));
          expect(fromWireValue(after.supplied?.value ?? null)).toEqual(single("float", second));
        },
      ),
      { seed: 20_261_030, numRuns: 100 },
    );
  });

  const primitive = fc.oneof(
    fc.record({ baseType: fc.constant("boolean" as const), value: fc.boolean() }),
    fc.record({ baseType: fc.constant("integer" as const), value: fc.integer() }),
    fc.record({ baseType: fc.constant("float" as const), value: fc.double({ noNaN: true }) }),
    fc.record({ baseType: fc.constant("string" as const), value: fc.string({ minLength: 1, unit: "binary" }) }),
    fc.record({ baseType: fc.constant("point" as const), value: fc.tuple(fc.integer(), fc.integer()) }),
    fc.record({
      baseType: fc.constant("file" as const),
      value: fc.record({
        reference: fc.string({ minLength: 1 }),
        mimeType: fc.constant("audio/wav"),
        fileName: fc.string(),
      }),
    }),
  );

  it("writes any value of a response so that it decodes to the value", () => {
    const { view } = essayView();
    const [cover] = view.request.covers;
    fc.assert(
      fc.property(
        primitive,
        fc.array(fc.integer(), { minLength: 1, maxLength: 4 }),
        fc.constantFrom("multiple" as const, "ordered" as const),
        ({ baseType, value }, integers, cardinality) => {
          const values: Value[] = [
            single(baseType, value) ?? fail("A value is not empty."),
            container(cardinality, "integer", integers) ?? fail("A container is not empty."),
          ];
          for (const response of values) {
            const built: ScorerView = {
              ...view,
              request: { ...view.request, covers: [{ ...(cover ?? fail("No cover.")), response }] },
            };
            const sent = json(JSON.stringify(toSubmission(built))) as Submission;
            const decoded = fromWireValue(sent.parts[0]?.value);
            expect(decoded).toEqual(response);
          }
        },
      ),
      { seed: 20_261_030, numRuns: 100 },
    );
  });

  it("gives a number to an outcome of the base type float as that float, and the key of the request", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (score) => {
        const action = toSupplyScores(EssayRequest, score, "human");
        expect(action).toEqual({
          type: "supply-scores",
          request: EssayRequest.id,
          value: single("float", score),
          scorer: "human",
        });
      }),
      { seed: 20_261_030, numRuns: 200 },
    );
  });
});
