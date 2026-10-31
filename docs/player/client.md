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

## Remote session

```ts
import { createRemoteSession } from "@assesskit/player/client";
import type { ViewEnvelope } from "@assesskit/player/protocol";

async function transport(envelope: unknown): Promise<ViewEnvelope> {
  const response = await fetch("/exam/handle", { method: "POST", body: JSON.stringify(envelope) });
  if (!response.ok) throw new Error(`The host answered ${response.status}.`);
  return response.json();
}

const initial: ViewEnvelope = await (await fetch("/exam/view", { method: "POST" })).json();
const client = createRemoteSession(transport, initial);
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

const saved = new Map<string, string>();
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
client.view.current?.title; // "Question"
```

`createLocalSession(options)` is asynchronous because it loads the engine. It throws `DataError` when an option is not of its
type, the engine cannot be created from the definition, or the session cannot start.

| Option       | Type                                  | Meaning                                                                                                      |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `definition` | `DeliveryDefinition`                  | What to deliver: a test, or an item alone for a preview (the runtime E12).                                   |
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

```ts
import { dependencyClosure, type QtiPackage, resourcePath } from "@assesskit/runtime/package";

declare const pkg: QtiPackage;

const lexicons = (item: string): string[] => {
  const { manifest } = pkg;
  const resource = manifest.resources.find((each) => resourcePath(manifest, each) === item);
  if (resource === undefined) return [];
  return dependencyClosure(manifest, resource.identifier)
    .filter(({ type }) => type === "pls")
    .flatMap((each) => resourcePath(manifest, each) ?? []);
};
```

The server's session host finds them the same way for an exam.
