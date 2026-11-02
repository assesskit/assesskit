import type { DeliveryEvent, DeliveryEventType } from "@assesskit/runtime/delivery";
import { mintUrn } from "@interopkit/learning-analytics";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type CaliperContext, caliperEvents, caliperGrade } from "../src/index.ts";
import { PARTIES } from "./rig.ts";

const START: CaliperContext = { session: "session-1", step: "start", ...PARTIES };
const LATER: CaliperContext = { ...START, step: 7 };
const AT = 1_700_000_000_000;
const ITEM = { ref: "q1", instance: 1 };

/** The Caliper event that each type of the runtime becomes, or `null` when it becomes none: the table of the README. */
const EXPECTED: Readonly<Record<DeliveryEventType, string | null>> = {
  presented: "AssessmentItemEvent Started",
  "responses-set": null,
  "attempt-ended": "AssessmentItemEvent Completed",
  "response-processed": null,
  "processing-failed": null,
  "outcome-processed": null,
  moved: "NavigationEvent NavigatedTo",
  "section-entered": "NavigationEvent NavigatedTo",
  "part-ended": null,
  "test-ended": "AssessmentEvent Submitted",
  "time-limit-passed": null,
  "time-out": null,
  "late-submission": null,
  suspended: "AssessmentEvent Paused",
  resumed: "AssessmentEvent Resumed",
  "support-changed": null,
  "variant-selected": null,
  "hazard-unavoidable": null,
  "scoring-requested": null,
  "scores-applied": null,
  "scores-replaced": null,
  "cat-requested": null,
  "cat-stage-added": null,
};
const TYPES = Object.keys(EXPECTED) as DeliveryEventType[];

const eventOf = (type: DeliveryEventType, at = AT, change: Partial<DeliveryEvent> = {}): DeliveryEvent => ({
  type,
  at,
  item: ITEM,
  scope: "main",
  ...change,
});

/** Returns the name of the error that a call throws: the runtime and interopkit each have a `DataError`. */
function thrownBy(call: () => unknown): string | undefined {
  try {
    call();
  } catch (error) {
    return error instanceof Error ? error.name : String(error);
  }
  return undefined;
}

const describeEvent = ({ type, action }: { type: string; action: string }): string => `${type} ${action}`;

describe("caliperEvents", () => {
  it("maps each type of the runtime to the Caliper event of the table, or to none", () => {
    for (const type of TYPES) {
      const mapped = caliperEvents([eventOf(type)], LATER).map(describeEvent);
      expect(mapped, type).toEqual(EXPECTED[type] === null ? [] : [EXPECTED[type]]);
    }
  });

  it("adds the AssessmentEvent Started before the events of the start step, dated by the first of them", () => {
    const events = caliperEvents([eventOf("section-entered", AT), eventOf("presented", AT + 1000)], START);
    expect(events.map(describeEvent)).toEqual([
      "AssessmentEvent Started",
      "NavigationEvent NavigatedTo",
      "AssessmentItemEvent Started",
    ]);
    expect(events[0]).toMatchObject({
      actor: { id: PARTIES.actor, type: "Person" },
      object: { id: PARTIES.assessment, type: "Assessment" },
      generated: {
        type: "Attempt",
        assignee: PARTIES.actor,
        assignable: PARTIES.assessment,
        startedAtTime: "2023-11-14T22:13:20.000Z",
      },
      eventTime: "2023-11-14T22:13:20.000Z",
      edApp: PARTIES.edApp,
      profile: "AssessmentProfile",
    });
    expect(caliperEvents([], START)).toEqual([]);
  });

  it("keeps the order of the events of the step, and adds no Started to a step that is not the start", () => {
    const events = caliperEvents([eventOf("presented"), eventOf("moved"), eventOf("attempt-ended")], LATER);
    expect(events.map(describeEvent)).toEqual([
      "AssessmentItemEvent Started",
      "NavigationEvent NavigatedTo",
      "AssessmentItemEvent Completed",
    ]);
  });

  it("closes the attempt at the test with Submitted, and leaves it open for Paused and Resumed", () => {
    const [submitted] = caliperEvents([eventOf("test-ended", AT + 5000)], LATER);
    expect(submitted?.generated).toMatchObject({ endedAtTime: "2023-11-14T22:13:25.000Z" });
    const [paused] = caliperEvents([eventOf("suspended")], LATER);
    expect(paused?.generated).not.toHaveProperty("endedAtTime");
    expect(paused?.generated).not.toHaveProperty("startedAtTime");
  });

  it("tells a skipped attempt from a completed one by the detail, and generates the attempt only for the skipped", () => {
    const [skipped, completed] = caliperEvents(
      [eventOf("attempt-ended", AT, { detail: "skip" }), eventOf("attempt-ended", AT, { detail: "submit" })],
      LATER,
    );
    expect(describeEvent(skipped ?? { type: "", action: "" })).toBe("AssessmentItemEvent Skipped");
    expect(skipped?.generated).toMatchObject({ type: "Attempt", endedAtTime: "2023-11-14T22:13:20.000Z" });
    expect(describeEvent(completed ?? { type: "", action: "" })).toBe("AssessmentItemEvent Completed");
    expect(completed?.generated).toBeUndefined();
  });

  it("names an item by the test and the item reference, the same in every session, and an attempt by its session", () => {
    const [first] = caliperEvents([eventOf("presented")], LATER);
    const [other] = caliperEvents([eventOf("presented")], { ...LATER, session: "session-2" });
    expect(first?.object).toMatchObject({ id: mintUrn(["item", PARTIES.assessment, "q1"]) });
    expect(other?.object).toMatchObject({ id: mintUrn(["item", PARTIES.assessment, "q1"]) });
    expect(first?.generated).toMatchObject({ id: mintUrn(["attempt", "session-1", "q1", 1]) });
    expect(other?.generated).toMatchObject({ id: mintUrn(["attempt", "session-2", "q1", 1]) });
    expect(first?.generated).toMatchObject({ isPartOf: mintUrn(["attempt", "session-1"]), assignee: PARTIES.actor });
    expect(first?.object).toMatchObject({ name: "q1", isPartOf: PARTIES.assessment });
  });

  it("names a section as an assessment that is part of the test", () => {
    const [entered] = caliperEvents([eventOf("section-entered", AT, { scope: "part-1" })], LATER);
    expect(entered?.object).toEqual({
      id: mintUrn(["section", PARTIES.assessment, "part-1"]),
      type: "Assessment",
      name: "part-1",
      isPartOf: PARTIES.assessment,
    });
  });

  it("gives an event the identifier of its session, step and position, as a UUID of a name", () => {
    const events = caliperEvents([eventOf("section-entered"), eventOf("presented")], {
      ...START,
      actor: "urn:uuid:0b9c4c4e-0d3c-4f8e-9a53-6d1b6f0d9a11",
    });
    expect(events.map(({ id }) => id)).toEqual([
      mintUrn(["event", "session-1", "start", -1]),
      mintUrn(["event", "session-1", "start", 0]),
      mintUrn(["event", "session-1", "start", 1]),
    ]);
    expect(events[2]?.id).toBe("urn:uuid:9d93048b-0080-5eca-9ee6-1ac13fb2c05a");
  });

  it("gives the same events for the same step and other identifiers for another step", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...TYPES), { maxLength: 8 }),
        fc.integer({ min: 0, max: 50 }),
        (types, step) => {
          const events = types.map((type, index) => eventOf(type, AT + index * 1000));
          const once = caliperEvents(events, { ...START, step });
          expect(caliperEvents(events, { ...START, step })).toEqual(once);
          const elsewhere = caliperEvents(events, { ...START, step: step + 1 });
          expect(elsewhere.map(({ id }) => id).filter((id) => once.some((each) => each.id === id))).toEqual([]);
        },
      ),
      { seed: 20_261_101, numRuns: 60 },
    );
  });

  it("refuses an event of a type the runtime does not have, and one that lacks what its Caliper event needs", () => {
    expect(() => caliperEvents([{ type: "presented", at: AT }], LATER)).toThrow("must name its item as an object");
    const refused: (() => unknown)[] = [
      () => caliperEvents([JSON.parse('{"type":"nonsense","at":1}')], LATER),
      () => caliperEvents([JSON.parse('{"type":"__proto__","at":1}')], LATER),
      () => caliperEvents([{ type: "presented", at: AT }], LATER),
      () => caliperEvents([{ type: "section-entered", at: AT }], LATER),
      () => caliperEvents([eventOf("presented", Number.NaN)], LATER),
      () => caliperEvents([eventOf("presented", -1)], LATER),
      () => caliperEvents(JSON.parse("null"), LATER),
      () => caliperEvents([JSON.parse("5")], LATER),
    ];
    for (const call of refused) expect(thrownBy(call)).toBe("DataError");
  });
});

describe("caliperGrade", () => {
  const grade = {
    index: 2,
    at: AT,
    scoreGiven: 3,
    maxScore: 4,
    scorer: "human",
    scoredBy: "https://rater.example/raters/17",
  } as const;

  it("builds the GradeEvent Graded of the Grading Profile for the attempt at the test", () => {
    const event = caliperGrade(grade, LATER);
    expect(event).toMatchObject({
      type: "GradeEvent",
      profile: "GradingProfile",
      action: "Graded",
      actor: { id: grade.scoredBy, type: "Person" },
      object: { id: mintUrn(["attempt", "session-1"]), type: "Attempt", assignable: PARTIES.assessment },
      generated: {
        type: "Score",
        scoreGiven: 3,
        maxScore: 4,
        scoredBy: grade.scoredBy,
        dateCreated: "2023-11-14T22:13:20.000Z",
      },
      eventTime: "2023-11-14T22:13:20.000Z",
    });
    expect(event.generated).toMatchObject({
      id: mintUrn(["score", "session-1", 7, 2]),
      attempt: mintUrn(["attempt", "session-1"]),
    });
    expect(event.id).toBe(mintUrn(["event", "session-1", 7, 2]));
  });

  it("grades the attempt at an item when it names one, and a scoring service is a software application", () => {
    const event = caliperGrade({ ...grade, item: ITEM, scorer: "externalMachine", maxScore: undefined }, LATER);
    expect(event.object).toMatchObject({ id: mintUrn(["attempt", "session-1", "q1", 1]), type: "Attempt" });
    expect(event.actor).toMatchObject({ type: "SoftwareApplication" });
    expect(event.generated).not.toHaveProperty("maxScore");
  });

  it("gives the same identifiers when the step is reported again", () => {
    expect(caliperGrade(grade, LATER)).toEqual(caliperGrade(grade, LATER));
  });

  it("refuses a scorer that is no IRI and a time that Caliper cannot write", () => {
    expect(thrownBy(() => caliperGrade({ ...grade, scoredBy: "rater-17" }, LATER))).toBe("DataError");
    expect(thrownBy(() => caliperGrade({ ...grade, at: Number.POSITIVE_INFINITY }, LATER))).toBe("DataError");
  });
});
