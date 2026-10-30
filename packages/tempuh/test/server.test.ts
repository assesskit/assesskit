import type { DeliveryEvent, DeliveryEventType } from "@luthfanwakan/olah/delivery";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DataError, ServiceError } from "../src/index.js";
import { forwardEvents, type StepEvents } from "../src/server/index.js";
import { ACTOR, APPLICATION, ASSESSMENT, type FakeReply, fakeEndpoint, SESSION } from "./caliper-fixture.js";

const SECOND = 1000;

/** Every type of olah's `DeliveryEventType`: a record, so that a type added to olah fails the type check here. */
const EVERY_TYPE: Readonly<Record<DeliveryEventType, true>> = {
  presented: true,
  "responses-set": true,
  "attempt-ended": true,
  "response-processed": true,
  "processing-failed": true,
  "outcome-processed": true,
  moved: true,
  "section-entered": true,
  "part-ended": true,
  "test-ended": true,
  "time-limit-passed": true,
  "time-out": true,
  "late-submission": true,
  suspended: true,
  resumed: true,
  "support-changed": true,
  "variant-selected": true,
  "hazard-unavoidable": true,
};
const TYPES = Object.keys(EVERY_TYPE) as DeliveryEventType[];

/** An event of a type with the fields that its type carries, as olah's TSDoc describes them. */
function eventOf(type: DeliveryEventType, at: number): DeliveryEvent {
  return {
    type,
    at,
    item: { ref: "q1", instance: 1 },
    scope: "main",
    ...(type === "attempt-ended" ? { detail: "submit" } : {}),
    ...(type === "support-changed" ? { detail: "magnification on" } : {}),
  };
}

const fromJson = <T>(text: string): T => JSON.parse(text);

/** The options of a host that logs to a list and sends to a fake endpoint. */
function host(...replies: readonly FakeReply[]) {
  const endpoint = fakeEndpoint(...replies);
  const logged: StepEvents[] = [];
  const calls: string[] = [];
  return {
    endpoint,
    logged,
    calls,
    options: {
      log: (step: StepEvents) => {
        calls.push("log");
        logged.push(step);
      },
      caliper: {
        parties: (session: string) => {
          calls.push(`parties ${session}`);
          return { actor: ACTOR, assessment: ASSESSMENT, edApp: APPLICATION };
        },
        sender: {
          endpoint: "https://lrs.example/caliper",
          token: "token-123",
          sensor: "https://exam.example/sensors/1",
          fetch: endpoint.fetch,
        },
        clock: { now: () => 1_700_000_000_000 },
      },
    },
  };
}

describe("forwardEvents", () => {
  it("[T114] forwards every event of every type to the host's log, in the order olah gave them", async () => {
    const events = TYPES.map((type, at) => eventOf(type, at * SECOND));
    const logged: StepEvents[] = [];
    await forwardEvents({ session: SESSION, step: 3, events }, { log: (step) => void logged.push(step) });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toEqual({ session: SESSION, step: 3, events });
    expect(logged[0]?.events.map(({ type }) => type)).toEqual(TYPES);
  });

  it("[T114] forwards the types that olah added with the unit that completed it", async () => {
    const added: DeliveryEventType[] = ["processing-failed", "time-limit-passed", "late-submission", "support-changed"];
    const logged: StepEvents[] = [];
    const events = added.map((type) => eventOf(type, SECOND));
    await forwardEvents({ session: SESSION, step: 9, events }, { log: (step) => void logged.push(step) });
    expect(logged[0]?.events).toEqual(events);
  });

  it("[T114] forwards an event of a type that it has not heard of, since it filters nothing", async () => {
    const later: DeliveryEvent[] = fromJson(
      '[{"type":"scores-replaced","at":1000,"scope":"essay","detail":"r1"},{"type":"scores-applied","at":2000}]',
    );
    const logged: StepEvents[] = [];
    await forwardEvents({ session: SESSION, step: 4, events: later }, { log: (step) => void logged.push(step) });
    expect(logged[0]?.events).toEqual(later);
  });

  it("[T114] forwards the events of the start step as they are, with the step that tells it", async () => {
    const logged: StepEvents[] = [];
    const events = [eventOf("section-entered", SECOND), eventOf("presented", SECOND)];
    await forwardEvents({ session: SESSION, step: "start", events }, { log: (step) => void logged.push(step) });
    expect(logged).toEqual([{ session: SESSION, step: "start", events }]);
  });

  it("[T114] calls nothing for a step without events", async () => {
    const { options, calls, endpoint } = host();
    await forwardEvents({ session: SESSION, step: 2, events: [] }, options);
    expect(calls).toEqual([]);
    expect(endpoint.requests).toEqual([]);
  });

  it("[T114] waits for the log of the host before it goes on", async () => {
    const order: string[] = [];
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("log done");
    };
    const { options } = host({ status: 200 });
    options.caliper.parties = (session: string) => {
      order.push(`parties ${session}`);
      return { actor: ACTOR, assessment: ASSESSMENT, edApp: APPLICATION };
    };
    await forwardEvents(
      { session: SESSION, step: 1, events: [eventOf("presented", SECOND)] },
      { ...options, log: slow },
    );
    expect(order).toEqual(["log done", `parties ${SESSION}`]);
  });

  it("[T114][T109] sends the events that Caliper has a counterpart for after the log, and none of the others", async () => {
    const { options, endpoint, calls, logged } = host({ status: 200 });
    const events = TYPES.map((type) => eventOf(type, SECOND));
    await forwardEvents({ session: SESSION, step: 5, events }, options);
    expect(calls).toEqual(["log", `parties ${SESSION}`]);
    expect(logged[0]?.events).toHaveLength(TYPES.length);
    expect(endpoint.requests).toHaveLength(1);
    const body = JSON.parse(endpoint.requests[0]?.init.body ?? "");
    expect(body.sendTime).toBe("2023-11-14T22:13:20.000Z");
    expect(body.data.map((event: { type: string; action: string }) => `${event.type} ${event.action}`)).toEqual([
      "AssessmentItemEvent Started",
      "AssessmentItemEvent Completed",
      "NavigationEvent NavigatedTo",
      "NavigationEvent NavigatedTo",
      "AssessmentEvent Submitted",
      "AssessmentEvent Paused",
      "AssessmentEvent Resumed",
    ]);
  });

  it("[T114][T109] maps the step of the start with the Started event, using the session's parties", async () => {
    const { options, endpoint } = host({ status: 200 });
    await forwardEvents(
      { session: SESSION, step: "start", events: [eventOf("section-entered", SECOND), eventOf("presented", SECOND)] },
      options,
    );
    const body = JSON.parse(endpoint.requests[0]?.init.body ?? "");
    expect(body.data.map((event: { action: string }) => event.action)).toEqual(["Started", "NavigatedTo", "Started"]);
    expect(body.data[0].actor).toEqual({ id: ACTOR, type: "Person" });
    expect(body.data[0].object.id).toBe(ASSESSMENT);
  });

  it("[T114] sends nothing to Caliper when no event of the step has a counterpart", async () => {
    const { options, endpoint, logged } = host();
    const events = [eventOf("responses-set", SECOND), eventOf("outcome-processed", SECOND)];
    await forwardEvents({ session: SESSION, step: 2, events }, options);
    expect(logged).toHaveLength(1);
    expect(endpoint.requests).toEqual([]);
  });

  it("[T114] reports the same step again with the same Caliper identifiers, so that a resend duplicates nothing", async () => {
    const { options, endpoint, logged } = host({ status: 200 });
    const step: StepEvents = {
      session: SESSION,
      step: 6,
      events: [eventOf("moved", SECOND), eventOf("presented", SECOND)],
    };
    await forwardEvents(step, options);
    await forwardEvents(step, options);
    expect(logged).toEqual([step, step]);
    expect(endpoint.requests[1]?.init.body).toBe(endpoint.requests[0]?.init.body);
  });

  it("[T114] sends to Caliper only after the log accepted the events", async () => {
    const { options, endpoint } = host({ status: 200 });
    const failing = { ...options, log: () => Promise.reject(new Error("disk full")) };
    await expect(
      forwardEvents({ session: SESSION, step: 1, events: [eventOf("presented", SECOND)] }, failing),
    ).rejects.toThrow("disk full");
    expect(endpoint.requests).toEqual([]);
  });

  it("[T114] keeps the log entry when the Caliper endpoint refuses, and tells the host", async () => {
    const { options, logged } = host({ status: 401, body: "no" });
    const step: StepEvents = { session: SESSION, step: 1, events: [eventOf("presented", SECOND)] };
    const error = await forwardEvents(step, options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 401, body: "no" });
    expect(logged).toEqual([step]);
  });

  it("[T114] rejects steps and options that are not what the forwarder needs", async () => {
    const { options } = host();
    const step: StepEvents = { session: SESSION, step: 1, events: [eventOf("presented", SECOND)] };
    const log = () => undefined;
    const bad: [string, unknown, unknown][] = [
      ["a step that is null", fromJson("null"), options],
      ["an empty session", { ...step, session: "" }, options],
      ["events as an object", { ...step, events: fromJson('{"0":{}}') }, options],
      ["null options", step, fromJson("null")],
      ["no log", step, { ...options, log: undefined }],
      ["a log that is a string", step, { ...options, log: fromJson('"console"') }],
      ["a caliper that is a string", step, { log, caliper: fromJson('"yes"') }],
      ["parties that are not a function", step, { log, caliper: { ...options.caliper, parties: fromJson("{}") } }],
      ["a sender that is null", step, { log, caliper: { ...options.caliper, sender: fromJson("null") } }],
      ["a clock that is a number", step, { log, caliper: { ...options.caliper, clock: fromJson("5") } }],
    ];
    for (const [name, given, forwarding] of bad) {
      await expect(forwardEvents(given as never, forwarding as never), name).rejects.toThrow(DataError);
    }
    await expect(forwardEvents(step, { ...options, log: undefined } as never)).rejects.toThrow(
      "The option log must be a function, found undefined.",
    );
  });

  it("[T114] rejects Caliper events from parties that are not IRIs, after the log has the events", async () => {
    const { options, logged } = host({ status: 200 });
    const parties = () => ({ actor: "candidate-1", assessment: ASSESSMENT, edApp: APPLICATION });
    const step: StepEvents = { session: SESSION, step: 1, events: [eventOf("presented", SECOND)] };
    await expect(forwardEvents(step, { ...options, caliper: { ...options.caliper, parties } })).rejects.toThrow(
      DataError,
    );
    expect(logged).toEqual([step]);
  });
});

describe("properties", () => {
  it("[T114] forwards any events, of any type, to the log without a change", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ type: fc.string(), at: fc.integer(), detail: fc.string() }, { requiredKeys: ["type"] }), {
          maxLength: 10,
        }),
        async (events) => {
          const logged: StepEvents[] = [];
          const step: StepEvents = { session: SESSION, step: 1, events: JSON.parse(JSON.stringify(events)) };
          await forwardEvents(step, { log: (each) => void logged.push(each) });
          expect(logged).toEqual(events.length === 0 ? [] : [step]);
        },
      ),
      { numRuns: 40 },
    );
  });
});
