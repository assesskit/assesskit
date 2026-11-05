# The session protocol

`@assesskit/player/protocol` holds what a browser and a session host send each other: JSON envelopes around the runtime's JSON
forms of actions and views, the caller that the host's authentication gives to a request, the session client that the player
mounts against, the host side of a session, the branded results report, and the submission that a rater reads. It uses no DOM,
Node.js, timer or network API.

```mermaid
sequenceDiagram
  participant C as Session client<br/>(browser)
  participant H as Session host<br/>(server)
  participant E as Engine<br/>(runtime)
  C->>H: ActionEnvelope {seq, action}
  Note over H: The session and the principal come from the<br/>host's authentication, never from the envelope
  H->>H: check the envelope, repeated or stale seq, client-action policy
  H->>E: apply(state, stamped action)
  E-->>H: step, or refusal with the state unchanged
  H-->>C: ViewEnvelope {seq, view, assets, documents?, refusal?}
```

The runtime writes and reads the JSON inside an envelope: `writeCandidateAction` and `readCandidateAction` for actions, `writeView`
and `readView` for views. The session host and the clients check every envelope they receive, and the checks look at the envelope only. The one form that the player defines is the
submission, because the server writes it and the browser shows it.

| Export                                        | Purpose                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Caller`                                      | The identity that authentication gives to a request.                                                   |
| `ActionEnvelope`                              | What a client sends: a sequence number and one action.                                                 |
| `ViewEnvelope`                                | What a host answers: the view, the asset prefixes and, when they apply, the documents and the refusal. |
| `ViewDocuments`                               | Where the content of a view comes from, so that references in it resolve.                              |
| `LtiFrame`                                    | What the player needs to show a tool.                                                                  |
| `LTI_TOOL_FRAME`, `LTI_STORAGE_FRAME`         | The names of the two frames of an LTI item.                                                            |
| `SessionClient`, `DispatchResult`             | The one interface the player mounts against.                                                           |
| `HostSession`, `HostStep`, `HostApplyOptions` | The host side of a session, which a session host and a local session both offer.                       |
| `Clock`                                       | The source of the time that a client, a session host and a test pass in.                               |
| `OfficialResult`                              | A results report that the session host branded.                                                        |
| `Submission` and its parts                    | What a rater needs to rate an externally scored outcome.                                               |

## Quick start

Tell the two frames of an LTI item:

```ts
import { LTI_STORAGE_FRAME, LTI_TOOL_FRAME } from "@assesskit/player/protocol";

LTI_TOOL_FRAME; // => "lti-tool"
LTI_STORAGE_FRAME; // => "lti-storage"
```

## Caller

`Caller` is the identity that the host's authentication gives to a request. It never comes from the client.

| Property    | Type     | Meaning                                                                                     |
| ----------- | -------- | ------------------------------------------------------------------------------------------- |
| `session`   | `string` | The identifier of the session the request is about                                          |
| `principal` | `string` | The identifier of the authenticated principal; a session belongs to the one that started it |

The session host ignores other properties of a caller, because a host may pass a richer object.

## Envelopes

An envelope has no session identifier. The host takes the session from the authenticated request, so a candidate cannot name
another candidate's session. `seq` makes a request idempotent: a repeated number returns the answer already given, and a stale
one is refused.

| Envelope         | Property    | Type                 | Meaning                                                                             |
| ---------------- | ----------- | -------------------- | ----------------------------------------------------------------------------------- |
| `ActionEnvelope` | `seq`       | non-negative integer | The sequence number of the request                                                  |
| `ActionEnvelope` | `action`    | any JSON             | The runtime's JSON of a candidate action; `readCandidateAction` reads it            |
| `ViewEnvelope`   | `seq`       | non-negative integer | The number of the request it answers                                                |
| `ViewEnvelope`   | `view`      | any JSON             | The runtime's JSON of a candidate view; `readView` reads it                         |
| `ViewEnvelope`   | `assets`    | object of strings    | Each asset prefix, a directory that is empty or ends in `/`, mapped to its base URL |
| `ViewEnvelope`   | `documents` | `ViewDocuments`      | Where the content comes from. Default: none, so that references resolve at the root |
| `ViewEnvelope`   | `refusal`   | refusal              | Why the action was not applied. Default: none, the action was applied               |

## Refusal

When the engine refuses a well-formed action, the host answers with the view of the state as it was, and the refusal in the
envelope. A refusal has the properties `reason` and `message` of the runtime's `Refusal`. `REFUSAL_REASONS` of
`@assesskit/runtime/delivery/wire` lists the reasons, and the player has a message for each ([delivery](delivery.md#refusals-and-status-messages)).

## Documents

A reference in content is written against the document that holds it, and the view does not say which document that is. The
host does, with `documents`.

| Property   | Meaning                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test`     | The path of the test document. `""` is the root of the package.                                                                                                |
| `item`     | The path of the document of the item presented; `""` for a variant, whose path the runtime does not know, and for a link to a tool, which has no QTI document. |
| `stimuli`  | The paths of the documents of its stimuli, in the order of the view.                                                                                           |
| `lexicons` | The paths of the pronunciation lexicons (PLS) that the item depends on, which reading aloud uses ([speech](speech.md#lexicons)).                               |

A path is a path in the package. Without `documents`, every reference resolves against the root. The session host and the local
session build them from the documents of their test.

## The frame of an LTI item

`LtiFrame` is what the host's route answers the player's `ltiLogin` hook with. The host builds it with its LTI platform library ([LTI items](lti-items.md)); the player checks it.

| Property     | Meaning                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| `url`        | The tool's third-party initiated login, an absolute `http` or `https` URL                                   |
| `storageUrl` | The platform's storage page, an absolute `http` or `https` URL                                              |
| `allow`      | The `allow` list of the tool's frame. Default: none, so that the tool may use no feature needing permission |

An allow list holds letters, digits, spaces and the characters `; * : / . ' -`. A `javascript:` or `data:`
URL is never a frame URL. `LTI_TOOL_FRAME` (`lti-tool`) and `LTI_STORAGE_FRAME` (`lti-storage`) are the names of the two frames,
by which the storage page and the tool look each other up.

## The session client

`SessionClient` is the one interface the player mounts against, whether the engine runs on a server or on the device
([client](client.md)).

| Member                       | Meaning                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `view`                       | The latest view.                                                                                                                  |
| `documents`                  | The documents the content of the latest view comes from.                                                                          |
| `age()`                      | The milliseconds since the view was built or received, on the client's clock.                                                     |
| `assets(path)`               | The URL of a path of the package: the base URL of the longest asset prefix of the latest view that holds the path, plus the path. |
| `dispatch(action, options?)` | Sends an action and resolves with `{ view, refusal? }`: the view after it, or the view as it was with the refusal of the engine.  |
| `refresh(options?)`          | Asks the session for its latest view and resolves with it, for a candidate who waits for someone else to act.                     |
| `subscribe(listener)`        | Calls the listener with every new view, and returns the function that removes it.                                                 |
| `close()`                    | Stops the timers and the listeners of the client.                                                                                 |

## The host session

`HostSession` is the host's side of one candidate session: it gives the engine the actions that only the host may send, and
reads what the engine waits on the host for. The session host of a server and the local session of a device both offer it,
so a host writes its scoring code once.

```mermaid
flowchart LR
  subgraph impl["Implementations"]
    SH["SessionHost.session(id)<br/>server, any process"]
    LS["LocalSession.host<br/>device"]
  end
  HS{{"HostSession<br/>apply · pending · scorerView · results"}}
  SH -. implements .-> HS
  LS -. implements .-> HS
  SC["Host's scoring code, written once<br/>scorerView → buildSubmission → scorer → buildSupplyScores → apply"] --> HS
  T1["server: rater endpoint"] -->|calls| SC
  T2["device: host.subscribeSteps"] -->|calls| SC
```

| Method                          | Does                                                                                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apply(action, options?)`       | Applies a `time`, `supply-scores` or `cat-response` action, stamped by the session's clock and never before the latest step, and saves the state when the engine accepts it. Resolves with a `HostStep`. |
| `pending(options?)`             | Returns what the engine waits on the host for: scoring requests without a value, and CAT requests.                                                                                                       |
| `scorerView(request, options?)` | Returns what a scorer needs to rate a request, the correct responses included.                                                                                                                           |
| `results(options?)`             | Returns the results report of the session; it is provisional while scoring requests are pending.                                                                                                         |

| Type               | Property     | Meaning                                                                                                                                                |
| ------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HostStep`         | `events`     | The events of the step, in order; empty when the action was refused or changed nothing.                                                                |
| `HostStep`         | `refusal`    | Why the engine refused the action, as a value. Default: none, the action was applied.                                                                  |
| `HostStep`         | `catFailure` | The `request` and `message` of a CAT request that the option `cat` failed to answer after the step; the step stands. Default: none.                    |
| `HostApplyOptions` | `scoredBy`   | Who supplies a score, such as the rater or the scoring service: a non-empty string that a session host passes to its log with the step. Default: none. |

A `time` action that finds nothing to do is accepted with no events; it is refused only as `ended` or `suspended`. A second
`supply-scores` for one request replaces the first and reports `scores-replaced`. `supply-scores` and `cat-response` are accepted
after the test ended while their request exists.

| Behavior                | Session host (`session(id)`)                                                                               | Local session (`host`)                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apply`                 | Checks the type, loads, stamps, applies, schedules the deadlines, saves by version and forwards the events | Checks the type, queues behind earlier calls, stamps, saves, then applies, re-arms the timer and calls the listeners       |
| Refusal                 | Returned as `HostStep.refusal`; nothing is saved or forwarded                                              | Returned as `HostStep.refusal`; nothing is saved and no step listener runs, while the view listeners run as for any answer |
| `scoredBy`              | Passed to the log with the step of a `supply-scores` action                                                | Ignored: a local session forwards nothing                                                                                  |
| `pending`, `scorerView` | Load the session, then ask the engine                                                                      | Queued behind earlier calls, so they see the state those calls left                                                        |
| `results`               | Branded                                                                                                    | Never branded, so `buildSessionScore` refuses it                                                                           |
| After `close()`         | A session host has no `close`                                                                              | `apply` and `subscribeSteps` throw `DataError`; the reads still work                                                       |
| Step feed               | `onStep(step)` for every step with events, in every process, the start included                            | `subscribeSteps(listener)` for the steps with events that are saved after the call                                         |
| Scorer view             | Holds the correct responses: call it only from a rater's endpoint, never from a candidate's                | Holds the correct responses by design, because the device holds them already                                               |

A signal reaches every call that waits on a store or a service.

| Point                                                    | Effect of an aborted signal                                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Before a queued local action or read runs                | The call rejects with `signal.reason`; the action is dropped                                               |
| `createLocalSession`, before its load and its first save | The call rejects with `signal.reason`; a session already saved stays, and a new call resumes it            |
| `load` of a store                                        | The store may reject, and then the call rejects; nothing was applied                                       |
| `save` of a store                                        | Passed to the store, which rejects only when nothing was saved                                             |
| After the save                                           | Ignored by the step: forwarding and listeners complete                                                     |
| `dispatch` of a remote client, not yet sent              | The call rejects; nothing is sent                                                                          |
| `dispatch` of a remote client, in flight                 | The signal goes to the `Transport`. An abort leaves the request in doubt, to be sent again unchanged first |
| `set-responses` held for autosave                        | The abort ends the caller's wait. The responses are still sent, because a draft must not be lost           |

Where a host wires each concern:

| Concern | Server                                                                                                         | Device                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Scoring | The rater endpoint: `session(id)`, `pending`, `scorerView`, `buildSubmission`, then `apply(..., { scoredBy })` | `host.subscribeSteps` on `scoring-requested`, plus one check of `pending()` after creation |
| Time    | The scheduler's job: `session(id).apply({ type: "time" })`                                                     | Automatic: the local session fires `time` at each maximum time                             |

## Branded results

`SessionHost.session(id).results()` returns a report of type `OfficialResult`. The host records the object it returns in a private `WeakSet`,
and a score is built only from a value in it: a copy of the report, a report parsed from JSON and the report of a practice
session are not. The marking function is not exported; only `server` may reach it, through the `internal.ts` of the
module (lint). A service that reports a score takes only an `OfficialResult` and refuses any other object.

## Submission

A `Submission` is what a rater or a scorer service needs to rate one externally scored outcome. `buildSubmission` of
[scoring](scoring.md) writes it from the runtime's scorer view, and `mountSubmission` of `@assesskit/player/player` shows it. It
holds the correct responses of the items, so it goes only to raters. Its `scoringRubric`, when the outcome has one, is the
runtime's `ScoringRubric`, which `mountRatingForm` ([rating](rating.md)) turns into a form.

## Errors

Every refusal is a `DataError` with a sentence that names the path of the first problem. The session host, the remote client, the
local session, `mountSubmission` and the LTI slot run the checks on what they receive; none is exported.

| What is refused              | When                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A `Caller`                   | `value` is not an object with a non-empty `session` and `principal`                                                                                                                                                                                                      |
| An action or a view envelope | `value` is not an object, has a property outside the table, or has a `seq` that is not a non-negative safe integer                                                                                                                                                       |
| An action envelope           | `action` is missing                                                                                                                                                                                                                                                      |
| A view envelope              | `view` is missing, `assets` is not an object of strings by directories, `documents` or `refusal` is malformed (a refusal is an object with a `reason` of the runtime's `REFUSAL_REASONS` and a string `message`)                                                         |
| An `LtiFrame`                | `value` is not an object of `url`, `storageUrl` and `allow` only, a URL is not absolute `http` or `https`, or `allow` is empty or has a character outside an allow list                                                                                                  |
| A `Submission`               | a property outside the form, a field of another type, a time outside the years 1 to 9999, content that is not a list of nodes with a string `kind`, a scoring rubric that `checkScoringRubric` refuses, a part that names an item the submission lacks, or an item twice |

## Not included

| Not included                            | Why                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| The routes, HTTP and the authentication | The host's: it gives the session host an authenticated `Caller`, and the envelopes are the JSON that the two send each other |
| A session identifier in an envelope     | The host takes it from the authenticated request, so that a candidate cannot name another candidate's session                |
| A DOM, Node.js, timer or network API    | The module uses none: a client and a host implement the ports                                                                |

## Differences from the references

None. QTI defines no protocol between a browser and a session host: the envelopes are the player's own form of the runtime's JSON of actions and views.
