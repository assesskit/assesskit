// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers and the terms of Caliper are those of their specifications.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readAsi } from "@assesskit/runtime/asi";
import {
  createEngine,
  type DeliveryEvent,
  type DeliveryEventType,
  type Engine,
  type ItemKey,
  type Step,
} from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { single } from "@assesskit/runtime/values";
import fc from "fast-check";
import { v5 } from "uuid";
import { describe, expect, it } from "vitest";
import {
  CALIPER_CONTEXT,
  type CaliperEvent,
  type CaliperEventType,
  type CaliperGrade,
  caliperEvents,
  caliperGrade,
  DEFAULT_CALIPER_TIMEOUT_MS,
  sendCaliper,
} from "../src/caliper/index.js";
import { caliperTime } from "../src/caliper/time.js";
import { CALIPER_NAMESPACE, mintUrn } from "../src/caliper/uuid.js";
import { ServiceError } from "../src/index.js";
import {
  ACTOR,
  APPLICATION,
  ASSESSMENT,
  contextAt,
  envelopeProblems,
  eventProblems,
  fakeEndpoint,
  SESSION,
  urnOf,
} from "./caliper-fixture.js";

const IDS = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "caliper-ids.json"), "utf8"));
const Q1: ItemKey = { ref: "q1", instance: 1 };
const Q2: ItemKey = { ref: "q2", instance: 1 };
const SECOND = 1000;

/** Returns a copy of a value as JSON passes it, for input that a host would send from JavaScript or JSON. */
const fromJson = <T>(text: string): T => JSON.parse(text);

/** The sensor options of the tests, which the tests change one property at a time. */
const SENDER = {
  endpoint: "https://lrs.example/caliper",
  token: "token-123",
  sensor: "https://exam.example/sensors/1",
  sendTime: 1_700_000_000_000,
};

/** The names of the event types of the runtime, each with what the Caliper mapping gives. */
const EXPECTED: Readonly<Record<DeliveryEventType, readonly [CaliperEventType, string] | null>> = {
  presented: ["AssessmentItemEvent", "Started"],
  "responses-set": null,
  "attempt-ended": ["AssessmentItemEvent", "Completed"],
  "response-processed": null,
  "processing-failed": null,
  "outcome-processed": null,
  moved: ["NavigationEvent", "NavigatedTo"],
  "section-entered": ["NavigationEvent", "NavigatedTo"],
  "part-ended": null,
  "test-ended": ["AssessmentEvent", "Submitted"],
  "time-limit-passed": null,
  "time-out": null,
  "late-submission": null,
  suspended: ["AssessmentEvent", "Paused"],
  resumed: ["AssessmentEvent", "Resumed"],
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

/** An event of the runtime of a type, with the fields that its type carries. */
function eventOf(type: DeliveryEventType, at = 5 * SECOND): DeliveryEvent {
  switch (type) {
    case "presented":
    case "moved":
    case "attempt-ended":
      return { type, at, item: Q1, ...(type === "attempt-ended" ? { detail: "submit" } : {}) };
    case "section-entered":
    case "test-ended":
      return { type, at, scope: "main" };
    default:
      return { type, at };
  }
}

describe("CALIPER_NAMESPACE", () => {
  it("is used with a library that gives the worked example of RFC 9562 Appendix A.4", () => {
    const { rfc9562 } = IDS;
    expect(v5(rfc9562.name, rfc9562.namespace)).toBe(rfc9562.uuid);
  });

  it("gives the UUIDs that Python's uuid5 gives for the names of the identifiers", () => {
    for (const { name, uuid } of IDS.names) expect(v5(name, CALIPER_NAMESPACE), name).toBe(uuid);
  });

  it("keeps the player's namespace the UUID of the address of the folder in the URL namespace", () => {
    expect(v5(IDS.address, v5.URL)).toBe(CALIPER_NAMESPACE);
    expect(CALIPER_NAMESPACE).toBe(IDS.namespace);
  });
});

describe("mintUrn", () => {
  it("writes the URN of the UUID that names the JSON text of the parts", () => {
    expect(mintUrn(["event", SESSION, "start", 0])).toBe(urnOf("event", SESSION, "start", 0));
    expect(mintUrn(["event", SESSION, 3, 0])).toBe(urnOf("event", SESSION, 3, 0));
  });

  it("names parts that a plain join would confuse by different identifiers", () => {
    const confusable = [
      urnOf("event", "a\nb", "start", 0),
      urnOf("event", "a", "\nb", 0),
      urnOf("event", "1", 1, 1),
      urnOf("event", 1, "1", 1),
    ];
    expect(new Set(confusable).size).toBe(confusable.length);
  });

  it("keeps text outside ASCII and the characters JSON escapes as they are in the name", () => {
    expect(mintUrn(["event", "café ✓", "start", 0])).toBe(urnOf("event", "café ✓", "start", 0));
    expect(mintUrn(["event", 'a"b\\c', 7, 12])).toBe(urnOf("event", 'a"b\\c', 7, 12));
  });
});

describe("caliperTime", () => {
  it("writes millisecond precision in UTC, as Caliper 1.2 §2.1 requires", () => {
    expect(caliperTime(0, "The time")).toBe("1970-01-01T00:00:00.000Z");
    expect(caliperTime(1_700_000_000_123, "The time")).toBe("2023-11-14T22:13:20.123Z");
    expect(caliperTime(253_402_300_799_999, "The time")).toBe("9999-12-31T23:59:59.999Z");
  });

  it("truncates a fraction of a millisecond, as a deadline may have one", () => {
    expect(caliperTime(1000.9, "The time")).toBe("1970-01-01T00:00:01.000Z");
  });

  it("rejects times that the form cannot write, and other types", () => {
    for (const bad of [
      -1,
      253_402_300_800_000,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      fromJson('"5"'),
      fromJson("null"),
    ]) {
      expect(() => caliperTime(bad, "The time of the event"), String(bad)).toThrow(DataError);
    }
    expect(() => caliperTime(-1, "The time of the event")).toThrow(
      "The time of the event must be epoch milliseconds from 1970 to the end of the year 9999, found -1.",
    );
  });
});

describe("caliperEvents", () => {
  describe("the step of Engine.start", () => {
    it("gives the AssessmentEvent Started, then an event for each event of the runtime", () => {
      const events: DeliveryEvent[] = [
        { type: "section-entered", at: SECOND, scope: "main" },
        { type: "presented", at: SECOND, item: Q1 },
      ];
      const produced = caliperEvents(events, contextAt("start"));
      const time = "1970-01-01T00:00:01.000Z";
      const attempt = urnOf("attempt", SESSION);
      const item = urnOf("item", ASSESSMENT, "q1");
      expect(produced).toEqual([
        {
          "@context": CALIPER_CONTEXT,
          id: urnOf("event", SESSION, "start", -1),
          type: "AssessmentEvent",
          profile: "AssessmentProfile",
          actor: { id: ACTOR, type: "Person" },
          action: "Started",
          object: { id: ASSESSMENT, type: "Assessment" },
          generated: { id: attempt, type: "Attempt", assignee: ACTOR, assignable: ASSESSMENT, startedAtTime: time },
          eventTime: time,
          edApp: APPLICATION,
        },
        {
          "@context": CALIPER_CONTEXT,
          id: urnOf("event", SESSION, "start", 0),
          type: "NavigationEvent",
          profile: "AssessmentProfile",
          actor: { id: ACTOR, type: "Person" },
          action: "NavigatedTo",
          object: {
            id: urnOf("section", ASSESSMENT, "main"),
            type: "Assessment",
            name: "main",
            isPartOf: ASSESSMENT,
          },
          eventTime: time,
          edApp: APPLICATION,
        },
        {
          "@context": CALIPER_CONTEXT,
          id: urnOf("event", SESSION, "start", 1),
          type: "AssessmentItemEvent",
          profile: "AssessmentProfile",
          actor: { id: ACTOR, type: "Person" },
          action: "Started",
          object: { id: item, type: "AssessmentItem", name: "q1", isPartOf: ASSESSMENT },
          generated: {
            id: urnOf("attempt", SESSION, "q1", 1),
            type: "Attempt",
            assignee: ACTOR,
            assignable: item,
            isPartOf: attempt,
            startedAtTime: time,
          },
          eventTime: time,
          edApp: APPLICATION,
        },
      ]);
    });

    it("gives no Started for a start step without events, which has no time to give it", () => {
      expect(caliperEvents([], contextAt("start"))).toEqual([]);
    });

    it("gives Started only to the step of the start", () => {
      const produced = caliperEvents([eventOf("section-entered")], contextAt(0));
      expect(produced.map(({ type, action }) => `${type} ${action}`)).toEqual(["NavigationEvent NavigatedTo"]);
    });
  });

  describe("the events of a session", () => {
    it("gives Submitted with the end of the attempt at the test", () => {
      const [submitted] = caliperEvents([{ type: "test-ended", at: 9 * SECOND, scope: "quiz" }], contextAt(4));
      expect(submitted).toEqual({
        "@context": CALIPER_CONTEXT,
        id: urnOf("event", SESSION, 4, 0),
        type: "AssessmentEvent",
        profile: "AssessmentProfile",
        actor: { id: ACTOR, type: "Person" },
        action: "Submitted",
        object: { id: ASSESSMENT, type: "Assessment" },
        generated: {
          id: urnOf("attempt", SESSION),
          type: "Attempt",
          assignee: ACTOR,
          assignable: ASSESSMENT,
          endedAtTime: "1970-01-01T00:00:09.000Z",
        },
        eventTime: "1970-01-01T00:00:09.000Z",
        edApp: APPLICATION,
      });
    });

    it("gives Paused and Resumed the attempt at the test, with no change of its times", () => {
      const produced = caliperEvents([eventOf("suspended"), eventOf("resumed")], contextAt(2));
      expect(produced.map(({ action }) => action)).toEqual(["Paused", "Resumed"]);
      for (const event of produced) {
        expect(event.generated).toEqual({
          id: urnOf("attempt", SESSION),
          type: "Attempt",
          assignee: ACTOR,
          assignable: ASSESSMENT,
        });
      }
    });

    it("gives Completed for an attempt that ended in any way but a skip, with no response", () => {
      for (const detail of ["submit", "end-attempt", "close", undefined]) {
        const event: DeliveryEvent = { type: "attempt-ended", at: 6 * SECOND, item: Q2, ...(detail ? { detail } : {}) };
        const [completed] = caliperEvents([event], contextAt(1));
        expect(completed, String(detail)).toEqual({
          "@context": CALIPER_CONTEXT,
          id: urnOf("event", SESSION, 1, 0),
          type: "AssessmentItemEvent",
          profile: "AssessmentProfile",
          actor: { id: ACTOR, type: "Person" },
          action: "Completed",
          object: { id: urnOf("item", ASSESSMENT, "q2"), type: "AssessmentItem", name: "q2", isPartOf: ASSESSMENT },
          eventTime: "1970-01-01T00:00:06.000Z",
          edApp: APPLICATION,
        });
      }
    });

    it("gives Skipped for an attempt that ended by a skip, with the attempt it ended", () => {
      const event: DeliveryEvent = { type: "attempt-ended", at: 6 * SECOND, item: Q2, detail: "skip" };
      const [skipped] = caliperEvents([event], contextAt(1));
      expect(skipped?.action).toBe("Skipped");
      expect(skipped?.generated).toEqual({
        id: urnOf("attempt", SESSION, "q2", 1),
        type: "Attempt",
        assignee: ACTOR,
        assignable: urnOf("item", ASSESSMENT, "q2"),
        isPartOf: urnOf("attempt", SESSION),
        endedAtTime: "1970-01-01T00:00:06.000Z",
      });
    });

    it("gives NavigatedTo to the item that the candidate moved to", () => {
      const [moved] = caliperEvents([{ type: "moved", at: 7 * SECOND, item: Q2 }], contextAt(3));
      expect(moved).toMatchObject({
        type: "NavigationEvent",
        action: "NavigatedTo",
        object: { id: urnOf("item", ASSESSMENT, "q2"), type: "AssessmentItem", name: "q2", isPartOf: ASSESSMENT },
        eventTime: "1970-01-01T00:00:07.000Z",
      });
    });

    it("names an item by its reference and a second instance of it by its own attempt", () => {
      const again: DeliveryEvent = { type: "presented", at: SECOND, item: { ref: "q2", instance: 2 } };
      const [event] = caliperEvents([again], contextAt(1));
      expect(event?.object.id).toBe(urnOf("item", ASSESSMENT, "q2"));
      expect(event?.generated?.id).toBe(urnOf("attempt", SESSION, "q2", 2));
    });

    it("keeps the order of the events of the runtime and drops those Caliper has no event for", () => {
      const events = [
        eventOf("attempt-ended"),
        eventOf("response-processed"),
        eventOf("outcome-processed"),
        eventOf("moved"),
        eventOf("presented"),
      ];
      const produced = caliperEvents(events, contextAt(5));
      expect(produced.map(({ type, action }) => `${type} ${action}`)).toEqual([
        "AssessmentItemEvent Completed",
        "NavigationEvent NavigatedTo",
        "AssessmentItemEvent Started",
      ]);
      expect(produced.map(({ id }) => id)).toEqual([
        urnOf("event", SESSION, 5, 0),
        urnOf("event", SESSION, 5, 3),
        urnOf("event", SESSION, 5, 4),
      ]);
    });
  });

  describe("every type of the runtime", () => {
    it("gives the Caliper event of the Assessment Profile for the types it has one for, and none for the others", () => {
      for (const type of TYPES) {
        const produced = caliperEvents([eventOf(type)], contextAt(2));
        const expected = EXPECTED[type];
        expect(
          produced.map((event) => [event.type, event.action]),
          type,
        ).toEqual(expected === null ? [] : [expected]);
      }
    });

    it("writes events that the published Caliper context accepts", () => {
      const produced = caliperEvents([...TYPES.map((type) => eventOf(type))], contextAt("start"));
      expect(produced.length).toBeGreaterThan(6);
      for (const event of produced) expect(eventProblems(event), event.id).toEqual([]);
    });

    it("writes the actions and objects that the Assessment Profile allows for each event", () => {
      const allowed: Readonly<Record<string, { actions: string[]; objects: string[] }>> = {
        AssessmentEvent: {
          actions: ["Started", "Paused", "Resumed", "Restarted", "Reset", "Submitted"],
          objects: ["Assessment"],
        },
        AssessmentItemEvent: { actions: ["Started", "Skipped", "Completed"], objects: ["AssessmentItem"] },
        NavigationEvent: { actions: ["NavigatedTo"], objects: ["Assessment", "AssessmentItem"] },
      };
      const events = [...TYPES.map((type) => eventOf(type)), { ...eventOf("attempt-ended"), detail: "skip" }];
      for (const event of caliperEvents(events, contextAt("start"))) {
        const rule = allowed[event.type];
        expect(rule?.actions, event.id).toContain(event.action);
        expect(rule?.objects, event.id).toContain(event.object.type);
        expect(event.profile).toBe("AssessmentProfile");
        expect(event.actor.type).toBe("Person");
      }
    });
  });

  describe("entities", () => {
    // The properties that Caliper 1.2 Appendix B gives each type of entity, with those of its parent types (Entity, Agent,
    // DigitalResource and AssignableDigitalResource), and the isPartOf that §3.2 allows an Attempt.
    const BASE = ["id", "type", "name", "description", "dateCreated", "dateModified", "otherIdentifiers", "extensions"];
    const RESOURCE = [
      ...BASE,
      "isPartOf",
      "creators",
      "mediaType",
      "datePublished",
      "keywords",
      "learningObjectives",
      "version",
    ];
    const ASSIGNABLE = [
      ...RESOURCE,
      "dateToActivate",
      "dateToShow",
      "dateToStartOn",
      "dateToSubmit",
      "maxAttempts",
      "maxSubmits",
      "maxScore",
    ];
    const PROPERTIES: Readonly<Record<string, readonly string[]>> = {
      Person: BASE,
      SoftwareApplication: [...BASE, "host", "ipAddress", "userAgent", "version"],
      Assessment: [...ASSIGNABLE, "items"],
      AssessmentItem: [...ASSIGNABLE, "isTimeDependent"],
      Attempt: [...BASE, "assignee", "assignable", "count", "startedAtTime", "endedAtTime", "duration", "isPartOf"],
      Score: [...BASE, "attempt", "maxScore", "scoreGiven", "scoredBy", "comment"],
    };

    it("gives each entity the properties that its type has in Appendix B of Caliper 1.2", () => {
      const events = [...TYPES.map((type) => eventOf(type)), { ...eventOf("attempt-ended"), detail: "skip" }];
      const grade = caliperGrade(
        {
          index: 0,
          at: SECOND,
          item: Q1,
          scoreGiven: 1,
          maxScore: 2,
          scorer: "human",
          scoredBy: "https://exam.example/raters/9",
        },
        contextAt(2),
      );
      for (const event of [...caliperEvents(events, contextAt("start")), grade]) {
        for (const entity of [event.actor, event.object, event.generated]) {
          if (entity === undefined) continue;
          const known = PROPERTIES[entity.type];
          expect(known, entity.type).toBeDefined();
          expect(
            Object.keys(entity).filter((key) => !known?.includes(key)),
            `${event.type} ${entity.type}`,
          ).toEqual([]);
        }
      }
    });
  });

  describe("identifiers", () => {
    it("gives the same identifiers when the same step is mapped again", () => {
      const events = [eventOf("attempt-ended"), eventOf("moved"), eventOf("presented")];
      const first = caliperEvents(events, contextAt(8));
      const again = caliperEvents(events, contextAt(8));
      expect(again).toEqual(first);
    });

    it("gives different identifiers to different sessions, steps and positions", () => {
      const events = [eventOf("moved"), eventOf("presented")];
      const ids = new Set<string>();
      for (const context of [contextAt(1), contextAt(2), contextAt("start"), { ...contextAt(1), session: "s-2" }]) {
        for (const event of caliperEvents(events, context)) ids.add(event.id);
      }
      expect(ids.size).toBe(2 * 4 + 1);
    });

    it("does not depend on the parties, which describe the events and do not identify them", () => {
      const events = [eventOf("moved")];
      const [one] = caliperEvents(events, contextAt(1));
      const [other] = caliperEvents(events, {
        ...contextAt(1),
        actor: "urn:uuid:other",
        edApp: "https://other.example",
      });
      expect(other?.id).toBe(one?.id);
      expect(other?.actor.id).toBe("urn:uuid:other");
    });
  });

  describe("a session of the engine", () => {
    const item = (identifier: string) => {
      const document =
        readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="${identifier}"
        title="${identifier}" time-dependent="false">
        <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
          <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
        </qti-response-declaration>
        <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
        <qti-item-body>
          <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
            <qti-simple-choice identifier="A">A</qti-simple-choice>
            <qti-simple-choice identifier="B">B</qti-simple-choice>
          </qti-choice-interaction>
        </qti-item-body>
        <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>
      </qti-assessment-item>`);
      if (document.kind !== "item") throw new Error("Expected an item.");
      return document.item;
    };
    const test =
      readAsi(`<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="quiz" title="Quiz">
        <qti-test-part identifier="part" navigation-mode="nonlinear" submission-mode="individual">
          <qti-assessment-section identifier="main" title="Main" visible="true">
            <qti-assessment-item-ref identifier="q1" href="q1.xml"/>
            <qti-assessment-item-ref identifier="q2" href="q2.xml"/>
          </qti-assessment-section>
        </qti-test-part>
      </qti-assessment-test>`);
    if (test.kind !== "test") throw new Error("Expected a test.");
    const items = new Map([
      ["q1.xml", item("q1")],
      ["q2.xml", item("q2")],
    ]);
    const engine: Engine = createEngine({
      kind: "test",
      test: test.test,
      base: "quiz.xml",
      resolvers: {
        items: (href) => {
          const found = items.get(href);
          if (found === undefined) throw new Error(`No item ${href}.`);
          return { resource: href, deliverable: { kind: "qti", item: found }, hazards: [], variants: [] };
        },
        sections: () => {
          throw new Error("The test has no section references.");
        },
        stimuli: () => {
          throw new Error("The items have no stimuli.");
        },
      },
    });

    /** Applies the actions in order and returns the Caliper events of each step, as the session host would forward them. */
    function run() {
      const started = engine.start({ seed: 7, at: SECOND });
      if (!started.ok) throw new Error(started.refusal.message);
      const steps: { readonly step: Extract<Step, { ok: true }>; readonly caliper: readonly CaliperEvent[] }[] = [
        { step: started, caliper: caliperEvents(started.events, contextAt("start")) },
      ];
      let state = started.state;
      const actions = [
        {
          type: "set-responses",
          item: Q1,
          responses: new Map([["RESPONSE", single("identifier", "B")]]),
          at: 2 * SECOND,
        },
        { type: "submit", item: Q1, at: 3 * SECOND },
        { type: "move", to: Q2, at: 4 * SECOND },
        { type: "skip", item: Q2, at: 5 * SECOND },
        { type: "suspend", at: 6 * SECOND },
        { type: "resume", at: 7 * SECOND },
        { type: "end-test", at: 8 * SECOND },
      ] as const;
      for (const [seq, action] of actions.entries()) {
        const step = engine.apply(state, action);
        if (!step.ok) throw new Error(`${action.type}: ${step.refusal.message}`);
        state = step.state;
        steps.push({ step, caliper: caliperEvents(step.events, contextAt(seq + 1)) });
      }
      return steps;
    }

    it("maps the events of a real session: the candidate starts, answers, skips, pauses and submits", () => {
      const steps = run();
      const names = steps.map(({ caliper }) => caliper.map(({ type, action }) => `${type} ${action}`));
      expect(names[0]).toEqual([
        "AssessmentEvent Started",
        "NavigationEvent NavigatedTo",
        "AssessmentItemEvent Started",
      ]);
      expect(names[1]).toEqual([]);
      expect(names[2]).toEqual(["AssessmentItemEvent Completed"]);
      expect(names[3]).toEqual(["NavigationEvent NavigatedTo", "AssessmentItemEvent Started"]);
      expect(names[4]).toEqual(["AssessmentItemEvent Skipped"]);
      expect(names[5]).toEqual(["AssessmentEvent Paused"]);
      expect(names[6]).toEqual(["AssessmentEvent Resumed"]);
      expect(names[7]).toEqual(["AssessmentEvent Submitted"]);
    });

    it("writes events of the real session that the published Caliper context accepts", () => {
      for (const { caliper } of run()) for (const event of caliper) expect(eventProblems(event), event.id).toEqual([]);
    });

    it("maps every event of the real session without an error, whatever its type", () => {
      const seen = new Set<string>();
      for (const { step } of run()) for (const event of step.events) seen.add(event.type);
      expect([...seen].sort()).toEqual(
        expect.arrayContaining(["presented", "attempt-ended", "moved", "suspended", "resumed", "test-ended"]),
      );
    });
  });

  describe("input of other types", () => {
    const valid = [eventOf("moved")];

    it("rejects a context that is not an object with a session, a step and absolute IRIs", () => {
      const bad: [string, unknown][] = [
        ["null", fromJson("null")],
        ["no session", { ...contextAt(1), session: "" }],
        ["a number as session", { ...contextAt(1), session: 5 }],
        ["a negative step", { ...contextAt(1), step: -1 }],
        ["a fractional step", { ...contextAt(1), step: 1.5 }],
        ["a text as step", { ...contextAt(1), step: "later" }],
        ["a relative actor", { ...contextAt(1), actor: "candidate-1" }],
        ["a number as assessment", { ...contextAt(1), assessment: 5 }],
        ["no edApp", { ...contextAt(1), edApp: undefined }],
      ];
      for (const [name, context] of bad) {
        expect(() => caliperEvents(valid, context as never), name).toThrow(DataError);
      }
      expect(() => caliperEvents(valid, { ...contextAt(1), step: "later" } as never)).toThrow(
        'The Caliper context is invalid at step: expected "start" or a non-negative integer, found "later".',
      );
      expect(() => caliperEvents(valid, { ...contextAt(1), actor: "candidate-1" })).toThrow(
        'The Caliper context is invalid at actor: expected an absolute IRI, found "candidate-1".',
      );
    });

    it("rejects events that are not an array of events of the runtime's types", () => {
      expect(() => caliperEvents(fromJson('{"0":{}}'), contextAt(1))).toThrow(
        "The events must be an array, found an object.",
      );
      expect(() => caliperEvents(fromJson("[5]"), contextAt(1))).toThrow("The event 0 must be an object, found 5.");
      expect(() => caliperEvents(fromJson('[{"type":"started","at":1}]'), contextAt(1))).toThrow(
        /The type of the event 0 must be one of "presented", .*found "started"\./u,
      );
      expect(() => caliperEvents(fromJson('[{"type":"__proto__","at":1}]'), contextAt(1))).toThrow(DataError);
      expect(() => caliperEvents(fromJson('[{"type":"constructor","at":1}]'), contextAt(1))).toThrow(DataError);
    });

    it("rejects an event that lacks what its Caliper event needs", () => {
      const bad: [string, string, RegExp][] = [
        ['{"type":"moved","at":1}', "no item", /The event moved must name its item as an object, found undefined\./u],
        [
          '{"type":"presented","at":1,"item":{"ref":"","instance":1}}',
          "an empty ref",
          /The ref of the item of the event presented/u,
        ],
        [
          '{"type":"presented","at":1,"item":{"ref":"q1","instance":0}}',
          "instance 0",
          /The instance of the item of the event presented/u,
        ],
        [
          '{"type":"attempt-ended","at":1,"item":"q1"}',
          "a text as item",
          /must name its item as an object, found "q1"/u,
        ],
        [
          '{"type":"section-entered","at":1}',
          "no scope",
          /The scope of the event section-entered must be a non-empty string/u,
        ],
        [
          '{"type":"test-ended","at":"1"}',
          "a text as time",
          /The time of the event test-ended must be epoch milliseconds/u,
        ],
        [
          '{"type":"suspended","at":-5}',
          "a negative time",
          /The time of the event suspended must be epoch milliseconds/u,
        ],
      ];
      for (const [json, name, message] of bad) {
        expect(() => caliperEvents(fromJson(`[${json}]`), contextAt(1)), name).toThrow(message);
      }
    });

    it("rejects the first of several events of a step that are wrong", () => {
      const events = fromJson<DeliveryEvent[]>(
        '[{"type":"presented","at":-1,"item":{"ref":"q1","instance":1}},{"type":"section-entered","at":1},{"type":"moved","at":1}]',
      );
      expect(() => caliperEvents(events, contextAt("start"))).toThrow(
        /The time of the event presented must be epoch milliseconds/u,
      );
    });

    it("does not read the fields of an event that has no Caliper event", () => {
      const events = fromJson<DeliveryEvent[]>(
        '[{"type":"responses-set","at":"never read"},{"type":"support-changed"}]',
      );
      expect(caliperEvents(events, contextAt(1))).toEqual([]);
    });
  });
});

describe("caliperGrade", () => {
  const grade: CaliperGrade = {
    index: 0,
    at: 12 * SECOND,
    scoreGiven: 7.5,
    maxScore: 10,
    scorer: "human",
    scoredBy: "https://exam.example/raters/9",
  };

  it("gives the GradeEvent Graded for the attempt at the test, with the score it generated", () => {
    const event = caliperGrade(grade, contextAt(7));
    const attempt = urnOf("attempt", SESSION);
    expect(event).toEqual({
      "@context": CALIPER_CONTEXT,
      id: urnOf("event", SESSION, 7, 0),
      type: "GradeEvent",
      profile: "GradingProfile",
      actor: { id: "https://exam.example/raters/9", type: "Person" },
      action: "Graded",
      object: { id: attempt, type: "Attempt", assignee: ACTOR, assignable: ASSESSMENT },
      generated: {
        id: urnOf("score", SESSION, 7, 0),
        type: "Score",
        attempt,
        maxScore: 10,
        scoreGiven: 7.5,
        scoredBy: "https://exam.example/raters/9",
        dateCreated: "1970-01-01T00:00:12.000Z",
      },
      eventTime: "1970-01-01T00:00:12.000Z",
      edApp: APPLICATION,
    });
  });

  it("gives the attempt at an item when the score is for an item", () => {
    const event = caliperGrade({ ...grade, item: Q2, scorer: "externalMachine", index: 1 }, contextAt(7));
    expect(event.actor).toEqual({ id: "https://exam.example/raters/9", type: "SoftwareApplication" });
    expect(event.object).toEqual({
      id: urnOf("attempt", SESSION, "q2", 1),
      type: "Attempt",
      assignee: ACTOR,
      assignable: urnOf("item", ASSESSMENT, "q2"),
      isPartOf: urnOf("attempt", SESSION),
    });
    expect(event.id).toBe(urnOf("event", SESSION, 7, 1));
    expect(event.generated).toMatchObject({ id: urnOf("score", SESSION, 7, 1), attempt: event.object.id });
  });

  it("leaves out the greatest score when the caller does not know it, and keeps a score of 0 or below", () => {
    const { maxScore: _, ...unknown } = grade;
    const event = caliperGrade({ ...unknown, scoreGiven: -0.5 }, contextAt(7));
    expect(event.generated).not.toHaveProperty("maxScore");
    expect(event.generated?.scoreGiven).toBe(-0.5);
    expect(caliperGrade({ ...unknown, scoreGiven: 0 }, contextAt(7)).generated?.scoreGiven).toBe(0);
  });

  it("writes events that the published Caliper context accepts", () => {
    for (const each of [grade, { ...grade, item: Q1, scorer: "externalMachine" as const }]) {
      expect(eventProblems(caliperGrade(each, contextAt(7)))).toEqual([]);
    }
  });

  it("writes the actor, object and generated entity that the Grading Profile requires", () => {
    const event = caliperGrade(grade, contextAt(7));
    expect(["Person", "SoftwareApplication"]).toContain(event.actor.type);
    expect(event.object.type).toBe("Attempt");
    expect(event.generated?.type).toBe("Score");
    expect(event.action).toBe("Graded");
  });

  it("gives the same identifier when the same score is reported again", () => {
    expect(caliperGrade(grade, contextAt(7))).toEqual(caliperGrade(grade, contextAt(7)));
  });

  it("rejects a grade that is not what the Grading Profile needs, and a context that is not one", () => {
    const bad: [string, unknown][] = [
      ["null", fromJson("null")],
      ["a negative index", { ...grade, index: -1 }],
      ["a fractional index", { ...grade, index: 0.5 }],
      ["a score that is not finite", { ...grade, scoreGiven: Number.NaN }],
      ["a score as text", { ...grade, scoreGiven: "7" }],
      ["a maximum that is not finite", { ...grade, maxScore: Number.POSITIVE_INFINITY }],
      ["an unknown scorer", { ...grade, scorer: "machine" }],
      ["a relative scoredBy", { ...grade, scoredBy: "rater-9" }],
      ["an item that is not an instance", { ...grade, item: { ref: "q1", instance: 0 } }],
      ["an item as text", { ...grade, item: "q1" }],
      ["a time before 1970", { ...grade, at: -1 }],
    ];
    for (const [name, value] of bad) {
      expect(() => caliperGrade(value as never, contextAt(7)), name).toThrow(DataError);
    }
    expect(() => caliperGrade({ ...grade, scorer: "machine" } as never, contextAt(7))).toThrow(
      'The Caliper grade is invalid at scorer: expected "human" or "externalMachine", found "machine".',
    );
    expect(() => caliperGrade(grade, { ...contextAt(7), session: "" })).toThrow(DataError);
  });
});

describe("sendCaliper", () => {
  const sample = (): readonly CaliperEvent[] => caliperEvents([eventOf("moved")], contextAt(3));

  it("posts one envelope with the sensor, the time, the version and the events", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    const events = sample();
    await sendCaliper(events, { ...SENDER, fetch: endpoint.fetch });
    expect(endpoint.requests).toHaveLength(1);
    const [request] = endpoint.requests;
    expect(request?.url).toBe("https://lrs.example/caliper");
    expect(request?.init.method).toBe("POST");
    expect(JSON.parse(request?.init.body ?? "")).toEqual({
      sensor: "https://exam.example/sensors/1",
      sendTime: "2023-11-14T22:13:20.000Z",
      dataVersion: "http://purl.imsglobal.org/ctx/caliper/v1p2",
      data: events,
    });
    expect(Object.keys(JSON.parse(request?.init.body ?? ""))).toEqual(["sensor", "sendTime", "dataVersion", "data"]);
  });

  it("sets the media type, and the bearer token that Caliper 1.2 §5.4 recommends", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch });
    expect(endpoint.requests[0]?.init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer token-123",
    });
  });

  it("sends an envelope that has the properties and the events that the published context accepts", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    const events = caliperEvents(
      [eventOf("section-entered"), eventOf("presented"), eventOf("attempt-ended"), eventOf("test-ended")],
      contextAt("start"),
    );
    const grade = caliperGrade(
      { index: 0, at: SECOND, scoreGiven: 1, scorer: "externalMachine", scoredBy: "https://scorer.example/1" },
      contextAt(2),
    );
    await sendCaliper([...events, grade], { ...SENDER, fetch: endpoint.fetch });
    const body = JSON.parse(endpoint.requests[0]?.init.body ?? "");
    expect(envelopeProblems(body)).toEqual([]);
    expect(body.data).toHaveLength(events.length + 1);
  });

  it("sends the same bytes for the same events, so that a resend duplicates nothing", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch });
    await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch });
    expect(endpoint.requests[1]?.init.body).toBe(endpoint.requests[0]?.init.body);
  });

  it("refuses a redirect, which would send the token elsewhere, and limits the time", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch });
    const { init } = endpoint.requests[0] ?? {};
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(DEFAULT_CALIPER_TIMEOUT_MS).toBe(10_000);
  });

  it("accepts any 2xx answer, 200 and 202 included", async () => {
    for (const status of [200, 201, 202, 204]) {
      const endpoint = fakeEndpoint({ status });
      await expect(
        sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch }),
        String(status),
      ).resolves.toBeUndefined();
    }
  });

  it("fails with the status and the body of a refusal of Caliper 1.2 §6.1", async () => {
    for (const status of [400, 401, 415, 422, 500]) {
      const endpoint = fakeEndpoint({ status, body: '{"title":"no"}' });
      const error = await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch }).catch((e: unknown) => e);
      expect(error, String(status)).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({
        status,
        body: '{"title":"no"}',
        message: `The Caliper endpoint at https://lrs.example/caliper answered ${status}.`,
      });
    }
  });

  it("fails with status 0 when the endpoint does not answer, and keeps the reason", async () => {
    const endpoint = fakeEndpoint({ fails: new Error("connect ECONNREFUSED") });
    const error = await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      status: 0,
      body: "",
      message: "The Caliper endpoint at https://lrs.example/caliper did not answer: connect ECONNREFUSED.",
    });
  });

  it("aborts a call that takes longer than the time limit", async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted due to timeout")));
      });
    const error = await sendCaliper(sample(), { ...SENDER, fetch: hang, timeoutMs: 20 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0, message: expect.stringContaining("did not answer") });
  });

  it("accepts the global fetch as it is", () => {
    const options: Parameters<typeof sendCaliper>[1] = { ...SENDER, fetch };
    expect(options.fetch).toBe(fetch);
  });

  it("rejects options and events that are not what the sensor needs, before any request", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    const events = sample();
    const options = { ...SENDER, fetch: endpoint.fetch };
    const bad: [string, unknown, unknown][] = [
      ["null options", events, fromJson("null")],
      ["an http endpoint", events, { ...options, endpoint: "http://lrs.example/caliper" }],
      ["a relative endpoint", events, { ...options, endpoint: "/caliper" }],
      ["a token with a space", events, { ...options, token: "two words" }],
      ["an empty token", events, { ...options, token: "" }],
      ["a token as number", events, { ...options, token: 5 }],
      ["no fetch", events, { ...options, fetch: undefined }],
      ["an empty sensor", events, { ...options, sensor: "" }],
      ["a time limit of 0", events, { ...options, timeoutMs: 0 }],
      ["a send time before 1970", events, { ...options, sendTime: -1 }],
      ["a send time as text", events, { ...options, sendTime: "now" }],
      ["no events", [], options],
      ["events as an object", fromJson('{"0":{}}'), options],
      ["an event as text", fromJson('["x"]'), options],
      ["an event of another context", fromJson('[{"@context":"https://schema.org","id":"urn:uuid:1"}]'), options],
      ["an event without an id", fromJson('[{"@context":"http://purl.imsglobal.org/ctx/caliper/v1p2"}]'), options],
    ];
    for (const [name, sent, given] of bad) {
      await expect(sendCaliper(sent as never, given as never), name).rejects.toThrow(DataError);
    }
    expect(endpoint.requests).toHaveLength(0);
    await expect(sendCaliper(events, { ...options, endpoint: "http://lrs.example/caliper" })).rejects.toThrow(
      'The option endpoint must be an absolute https URL, found "http://lrs.example/caliper".',
    );
    await expect(sendCaliper([], options)).rejects.toThrow("The Caliper events must have at least one event");
  });
});

describe("the shape check against the published context", () => {
  // The checks are the oracle of the tests above, so they must fail on documents that are wrong.
  const good = (): CaliperEvent => {
    const [event] = caliperEvents([eventOf("presented")], contextAt(1));
    if (event === undefined) throw new Error("Expected an event.");
    return event;
  };
  const mutate = (change: (event: Record<string, unknown>) => void): string[] => {
    const copy: Record<string, unknown> = JSON.parse(JSON.stringify(good()));
    change(copy);
    return eventProblems(copy);
  };

  it("accepts the events of the Assessment Profile that the specification prints", () => {
    const printed = {
      "@context": "http://purl.imsglobal.org/ctx/caliper/v1p2",
      id: "urn:uuid:04e27704-73bf-4d3c-912c-1b2da40aef8f",
      type: "AssessmentItemEvent",
      profile: "AssessmentProfile",
      actor: { id: "https://example.edu/users/554433", type: "Person" },
      action: "Skipped",
      object: {
        id: "https://example.edu/terms/201601/courses/7/sections/1/assess/1/items/2",
        type: "AssessmentItem",
        name: "Assessment Item 2",
        isPartOf: { id: "https://example.edu/terms/201601/courses/7/sections/1/assess/1", type: "Assessment" },
        dateToStartOn: "2016-11-14T05:00:00.000Z",
        dateToSubmit: "2016-11-18T11:59:59.000Z",
        maxAttempts: 2,
        maxSubmits: 2,
        maxScore: 1.0,
        isTimeDependent: false,
        version: "1.0",
      },
      eventTime: "2016-11-15T10:14:30.000Z",
      edApp: { id: "https://example.edu", type: "SoftwareApplication", version: "v2" },
      membership: {
        id: "https://example.edu/terms/201601/courses/7/sections/1/rosters/1",
        type: "Membership",
        member: "https://example.edu/users/554433",
        organization: "https://example.edu/terms/201601/courses/7/sections/1",
        roles: ["Learner"],
        status: "Active",
        dateCreated: "2016-08-01T06:00:00.000Z",
      },
    };
    expect(eventProblems(printed)).toEqual([]);
  });

  it("finds a term that the context does not define", () => {
    expect(
      mutate((event) => {
        event.attemptCount = 1;
      }),
    ).toEqual(["event.attemptCount: the term attemptCount is not defined by the Caliper context"]);
  });

  it("finds a value of the wrong type, a malformed time and an action that is not a term", () => {
    expect(
      mutate((event) => {
        event.eventTime = "2016-11-15 10:14:30";
      }),
    ).toEqual(["event.eventTime: 2016-11-15 10:14:30 is not YYYY-MM-DDTHH:mm:ss.SSSZ"]);
    expect(
      mutate((event) => {
        (event.object as Record<string, unknown>).name = 5;
      }),
    ).toEqual(["event.object.name: 5 is not a string"]);
    expect(
      mutate((event) => {
        event.action = "Began";
      }),
    ).toEqual(["event.action: Began is not a term of the context"]);
    expect(
      mutate((event) => {
        event.profile = "Started";
      }),
    ).toEqual([]);
  });

  it("finds a missing context, a missing required property and an identifier that is not a UUID URN", () => {
    expect(
      mutate((event) => {
        event["@context"] = "https://example.edu/context";
      }),
    ).toEqual(["@context is https://example.edu/context"]);
    expect(
      mutate((event) => {
        delete event.actor;
      }),
    ).toEqual(["actor is required and missing"]);
    expect(
      mutate((event) => {
        event.id = "https://example.edu/events/1";
      }),
    ).toEqual(["id is not urn:uuid:<UUID>"]);
  });

  it("finds an entity that has no absolute IRI or whose type is not a node type", () => {
    expect(
      mutate((event) => {
        (event.object as Record<string, unknown>).id = "item-1";
      }),
    ).toEqual(["event.object: id is not an absolute IRI"]);
    expect(
      mutate((event) => {
        (event.object as Record<string, unknown>).type = "Started";
      }),
    ).toEqual(["event.object: type is not a node type"]);
  });

  it("finds an envelope with a custom property, a missing version and no events", () => {
    const envelope = {
      sensor: "https://exam.example/sensors/1",
      sendTime: "2023-11-14T22:13:20.000Z",
      dataVersion: CALIPER_CONTEXT,
    };
    expect(envelopeProblems({ ...envelope, data: [], extra: 1 })).toEqual([
      "The envelope has the properties sensor, sendTime, dataVersion, data, extra, not sensor, sendTime, dataVersion, data",
      "data is not a non-empty array",
    ]);
    expect(envelopeProblems({ ...envelope, dataVersion: "v1", data: [{}] })).toContain(
      "dataVersion is not the Caliper context",
    );
  });
});

describe("properties", () => {
  const arbitraryEvent: fc.Arbitrary<DeliveryEvent> = fc.record({
    type: fc.constantFrom(...TYPES),
    at: fc.integer({ min: 0, max: 253_402_300_799_999 }),
    item: fc.record({ ref: fc.string({ minLength: 1 }), instance: fc.integer({ min: 1, max: 5 }) }),
    scope: fc.string({ minLength: 1 }),
    detail: fc.constantFrom("submit", "skip", "end-attempt", "close"),
  });
  const arbitraryStep = fc.oneof(fc.constant("start" as const), fc.nat());
  const arbitrarySession = fc.string({ minLength: 1 });

  it("maps any events of any type, with an event for each type that has one", () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryEvent, { maxLength: 12 }),
        arbitraryStep,
        arbitrarySession,
        (events, step, session) => {
          const produced = caliperEvents(events, { ...contextAt(step), session });
          const mapped = events.filter(({ type }) => EXPECTED[type] !== null).length;
          const started = step === "start" && events.length > 0 ? 1 : 0;
          expect(produced).toHaveLength(mapped + started);
          for (const event of produced) expect(eventProblems(event), event.id).toEqual([]);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("gives identifiers that are unique within a step and the same when a step is sent again", () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryEvent, { maxLength: 12 }),
        arbitraryStep,
        arbitrarySession,
        (events, step, session) => {
          const context = { ...contextAt(step), session };
          const first = caliperEvents(events, context);
          const again = caliperEvents(events, context);
          expect(again.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
          expect(new Set(first.map(({ id }) => id)).size).toBe(first.length);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("gives different identifiers to the events of different steps of a session", () => {
    fc.assert(
      fc.property(fc.array(arbitraryEvent, { minLength: 1, maxLength: 6 }), fc.nat(), fc.nat(), (events, one, two) => {
        fc.pre(one !== two);
        const ids = caliperEvents(events, contextAt(one)).map(({ id }) => id);
        const others = new Set(caliperEvents(events, contextAt(two)).map(({ id }) => id));
        expect(ids.filter((id) => others.has(id))).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it("gives an event of the Caliper context for any score", () => {
    fc.assert(
      fc.property(
        fc.record({
          index: fc.nat(),
          at: fc.integer({ min: 0, max: 253_402_300_799_999 }),
          scoreGiven: fc.double({ noNaN: true, noDefaultInfinity: true }),
          scorer: fc.constantFrom("human" as const, "externalMachine" as const),
          scoredBy: fc.constant("https://exam.example/raters/9"),
        }),
        (grade) => {
          expect(eventProblems(caliperGrade(grade, contextAt(2)))).toEqual([]);
        },
      ),
      { numRuns: 60 },
    );
  });
});
