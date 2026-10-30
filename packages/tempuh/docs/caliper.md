# Caliper

`@luthfanwakan/tempuh/caliper` turns the events of a delivery session into [Caliper Analytics 1.2](https://www.imsglobal.org/spec/caliper/v1p2)
events of the Assessment Profile (§3.2) and the Grading Profile (§3.6), gives them identifiers that stay the same when a
step is reported again, and sends them to a Caliper endpoint. `@luthfanwakan/tempuh/server` forwards the events of each step
to the host's log and to Caliper. Both are for servers.

```ts
import { caliperEvents, sendCaliper } from "@luthfanwakan/tempuh/caliper";

const events = await caliperEvents(
  [
    { type: "section-entered", at: 1_700_000_000_000, scope: "main" },
    { type: "presented", at: 1_700_000_000_000, item: { ref: "q1", instance: 1 } },
  ],
  {
    session: "session-1",
    step: "start",
    actor: "urn:uuid:0b9c4c4e-0d3c-4f8e-9a53-6d1b6f0d9a11",
    assessment: "https://exam.example/tests/42",
    edApp: "https://exam.example",
  },
);
events.map(({ type, action }) => `${type} ${action}`);
// ["AssessmentEvent Started", "NavigationEvent NavigatedTo", "AssessmentItemEvent Started"]
events[2]?.id; // "urn:uuid:3dc3bf68-d8b6-5852-b571-626def5f4953"

await sendCaliper(events, {
  endpoint: "https://lrs.example/caliper",
  token: "abc123",
  sensor: "https://exam.example/sensors/1",
  sendTime: 1_700_000_001_000,
  fetch,
});
```

## From events of olah to events of Caliper

`caliperEvents(events, context)` maps the `Step.events` of one step. An event keeps its source's order. A type without a Caliper
event gives none, and the host's log keeps it.

| olah                                   | Caliper                                                |
| -------------------------------------- | ------------------------------------------------------ |
| the step of `Engine.start`             | AssessmentEvent Started, before the events of the step |
| `suspended`, `resumed`                 | AssessmentEvent Paused, Resumed                        |
| `test-ended`                           | AssessmentEvent Submitted                              |
| `presented`                            | AssessmentItemEvent Started                            |
| `attempt-ended` with the detail `skip` | AssessmentItemEvent Skipped                            |
| `attempt-ended` otherwise              | AssessmentItemEvent Completed                          |
| `moved`                                | NavigationEvent NavigatedTo an item                    |
| `section-entered`                      | NavigationEvent NavigatedTo a section                  |

These types have no Caliper event and give none: `responses-set`, `response-processed`, `processing-failed`,
`outcome-processed`, `part-ended`, `time-limit-passed`, `time-out`, `late-submission`, `support-changed`, `variant-selected` and
`hazard-unavoidable`.

The mapping is a record over olah's `DeliveryEventType`, so a type that olah adds fails the type check until it is decided.
An event whose type is none of these is a `DataError`.

### The context

| Property     | Meaning                                                                                                                   | Default  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| `session`    | The identifier of the candidate session, the `session` of a `Caller`. A non-empty string.                                 | required |
| `step`       | `"start"` for the step of `Engine.start`, else the sequence number of the action that the session host stored.            | required |
| `actor`      | The IRI of the candidate: the host's opaque identifier, such as `urn:uuid:` and a UUID. Never an email address or a name. | required |
| `assessment` | The IRI of the test.                                                                                                      | required |
| `edApp`      | The IRI of the application that delivers the test.                                                                        | required |

Caliper identifies every entity by an absolute IRI (§4.2), which only the host can give the candidate, the test and the
application. `actor`, `assessment` and `edApp` are checked to be absolute IRIs.

### What an event holds

Every event has `@context` (`http://purl.imsglobal.org/ctx/caliper/v1p2`), `id`, `type`, `profile`, `actor` (a `Person`),
`action`, `object`, `eventTime` and `edApp`. The times are `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC (§2.1); a time before 1970 or after
the year 9999 is a `DataError`.

| Event                           | `object`                             | `generated`                                              |
| ------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| AssessmentEvent Started         | the `Assessment`                     | the `Attempt` at the test, with `startedAtTime`          |
| AssessmentEvent Paused, Resumed | the `Assessment`                     | the `Attempt` at the test                                |
| AssessmentEvent Submitted       | the `Assessment`                     | the `Attempt` at the test, with `endedAtTime`            |
| AssessmentItemEvent Started     | the `AssessmentItem`                 | the `Attempt` at the item instance, with `startedAtTime` |
| AssessmentItemEvent Skipped     | the `AssessmentItem`                 | the `Attempt` at the item instance, with `endedAtTime`   |
| AssessmentItemEvent Completed   | the `AssessmentItem`                 | none                                                     |
| NavigationEvent NavigatedTo     | the `AssessmentItem`, or the section | none                                                     |
| GradeEvent Graded               | the `Attempt` that was graded        | the `Score`                                              |

Entities refer to other entities by IRI. An `Attempt` has its `assignee` (the candidate) and its `assignable` (the test or the
item), and the attempt at an item is `isPartOf` the attempt at the test. An `AssessmentItem` and a section are `isPartOf` the
test and have the identifier of their item reference or section as `name`.

## Identifiers

An event's `id` is the URN `urn:uuid:` and a name-based UUID of version 5 (RFC 9562 §5.5; Caliper 1.2 §2.1 asks for a
UUID URN). Reporting the same step again gives the same identifiers, so an endpoint that keeps an event once by its `id`
holds each event once.

The UUID is the SHA-1 of the namespace `e77b625a-3ddd-5fa9-be27-44f813a9600d` and the UTF-8 bytes of a name. The namespace is
the UUID of `https://github.com/luthfanwakan/olah/tree/main/packages/tempuh/src/caliper` in the URL namespace of RFC 9562
§6.6. The name is the JSON text of an array, so that no two lists of parts make one name.

| Entity                          | Parts of the name                     |
| ------------------------------- | ------------------------------------- |
| An event                        | `["event", session, step, index]`     |
| The attempt at the test         | `["attempt", session]`                |
| The attempt at an item instance | `["attempt", session, ref, instance]` |
| An item                         | `["item", assessment, ref]`           |
| A section                       | `["section", assessment, identifier]` |
| A score                         | `["score", session, step, index]`     |

`step` is `"start"` or a number, and `index` is the position of the event in `Step.events`. The AssessmentEvent Started that
the start step adds has the index `-1`. An item is the same in every session of the test, and an attempt belongs to its
session. The identifiers of entities are not addresses that a server can dereference (§4.2 says an IRI should be).

## Scores

olah's events carry no score, so a score reaches Caliper through `caliperGrade(grade, context)`, which the host calls when it
applies one. It returns the GradeEvent Graded of the Grading Profile.

| Property     | Meaning                                                                                                | Default  |
| ------------ | ------------------------------------------------------------------------------------------------------ | -------- |
| `index`      | The position in `Step.events` of the event that reported the score; it makes the identifier.           | required |
| `at`         | When the score was given, in epoch milliseconds.                                                       | required |
| `item`       | The item instance that was graded.                                                                     | the test |
| `scoreGiven` | The score awarded, a finite number.                                                                    | required |
| `maxScore`   | The greatest score possible, a finite number.                                                          | left out |
| `scorer`     | `"human"` for a rater, a `Person`; `"externalMachine"` for a scoring service, a `SoftwareApplication`. | required |
| `scoredBy`   | The IRI of the rater or of the service.                                                                | required |

The event's `actor` and the score's `scoredBy` are the scorer. The context is the one of the step that applied the score.

## Sending

`sendCaliper(events, options)` posts one envelope (§5.2) with the events as its `data`, over HTTPS (§5.4).

| Option      | Meaning                                                                                                | Default  |
| ----------- | ------------------------------------------------------------------------------------------------------ | -------- |
| `endpoint`  | The address of the endpoint, an `https` URL.                                                           | required |
| `token`     | The bearer token the endpoint validates; letters, digits and `-._~+/`, then `=` (RFC 6750 §2.1).       | required |
| `fetch`     | The `fetch` to send with, or a replacement.                                                            | required |
| `sensor`    | The identifier of the sensor, which Caliper advises to be an IRI (§5.2).                               | required |
| `sendTime`  | The time of sending in epoch milliseconds. A resend has the time of the resend.                        | required |
| `timeoutMs` | The most time in milliseconds that the call may take, from the request to the last byte of the answer. | `10000`  |

The request is a `POST` with `Content-Type: application/json` and `Authorization: Bearer <token>`. The body has the properties
`sensor`, `sendTime`, `dataVersion` (the Caliper context) and `data`, and no others. `redirect` is `error`, because a redirect
would send the token elsewhere. At least one event is needed, as an envelope has at least one.

| Error          | When                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DataError`    | An option or an event has the wrong type.                                                                                   |
| `ServiceError` | The endpoint answers with another status than 2xx, such as 400, 401, 415 or 422 (§6.1); `status` and `body` are its answer. |
| `ServiceError` | The endpoint does not answer or the time limit passes; `status` is `0`.                                                     |

`sendCaliper` does not retry. A host that retries sends the same events, whose identifiers are the same.

## Forwarding the events of a step

`forwardEvents(step, options)` of `@luthfanwakan/tempuh/server` is what the session host calls after each step. It gives every
event of the step to the host's log, whatever its type, and the events that Caliper has a counterpart for to the endpoint.

```ts
import { forwardEvents } from "@luthfanwakan/tempuh/server";

await forwardEvents(
  {
    session: "session-1",
    step: 3,
    events: [{ type: "support-changed", at: 1_700_000_000_000, detail: "magnification on" }],
  },
  { log: (step) => console.log(step.session, step.step, step.events.length) },
);
// session-1 3 1
```

| Property of `step` | Meaning                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `session`          | The identifier of the candidate session.                            |
| `step`             | `"start"`, or the sequence number of the action that made the step. |
| `events`           | The events of the step, as `Step.events` gives them.                |

| Option            | Meaning                                                                                       | Default    |
| ----------------- | --------------------------------------------------------------------------------------------- | ---------- |
| `log`             | The host's log. It receives the step with every event, as olah gave them.                     | required   |
| `caliper.parties` | Returns the `actor`, `assessment` and `edApp` of a session, or a promise of them.             | no Caliper |
| `caliper.sender`  | `endpoint`, `token`, `fetch`, `sensor` and `timeoutMs`, as `sendCaliper` takes them.          | no Caliper |
| `caliper.clock`   | Gives the time of sending: an object with a function `now()` that returns epoch milliseconds. | no Caliper |

- The log goes first. A failure of the log stops the forwarding, and a failure of Caliper leaves the log entry.
- A step without events calls nothing, and a step with no event that Caliper has a counterpart for sends nothing.
- A host that sees a failure reports the same step again. The log receives the step again, so it keeps a step by its
  session and `step`, and the endpoint receives the same identifiers.

## Where the specification leaves room

These choices are tempuh's.

- The Assessment Profile has no section, so a section is an `Assessment` that is `isPartOf` the test.
- `presented` is always a Started, including a return to an item after a resume or a move: the event does not say whether it is
  the first.
- `Attempt` has no `count` and no `duration`. An attempt at the test is the candidate session and an attempt at an item is the
  item instance's session, and a step knows neither the earlier sessions of the candidate nor the start of an attempt.
- Completed generates no `Response`, because the events hold no response and an answer is not analytics data. Skipped generates
  the attempt, as the profile's table lists.
- `test-ended` is Submitted however the test ended: the candidate, the proctor or a maximum time.
- The start step is dated by its first event. A start step without events gives no Started.
- A NavigationEvent has no `referrer`, because a step does not know the item before.
- No event has `group`, `membership`, `session` or `federatedSession`: the host knows them, and they identify the candidate.
- The Caliper endpoint's configuration (§6.2) is not read, and the envelope is not split by its maximum payload size.
