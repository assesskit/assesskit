# Client

`@assesskit/player/client` has the two session clients that the player mounts against. Both implement `SessionClient`
of the [protocol](protocol.md#the-session-client), so the player never knows the mode. The browser code holds no answer
key in an exam: it imports only `viewFromJson` and `actionToJson` from the runtime's `delivery`, and a test bundles the player and
the remote session and fails if any file of the engine has code in the output. Only `createLocalSession` loads the engine,
with `import()`.

| Client                | Mode     | Where the engine runs | Keys on the device |
| --------------------- | -------- | --------------------- | ------------------ |
| `createRemoteSession` | exam     | the server            | no                 |
| `createLocalSession`  | practice | the device            | yes, by design     |

```mermaid
sequenceDiagram
  participant P as Player
  participant C as Remote session client
  participant H as Session host
  P->>C: dispatch(set-responses)
  Note over C: Held and merged by item,<br/>sent AUTOSAVE_MS after the last one
  P->>C: dispatch(submit)
  C->>H: the held responses first, then ActionEnvelope (seq + 1)
  alt no answer arrives
    Note over C: The request stays in doubt and is sent<br/>again, unchanged, before any later one
  end
  H-->>C: ViewEnvelope (same seq)
  C->>C: viewFromJson, resolve assets, notify listeners
  C-->>P: DispatchResult {view, refusal?}
  Note over C,H: At FLUSH_BEFORE_DEADLINE_MS before a timer ends, the held<br/>responses go; at 0 an empty set-responses learns the time-out
```

## Remote session

```ts
import { readAsi } from "@assesskit/runtime/asi";
import { createEngine, viewToJson } from "@assesskit/runtime/delivery";
import { createRemoteSession } from "@assesskit/player/client";

// A page gets the first envelope from the route of `SessionHost.view` and sends the others to the route of `SessionHost.handle`.
// Here an engine on the page makes the envelopes, which only shows the calls.
const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="q1" title="Question" adaptive="false" time-dependent="false">
  <qti-item-body><p>Hello</p></qti-item-body>
</qti-assessment-item>`);
const engine = createEngine({ kind: "item", item: document.item, base: "items/q1.xml" });
const started = engine.start({ seed: 1, at: 0 });
const view = viewToJson(engine.view(started.state, 0));

const sent = [];
const transport = async (envelope) => {
  sent.push(envelope.seq);
  return { seq: envelope.seq, view, assets: { "": "https://assets.example/g/token/" } };
};
const client = createRemoteSession(transport, { seq: 0, view, assets: {} });
const answer = await client.dispatch({ type: "end-test" });
sent; // => [1]
answer.view.current?.title; // => "Question"
client.assets("items/q1.xml"); // => "https://assets.example/g/token/items/q1.xml"
client.close();
```

`createRemoteSession(transport, initial, options)` throws `DataError` when an argument is not of its type.

| Argument    | Type           | Meaning                                                                                        |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `transport` | `Transport`    | Sends an `ActionEnvelope` to the host and resolves with its `ViewEnvelope`.                    |
| `initial`   | `ViewEnvelope` | What `SessionHost.start` or `SessionHost.view` gave. The first request has its `seq` plus one. |
| `clock`     | `Clock`        | In the options. Times the age of a view. Default: the clock of the browser, `BROWSER_CLOCK`.   |

### What the client does

| Duty         | Behavior                                                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sequence     | One request at a time, each with the next `seq`. The answer is read with `viewFromJson`; an answer to another `seq` is a `DataError`.                                                                                                                                                      |
| Lost answers | A request that got no answer, such as a network failure, may have been applied. It is sent again, unchanged, before any later request, and the host answers a repeated `seq` with the answer it stored. A request that the host rejected (`DataError` or `AccessError`) is not sent again. |
| Autosave     | `set-responses` actions are held and merged, by item, and sent `AUTOSAVE_MS` (1000) after the last. Every promise of a held action resolves with the answer to the merged request.                                                                                                         |
| Flush        | The held responses go first before any other action, when the page becomes hidden, and `FLUSH_BEFORE_DEADLINE_MS` (10,000) before the nearest timer reaches 0.                                                                                                                             |
| Deadline     | At 0 the client sends the held responses, or an empty `set-responses` for the item presented, to learn from the host whether the time-out happened. The host's view shows a passed deadline as applied.                                                                                    |
| Assets       | `assets(path)` joins the base URL of the longest prefix of the latest envelope that holds the path with the path. A path no prefix holds gets `about:blank`, which loads nothing.                                                                                                          |
| Age          | `age()` is the milliseconds since the view was received, on the client's clock; the timers count down from it.                                                                                                                                                                             |

`close()` stops the timers and removes the listener of the page. Further `dispatch` calls reject with `DataError`.

## Local session

```ts
import { readAsi } from "@assesskit/runtime/asi";
import { createLocalSession } from "@assesskit/player/client";

const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="q1" title="Question" adaptive="false" time-dependent="false">
  <qti-item-body><p>Hello</p></qti-item-body>
</qti-assessment-item>`);
if (document.kind !== "item") throw new Error("The document is not an item.");

const saved = new Map();
const client = await createLocalSession({
  definition: { kind: "item", item: document.item, base: "items/q1.xml" }, // a preview of one item
  store: {
    load: async (session) => saved.get(session),
    save: async (session, state) => void saved.set(session, state),
  },
  session: "preview-1",
  seed: 1,
  assets: (path) => `/package/${path}`,
});
client.view.current?.title; // => "Question"
```

`createLocalSession(options)` is asynchronous because it loads the engine. It throws `DataError` when an option is not of its
type, the engine cannot be created from the definition, or the session cannot start.

| Option       | Type                                  | Meaning                                                                                                      |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `definition` | `DeliveryDefinition`                  | What to deliver: a test, or an item alone for a preview.                                                     |
| `engine`     | `EngineOptions`                       | The options of `createEngine`. Default: none.                                                                |
| `start`      | `Omit<StartOptions, "seed" \| "at">`  | The PNP, the universal supports and the context of `Engine.start`. Default: none.                            |
| `store`      | `LocalStore`                          | Where the state is saved and restored from: `load(session)` and `save(session, state)`.                      |
| `session`    | `string`                              | The identifier of the session in the store.                                                                  |
| `seed`       | `number`                              | The seed of a session that the store does not have yet, a safe integer.                                      |
| `assets`     | `(path: string) => string`            | Turns the path of a file in the package into the URL to load it from.                                        |
| `lexicons`   | `(item: string) => readonly string[]` | The paths of the pronunciation lexicons that the item whose document is at `item` depends on. Default: none. |
| `clock`      | `Clock`                               | Stamps actions and times the deadlines. Default: the clock of the browser.                                   |

It stamps each action with `stamp(state, action, now)`, saves the state after each accepted step, and fires a `time` action
at each maximum time with `setTimeout`, so a time-out happens on the device without a server. A store that has the session
resumes it. The candidate can suspend and resume. Results of practice are never official: nothing here brands a report, so
`publishScore` refuses them.

A preview of one item is a session of `{ kind: "item", item, base }`; `documents.item` is `base`.

The session has the engine and the definition but not the package, so a host that wants reading aloud to use the lexicons of
the items names them with `lexicons`, from the manifest of the package it made the definition from:

A lexicon is a resource of type `pls` among the dependencies of the item's resource, so a host reads it with `dependencyClosure` of
`@assesskit/runtime/package` and `resourcePath`: find the resource whose path is the item's, filter its closure for `pls`, and
return the paths.

The server's session host finds them the same way for an exam.
