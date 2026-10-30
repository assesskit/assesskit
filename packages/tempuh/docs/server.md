# Server

`@luthfanwakan/tempuh/server` runs a candidate session for a candidate who is not trusted with its keys: the session host of
exam mode, the [asset gate](asset-gate.md), the stores a host provides, and the forwarding of each step's events
([Caliper](caliper.md#forwarding-the-events-of-a-step)). Keys and seeds stay on the server.

```ts
import { createEngine } from "@luthfanwakan/olah/delivery";
import { createSessionHost, SYSTEM_CLOCK } from "@luthfanwakan/tempuh/server";
import type { AssetGate, Scheduler, SessionStore } from "@luthfanwakan/tempuh/server";
import type { QtiPackage } from "@luthfanwakan/olah/package";
import type { DeliveryDefinition } from "@luthfanwakan/olah/delivery";

declare const definition: DeliveryDefinition; // from packageResolvers
declare const store: SessionStore;
declare const scheduler: Scheduler;
declare const gate: AssetGate;
declare const packageOf: (session: string) => Promise<QtiPackage>;

const host = createSessionHost({
  engine: createEngine(definition),
  store,
  scheduler,
  clock: SYSTEM_CLOCK,
  gate,
  packages: packageOf,
});

// In the handler of POST /exam/start, for the caller that the host authenticated:
const first = await host.start({ session: "s1", principal: "candidate-7" }, { seed: 12345 });
first.seq; // 0
```

## Session host

`createSessionHost(options)` throws `DataError` when an option is not of its type.

| Option          | Type                               | Meaning                                                                                                        |
| --------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `engine`        | `Engine`                           | The delivery engine of the test. One engine serves every session.                                              |
| `store`         | `SessionStore`                     | The storage of sessions.                                                                                       |
| `scheduler`     | `Scheduler`                        | The scheduler of time-outs, such as a job queue.                                                               |
| `clock`         | `Clock`                            | The time of the server. `SYSTEM_CLOCK` is the machine's.                                                       |
| `gate`          | `AssetGate`                        | Signs the prefixes of each envelope.                                                                           |
| `packages`      | `(session) => Promise<QtiPackage>` | The package that a session delivers; the gate takes the same function.                                         |
| `clientActions` | `CandidateActionType[]`            | The types of action a client may send. Default: every type but `suspend` and `resume` (`EXAM_CLIENT_ACTIONS`). |
| `limits`        | `Partial<ActionLimits>`            | The limits on the size of an action, as olah's `parseCandidateAction` takes them. Default: olah's.             |
| `forward`       | `ForwardOptions`                   | Where the events of each step go: the host's log and Caliper. Default: nowhere.                                |

| Method                             | What it does                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start(caller, options)`           | Starts the session at the time of the clock, binds it to `caller.principal`, stores the record, schedules the deadlines, forwards the events and answers with the first envelope, `seq` 0. `options` are those of `Engine.start` but the time.                                                                                                                                                                   |
| `check(caller)`                    | Throws `AccessError` (`not-bound`) unless the session is bound to the caller's principal. A session that does not exist is the same error, so that the answer does not tell which sessions exist.                                                                                                                                                                                                                |
| `view(caller)`                     | The current view as an envelope, with fresh tokens and the `seq` of the latest request answered. A page that reloads, or that the proctor acted on, mounts from it.                                                                                                                                                                                                                                              |
| `handle(caller, envelope)`         | Answers a request of the client, as below.                                                                                                                                                                                                                                                                                                                                                                       |
| `proctor(session, action)`         | Applies `suspend`, `resume`, `end-part` or `end-test` on the host's authority.                                                                                                                                                                                                                                                                                                                                   |
| `host(session, action, scoredBy?)` | Applies `time`, `supply-scores` or `cat-response`. When Caliper is configured, a `supply-scores` action also forwards a GradeEvent for the score it applied or replaced, scored by `scoredBy`: the IRI of the rater or of the scoring service, which the host takes from its authentication of the rater endpoint. A `supply-scores` without an absolute IRI as `scoredBy` is a `DataError` and changes nothing. |
| `pending(session)`                 | What the engine waits on the host for.                                                                                                                                                                                                                                                                                                                                                                           |
| `scorerView(session, id)`          | What a rater needs, correct responses included. Only the host's endpoints for raters call it.                                                                                                                                                                                                                                                                                                                    |
| `results(session)`                 | The results report, marked official: the one object that `publishScore` accepts. A copy of it is not official.                                                                                                                                                                                                                                                                                                   |

### Caller binding

An envelope has no session identifier. The host's authentication gives `caller = { session, principal }`, and the record's
principal must match, else `AccessError` (`not-bound`), which the host maps to 403. `start` creates the record with
`SessionStore.create`, which fails when the session exists, and then throws `AccessError` (`session-exists`): a session is
never started twice or bound to another principal.

### Handling a request

1. The caller is checked against the record. A repeated `seq` returns the stored envelope with fresh tokens and changes
   nothing; a stale one is a `DataError`.
2. The action is read with olah's `parseCandidateAction` and its size limits. The actions of the host are refused there.
3. The client-action policy applies: an action outside `clientActions` is a `DataError`.
4. The action is stamped with `stamp(state, action, clock.now())`, which never goes back, so a clock that steps back refuses
   nothing, and applied.
5. The deadlines of the new state are scheduled, then the state is saved by version, then the events are forwarded.
6. The answer is the view, with the actions the policy allows, the signed asset prefixes and the documents of the
   content, among them the pronunciation lexicons of the item. A refusal of the engine is in the envelope and the state stays as it was; the `seq` is still stored, so a repeat
   of the refused request gets the same refusal.

When another request saved first, the host loads the record again and handles the request again, up to `MAX_SAVE_RETRIES`
(3) times, and then throws `ServiceError` with status 409. Repeats are safe because `seq` makes the request idempotent.

If the scheduler fails, nothing is saved and the request can be sent again, so no time-out is lost. If forwarding fails, the
step stays saved and the error reaches the caller; `forwardEvents` gives the same identifiers for the same step, so a host
that needs every event reports the step again. A step is numbered by the version of the record it saved, `"start"` for the
first.

### Client-action policy

The exam default lists every action of the candidate but `suspend` and `resume`, because olah counts suspended time nowhere
(G23): a candidate who could suspend would stop the clock. The host filters `view.actions` through the policy, so the chrome
never offers such an action. Practice allows every action, and so does a host that passes `CANDIDATE_ACTION_TYPES`.

### The proctor

A break (PNP A-11), a pause and the end of a part are the proctor's, through `proctor(session, action)`. It applies the
action as the host and saves it; a refusal of the engine, such as `suspend` on an ended test, is returned as the step and
saves nothing. The candidate learns of it with the next request: the engine refuses the action as `suspended`, the
envelope carries the suspended view, and `view(caller)` gives it after a reload.

### Time

The scheduler is the host's, such as a job queue, so a restart loses no time-out. After each step the host calls
`schedule(session, at)` for every maximum time of the new state, rounded up to a millisecond; the call is idempotent for a
pair. The job calls `host(session, { type: "time" })` when `at` arrives. Olah applies a passed deadline on the next action
and its view shows a time-out as applied, so a late job delays only a proactive time-out, never correctness. A `time` that
finds nothing to apply is returned as a step and saves nothing. Proctor time extensions are out of scope: olah has no action
for them.

## Stores

| Interface       | Methods                                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SessionStore`  | `create(session, { state, principal, envelope })` returns `false` when the session exists. `load(session)` gives `{ state, principal, version, seq, envelope }`. `save(session, record)` stores `version + 1` if the stored version is `record.version`, else returns `false`. |
| `Scheduler`     | `schedule(session, at)`: idempotent per pair.                                                                                                                                                                                                                                  |
| `FileStore`     | `put(bytes, mimeType, fileName?)` returns the `FileValue` that refers to the bytes; `read(file)` returns them or `undefined`.                                                                                                                                                  |
| `AgsScoreStore` | `keep(session, item, score)` keeps the score if it is later than the kept one and returns `false` otherwise. `latest(session, item)` returns the kept score or `undefined`.                                                                                                    |

`create` and `save` of `SessionStore`, and `keep` of `AgsScoreStore`, must be atomic across the host's processes. `state` is olah's `serializeState`, `envelope` the JSON of the
latest `ViewEnvelope`, and `action` of a save the JSON `{ at, action }` of the step that made it: the log of the session.

## The scores of LTI items

An item that is a link to a tool is delivered by the tool, which posts its score to the line item that the
[platform role](lti-platform.md) offers. `createLtiScoreIntake({ host, scores, scoredBy? })` turns those scores into the scores
of the session. Its `onScore` is the `onScore` of `agsScores`, and its `settle` takes the steps of the host's forwarding.

| Option     | Meaning                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `host`     | The session host, of which the intake uses `host`.                                                                                             |
| `scores`   | The `AgsScoreStore` that keeps the latest score of each line item.                                                                             |
| `scoredBy` | `(session, item) => iri`: the IRI of the tool, for the GradeEvent of Caliper. Needed when the session host forwards to Caliper. Default: none. |

- The line item keeps the score with the latest `timestamp`. A score that is not later is ignored, as the score service of the
  grade services requires ([LTI AGS 2.0](https://www.imsglobal.org/spec/lti-ags/v2p0#timestamp)).
- A score that is `FullyGraded` is supplied with `supply-scores`, scored by an external machine: its `scoreGiven` answers the
  `SCORE` request of the item and its `scoreMaximum` the `MAXSCORE` request. A later final score replaces the values. A value that
  the score lacks is NULL. `Pending`, `PendingManual` and the other progress is kept and not supplied.
- olah makes the requests of an item when its session is over, not when the tool is done. A final score that arrives earlier is
  kept, and `settle` supplies it when a step makes the requests. Call it from the `log` of the host's forwarding:

```ts
import {
  createLtiScoreIntake,
  createSessionHost,
  type AgsScoreStore,
  type SessionHostOptions,
} from "@luthfanwakan/tempuh/server";

declare const options: Omit<SessionHostOptions, "forward">;
declare const scores: AgsScoreStore;

// The intake and the host need each other: the host logs through the intake, and the intake supplies through the host.
const intake = createLtiScoreIntake({ host: { host: (...call) => host.host(...call) }, scores });
const host = createSessionHost({ ...options, forward: { log: (step) => intake.settle(step) } });

// The handler of the score service: agsScores({ ...platformOptions, onScore: intake.onScore }).
```

A host that logs in other ways calls `settle` after its own log. The intake does not publish the results: that is
[`publishScore`](lti.md#publishing-a-score) when the session is over, and again when a person or a tool supplies the rest.
