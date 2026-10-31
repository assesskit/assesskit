# Protocol

The protocol is what a browser and a session host send each other. It is JSON around the runtime's JSON forms, which the runtime writes
and reads: `actionToJson` and `parseCandidateAction` for actions, `viewToJson` and `viewFromJson` for views. The checks
here look at the envelope only; the runtime reads what is inside. The submission that a rater reads is the one form that the player
itself defines, because the server writes it and the browser shows it.

```ts
import { checkActionEnvelope } from "@assesskit/player/protocol";

const envelope: unknown = JSON.parse('{"seq":3,"action":{"type":"move"}}');
checkActionEnvelope(envelope);
envelope.seq; // 3
```

## Caller

`Caller` is the identity that the host's authentication gives to a request. It never comes from the client.

| Property    | Type     | Meaning                                                                                     |
| ----------- | -------- | ------------------------------------------------------------------------------------------- |
| `session`   | `string` | The identifier of the session the request is about                                          |
| `principal` | `string` | The identifier of the authenticated principal; a session belongs to the one that started it |

`checkCaller(value)` throws `DataError` unless `value` is an object with a non-empty `session` and `principal`. Other
properties are ignored, because a host may pass a richer object.

## Envelopes

An envelope has no session identifier. The host takes the session from the authenticated request, so a candidate cannot
name another candidate's session.

| Envelope         | Properties                                                                                                                                                                                                                                   | Sent by |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `ActionEnvelope` | `seq`: a non-negative integer; `action`: the runtime's JSON of a candidate action                                                                                                                                                            | client  |
| `ViewEnvelope`   | `seq`: the number it answers; `view`: the runtime's JSON of a candidate view; `assets`: each asset prefix mapped to its base URL; `documents` (optional): where the content comes from; `refusal` (optional): why the action was not applied | host    |

`seq` makes a request idempotent: a repeated number returns the answer already given, and a stale one is refused.

`checkActionEnvelope(value)` and `checkViewEnvelope(value)` throw `DataError` when `value`

- is not an object;
- has a property other than those of its row, such as `session`;
- has a `seq` that is not a safe integer of at least 0;
- lacks `action` or `view`;
- has `assets` that is not an object whose values are strings (`ViewEnvelope`);
- has `documents` that are not [documents](#documents), or a `refusal` that is not [a refusal](#refusal) (`ViewEnvelope`).

```ts
import { checkActionEnvelope } from "@assesskit/player/protocol";

checkActionEnvelope(JSON.parse('{"seq":1,"action":{},"session":"s2"}'));
// DataError: An action envelope is invalid: unexpected property "session".
```

## Refusal

When the engine refuses a well-formed action, the host answers with the view of the state as it was, and the refusal in the
envelope. A refusal has the properties `code`, `message` and `source` of the runtime's `Refusal`. `REFUSAL_CODES` lists the codes,
and `checkRefusal(value)` throws `DataError` unless `value` is a refusal with one of them. The player has a message for each
code ([delivery](delivery.md#refusals-and-status-messages)).

## Documents

A reference in content is written against its own document (B93), and the view does not say which document that is. The
host does: `documents` has `test`, the path of the test document, `item`, the path of the document of the item presented,
`stimuli`, the paths of the documents of its stimuli, in the order of the view, and `lexicons`, the paths of the pronunciation
lexicons (PLS) that the item depends on, which reading aloud uses ([speech](speech.md#lexicons)); a variant has none. A path is a path in the package; `""` is its
root, which is where a variant's references resolve, since the runtime does not know its path (the runtime E19). Without `documents`, every
reference resolves against the root. `viewDocuments(view, source)` builds them from the `DocumentSource` that a host or a local
session has of its test. A reference that names a link to a tool has no document of QTI, so `item` is `""` for it.

## The frame of an LTI item

`LtiFrame` is what the host's route answers the player's `ltiLogin` hook with: `url`, the tool's login, `storageUrl`, the
platform's storage page, and `allow`, the `allow` list of the tool's frame, which is absent when the registration has none
(`ltiPlatformFrame` builds it). `checkLtiFrame(value)` throws `DataError` unless `value` is an object with those properties
only, the URLs absolute `http` or `https` URLs (never `javascript:` or `data:`) and `allow` an allow list: letters, digits,
spaces and the characters `; * : / . ' -` (`checkAllowList`). `LTI_TOOL_FRAME` (`lti-tool`) and `LTI_STORAGE_FRAME` (`lti-storage`)
are the names of the two frames, which the storage page and the tool look each other up by.

## The session client

`SessionClient` is the one interface the player mounts against, whether the engine runs on a server or on the device
([client](client.md)).

| Member                | Meaning                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `view`                | The latest view.                                                                                                                  |
| `documents`           | The documents the content of the latest view comes from.                                                                          |
| `age()`               | The milliseconds since the view was built or received, on the client's clock.                                                     |
| `assets(path)`        | The URL of a path of the package: the base URL of the longest asset prefix of the latest view that holds the path, plus the path. |
| `dispatch(action)`    | Sends an action and resolves with `{ view, refusal? }`: the view after it, or the view as it was with the refusal of the engine.  |
| `subscribe(listener)` | Calls the listener with every new view, and returns the function that removes it.                                                 |
| `close()`             | Stops the timers and the listeners of the client.                                                                                 |

## Official results

`SessionHost.results` returns a report of type `OfficialResult`. The host marks the object it returns in a private `WeakSet`,
and `isOfficialResult(value)` tells whether a value is one: a copy of the report, a report parsed from JSON and the report of a
practice session are not. The marking function is not exported; only `server/` and `lti/` may import `protocol/official.ts`
(lint). A service that reports a score takes only an `OfficialResult` and refuses any other object.

## Submission

A `Submission` is what a rater or a scorer service needs to rate one externally scored outcome. `toSubmission` of
`@assesskit/player/scoring` writes it from the runtime's scorer view, and `mountSubmission` of `@assesskit/player/player` shows
it ([scoring](scoring.md) lists its properties). It holds the correct responses of the items, so it goes only to raters.

`checkSubmission(value)` throws `DataError` when `value`

- is not an object, or has a property other than those of its form, at any level;
- has a field of another type, such as a `mode` other than `human` or `externalMachine`;
- has a time that a datestamp of the years 1 to 9999 cannot show;
- has content that is not a list of nodes, each an object with a string `kind`;
- has a part that names an item the submission lacks, or an item twice.

```ts
import { checkSubmission } from "@assesskit/player/protocol";

checkSubmission(JSON.parse('{"request":"item:essay:1:SCORE","outcome":"SCORE","mode":"robot"}'));
// DataError: A submission is invalid at mode: expected "human" or "externalMachine", found "robot".
```
