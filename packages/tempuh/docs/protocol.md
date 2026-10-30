# Protocol

The protocol is what a browser and a session host send each other. It is JSON around olah's JSON forms, which olah writes
and reads: `actionToJson` and `parseCandidateAction` for actions, `viewToJson` and `viewFromJson` for views. The checks
here look at the envelope only; olah reads what is inside.

```ts
import { checkActionEnvelope } from "@luthfanwakan/tempuh/protocol";

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

| Envelope         | Properties                                                                                                                | Sent by |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| `ActionEnvelope` | `seq`: a non-negative integer; `action`: olah's JSON of a candidate action                                                | client  |
| `ViewEnvelope`   | `seq`: the number it answers; `view`: olah's JSON of a candidate view; `assets`: each asset prefix mapped to its base URL | host    |

`seq` makes a request idempotent: a repeated number returns the answer already given, and a stale one is refused.

`checkActionEnvelope(value)` and `checkViewEnvelope(value)` throw `DataError` when `value`

- is not an object;
- has a property other than those of its row, such as `session`;
- has a `seq` that is not a safe integer of at least 0;
- lacks `action` or `view`;
- has `assets` that is not an object whose values are strings (`ViewEnvelope`).

```ts
import { checkActionEnvelope } from "@luthfanwakan/tempuh/protocol";

checkActionEnvelope(JSON.parse('{"seq":1,"action":{},"session":"s2"}'));
// DataError: An action envelope has the properties "seq" and "action", found "session".
```
