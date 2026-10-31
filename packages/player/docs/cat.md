# CAT

The player implements the runtime's `CatPort`, the six requests of a CAT 1.0 engine, for the server. The runtime makes no network request and
runs no CAT algorithm; the player supplies the engines it calls. It runs on any server runtime.

| Subpath                            | Export                                            | Purpose                                                                                          |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@assesskit/player/cat`            | `restCatPort(options)`                            | A client of a remote engine, over the REST/JSON binding of CAT 1.0.                              |
| `@assesskit/player/cat`            | `deployCatSections(pkg, port)`                    | Creates the sections of a package's adaptive selections at the engine and checks their pool.     |
| `@assesskit/player/cat`            | `CatFetch`, `CatFetchRequest`, `CatFetchResponse` | The part of `fetch` that `restCatPort` uses.                                                     |
| `@assesskit/player/cat`            | `OAuthClientCredentials`, `DeployedCatSection`    | The client credentials with which `restCatPort` asks for a token, and what a deployment returns. |
| `@assesskit/player/cat/measurekit` | `measurekitCatPort(options)`                      | An engine in process for item-level adaptive sections, over measurekit's `adaptiveTest`.         |
| `@assesskit/player/cat/measurekit` | `measurekitPanelPort(options)`                    | An engine in process for calibrated multistage panels, over measurekit's `multistageTest`.       |
| `@assesskit/player/cat/measurekit` | `SectionStore`, `StoredSection`                   | The host's storage of the sections that the two measurekit ports parse.                          |
| `@assesskit/player/cat/measurekit` | `PanelParameters`, `CategoryOfOutcomes`           | The arguments of the two measurekit ports.                                                       |

measurekit is an optional peer dependency. A host that uses the ports in process installs `@measurekit/psychometrics` (version 1 or
later) and imports `@assesskit/player/cat/measurekit`; `@assesskit/player/cat`, with the REST port and the deployment,
loads no module of measurekit, so a host without measurekit imports every subpath of the player.

The delivery engine of the runtime makes the session requests (`drainCat`). A host deploys once, then gives the port and the map
that `deployCatSections` returns to the delivery:

```ts
import { Buffer } from "node:buffer";
import { writeUsageData } from "@assesskit/runtime/usage";
import { type SectionStore, measurekitCatPort } from "@assesskit/player/cat/measurekit";

const kept = new Map<string, string>();
const sections: SectionStore = {
  put: async (identifier, section) => void kept.set(identifier, JSON.stringify(section)),
  get: async (identifier) => {
    const text = kept.get(identifier);
    return text === undefined ? undefined : JSON.parse(text);
  },
};
const statistic = (item: string, name: string, value: number) => ({
  kind: "ordinary" as const,
  name,
  context: "http://example.org/calibration",
  targetObjects: [{ identifier: item }],
  value: { value },
});
const usage = writeUsageData({
  statistics: [
    statistic("q1", "A-Param", 1.2),
    statistic("q1", "B-Param", -0.5),
    statistic("q2", "A-Param", 1),
    statistic("q2", "B-Param", 0.5),
  ],
});
const base64 = (text: string) => Buffer.from(text).toString("base64");

const port = measurekitCatPort({ sections, seeds: () => 42 });
const prefix = "https://cat.example/ims/cat/v1p0";
const { sectionIdentifier } = await port.createSection(prefix, {
  sectionConfiguration: base64(JSON.stringify({ length: 2 })),
  qtiUsagedata: base64(usage),
});
sectionIdentifier; // "bd7ae2d5756187a00f13c61536236902e01ab570104464bfa96f7b3979ddc65d"
const created = await port.createSession(prefix, sectionIdentifier, {});
created.nextItems; // { itemIdentifiers: ["q1"], stageLength: 1 }
```

## Sections

A section is the configuration of an adaptive selection. The measurekit ports read the three files of its section data (CAT §4.1):
the settings, the usage data and the metadata.

- **Identifier.** A section is named by the SHA-256, in lowercase hexadecimal, of the UTF-8 JSON array
  `[sectionConfiguration, qtiUsagedata, qtiMetadata]`, with `null` for a field that is absent. Every process and every
  deployment of one section data has one identifier, and creating it again changes nothing.
- **Store.** Create Section parses the files and puts the result in the host's `SectionStore`. A stored section is plain
  data that JSON serializes: the section data as received, the parameters of the usage data as the bank states them, and
  the settings. Both ports share one store, and any process that reads it answers any request.
- **End.** `endSection` of the measurekit ports does nothing: other deployments with the same section data share the section.
  The host prunes the store by its own retention.
- **Metadata.** The measurekit ports keep the metadata file and do not read it.

### Settings

The settings file is JSON. A property that is not listed is an error.

| Section  | Property           | Type                                  | Meaning                                                                   |
| -------- | ------------------ | ------------------------------------- | ------------------------------------------------------------------------- |
| adaptive | `length`           | positive integer, required            | The number of items after which the test ends.                            |
| adaptive | `contentTargets`   | object of area and number, optional   | The target proportion of each content area, for content balancing.        |
| adaptive | `enemies`          | array of arrays of item ids, optional | Sets of items that must not appear in one test.                           |
| panel    | `stages`           | array, required                       | The stages in order; the first has one module.                            |
| panel    | `stages[].modules` | array of `{ id, items }`              | The modules of a stage: an identifier and the identifiers of their items. |

### Usage data

The usage data gives the parameters of the items of a logistic model. Only ordinary statistics about a whole item are read
(UD §2.8.2); other statistics, statistics of a part and categorized statistics are left alone.

| Statistic | Property | Default | Meaning                                                            |
| --------- | -------- | ------- | ------------------------------------------------------------------ |
| `B-Param` | `b`      | none    | The difficulty. An item needs it; an item without one is an error. |
| `A-Param` | `a`      | `1`     | The discrimination.                                                |
| `C-Param` | `c`      | `0`     | The lower asymptote (guessing).                                    |
| `D-Param` | `d`      | `1`     | The upper asymptote of the 4PL, not a scaling constant.            |

A parameter given twice for an item, or a value that is not a number, is a `DataError`. Every item is a measurekit
`fourParameterLogistic` item, which is the 1PL to the 3PL when the defaults apply.

### Scale

measurekit's models are in the IRT form of mirt with D = 1. The usage data does not name its metric, so the host states it with
`scalingConstant`, which multiplies the discrimination `a` of every item of the usage data when a port reads it:

| Bank                                   | `scalingConstant` |
| -------------------------------------- | ----------------- |
| IRT form with D = 1 (mirt, measurekit) | `1` (the default) |
| Normal-ogive metric, D = 1.702         | `1.702`           |

With `1.702`, the logistic `c + (d - c) / (1 + exp(-1.702 a (θ - b)))` is within 0.01 of the normal ogive
`c + (d - c) Φ(a (θ - b))` for every θ (Haley, 1952). The stored section keeps `a` as the bank states it, because one
section data can be deployed on both scales. Items that the host adds through `pool` are measurekit items and are not scaled.

## measurekitCatPort

`measurekitCatPort(options)` returns a `CatPort` that keeps no session. The measurekit state of the candidate and the session seed
travel in the `sessionState` (CAT §3.3, §3.4) as the JSON `{ seed, state }`, which the runtime stores and returns.

| Option            | Default                 | Meaning                                                                                                |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `sections`        | required                | The `SectionStore`.                                                                                    |
| `seeds`           | required                | Returns the seed of a new session, an integer from 0 to 2³² − 1, from the host's source of randomness. |
| `pool`            | no items                | Returns the host's measurekit items for a section, by its identifier. See below.                       |
| `category`        | the `SCORE` of the item | Maps `(item, outcomes)` to the response category of the item's model.                                  |
| `scalingConstant` | `1`                     | The factor for the discrimination of the usage data.                                                   |

| Request                  | Behavior                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create Section           | Reads the settings and usage data, builds the measurekit test to check them, stores the section and returns its identifier. The `prefix` of every request is ignored. |
| Get Section              | Returns the stored section data and the pool as one stage.                                                                                                            |
| Create Session           | Calls `seeds` once, starts the test and returns a one-item stage. The session identifier is the seed in decimal.                                                      |
| Submit Results           | Reads the category of the presented item from its result, takes it as the response and returns the next one-item stage, or the empty stage when the test ends.        |
| End Session, End Section | Do nothing.                                                                                                                                                           |

- **Stages.** A stage is one item, so the delivery engine submits after each item (the runtime C4). The empty stage
  `{ itemIdentifiers: [], stageLength: 0 }` ends the session (CAT §4.2).
- **Randomness.** The draws of a step come from measurekit's `createRandom` seeded with `seed × 2²¹ + n`, where `n` is the number
  of items administered. A repeated request gives the same answer, and no two steps of any two sessions share a seed.
- **Pool.** The pool of a section is the items of the usage data, then the items of `pool(section)`. A host item replaces the
  item with its identifier and keeps its place; a new identifier is added at the end. The host adds the models that usage
  data cannot state, such as the generalized partial credit model, and the attributes only measurekit has: `contentArea` for
  `contentTargets` and `exposure` for Sympson-Hetter control. Items of the usage data have neither.
- **Response.** By default the `SCORE` of the item's result is its category. The category must be a whole number from 0 to one
  less than the categories of the item's model, else `DataError`. An item that the candidate submitted or skipped without a
  response is reported with the status `initial` and no `SCORE` (CAT §4.3.1); it is category 0, and `category` is not asked.
  Results of earlier items in the same request are ignored.
- **Selection.** measurekit's defaults: maximum information, and the posterior mean of theta as the estimate.
- **Outcomes.** The port returns no `assessmentResult`; the estimate is in the state.
- **PNP.** The port reads none of the personal data of Create Session.

## With the runtime's engine

A deployment creates the sections once, and the delivery engine takes their identifiers in `catSections`. Any process that
shares the `SectionStore` can then answer the requests of any session, because the engine keeps the session in its state and
hands the `sessionState` back with each request:

```ts
import { createEngine, drainCat } from "@assesskit/runtime/delivery";
import { packageResolvers, type QtiPackage } from "@assesskit/runtime/package";
import { deployCatSections } from "@assesskit/player/cat";
import { type SectionStore, measurekitCatPort } from "@assesskit/player/cat/measurekit";

async function begin(pkg: QtiPackage, sections: SectionStore) {
  const port = measurekitCatPort({ sections, seeds: () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0 });
  const catSections = await deployCatSections(pkg, () => port); // once, when the test is deployed
  const document = pkg.document("test.xml");
  if (document.kind !== "test") throw new Error("test.xml is not a test.");
  const engine = createEngine({
    kind: "test",
    test: document.test,
    base: "test.xml",
    resolvers: packageResolvers(pkg),
    catSections,
  });
  const started = engine.start({ seed: 1, at: Date.now() });
  if (!started.ok) throw new Error(started.refusal.message);
  // Create Session: the engine presents the first item once the port has answered.
  return { engine, state: await drainCat(engine, started.state, port, Date.now) };
}
```

After each submitted item the engine waits for Submit Results (the runtime C4): call `drainCat` again, with the port of any process,
and then let the candidate move on. The engine asks for End Session only when the candidate leaves before the port ended the
session with the empty stage.

## measurekitPanelPort

`measurekitPanelPort(options)` returns a `CatPort` for a multistage panel with routing by the estimate of theta. Its stage is a
module: all its items, in order, with the module's length as the stage length. Routing draws no random number, so the port
takes no seeds. The `sessionState` is the JSON of measurekit's `MultistageTestState`, and the session identifier is the section's.

| Option            | Default  | Meaning                                                        |
| ----------------- | -------- | -------------------------------------------------------------- |
| `sections`        | required | The `SectionStore`.                                            |
| `panels`          | required | Returns the `PanelParameters` of a section, by its identifier. |
| `scalingConstant` | `1`      | The factor for the discrimination of the usage data.           |

`PanelParameters.cuts` maps the identifier of a module to its cut points on the theta scale: ascending, one fewer than the
modules of the next stage. A person goes to module j of the next stage, counting from 0, when exactly j cuts are at most the
estimate. Every item of a module needs parameters in the usage data, which Create Section checks.

## restCatPort

`restCatPort(options)` returns a `CatPort` that speaks the REST/JSON binding of CAT 1.0
(<https://www.imsglobal.org/spec/cat/v1p0/bind>) to one remote engine.

| Option        | Default  | Meaning                                                                           |
| ------------- | -------- | --------------------------------------------------------------------------------- |
| `fetch`       | required | `fetch`, or a replacement.                                                        |
| `endpoint`    | required | The `https` URL prefix of the engine, such as `https://cat.example/ims/cat/v1p0`. |
| `credentials` | required | `{ tokenUrl, clientId, clientSecret, scope }`; `tokenUrl` is an `https` URL.      |
| `timeoutMs`   | `10000`  | The milliseconds after which a request, the token request included, is aborted.   |
| `sharePnp`    | `false`  | Whether Create Session sends the personal needs and preferences to the engine.    |

| Request        | HTTP                                                       | Body                                                       |
| -------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Create Section | `POST {endpoint}/sections`                                 | The section data.                                          |
| Get Section    | `GET {endpoint}/sections/{id}`                             | none                                                       |
| Create Session | `POST {endpoint}/sections/{id}/sessions`                   | `personalNeedsAndPreferences`, `demographics`, `priorData` |
| Submit Results | `POST {endpoint}/sections/{id}/sessions/{session}/results` | `assessmentResult` and `sessionState`                      |
| End Session    | `DELETE {endpoint}/sections/{id}/sessions/{session}`       | none                                                       |
| End Section    | `DELETE {endpoint}/sections/{id}`                          | none                                                       |

- **One engine.** The `prefix` of a request must be the `endpoint`, else `DataError` and nothing is sent. A package names the
  engine in `qti-adaptive-engine-ref`, and the host trusts the engine it configured (CAT §2.2). Give each engine its own port.
- **Authorization.** The port asks the token endpoint for a bearer token with the client credentials grant: HTTP Basic with
  the form-encoded client identifier and secret, and `grant_type=client_credentials&scope=…` (binding §4.2, RFC 6749
  §4.4). The binding recommends the scope `https://purl.imsglobal.org/cat/v1p0/scope/api` for every endpoint, or
  `.../scope/configure` for sections and `.../scope/deliver` for sessions; an engine may define others.
- **Token.** The port keeps the token. It reads no clock, so it learns that the token expired from a `401`: it asks for a new
  token and repeats the request once.
- **Transport.** Every URL is `https` (binding §4.1). Redirects are errors, because a redirect would send the token to
  another address. The error of `fetch`, such as a timeout, is passed on unchanged.
- **Failure.** A status other than 2xx, and a body that is not JSON, are a `ServiceError` with the `status` and the `body`.
- **Personal data.** Without `sharePnp` the body of Create Session has no `personalNeedsAndPreferences`.

### JSON

The names of the JSON are those of the binding (§5, Appendix B). The runtime's `cat` module writes and reads the assessment result
and the item stage (the JSON binding section of the runtime's CAT guide), and the port reads and writes the rest of the bodies:

| runtime                                      | Binding                                                |
| -------------------------------------------- | ------------------------------------------------------ |
| `GetSectionResponse.sectionData` and `items` | `section` and `items`                                  |
| `PriorDataEntry` `{ name, value }`           | `{ key, value }`; a value that is not text is its JSON |

An engine may leave out the context of the result it returns (CAT §4.3.2); the result then has no session identifiers.

### Section metadata

The two normative documents of CAT 1.0 disagree about `qtiMetadata` of the section:

| Source                                             | Type of `qtiMetadata`                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| CAT Service §4.1 (and the runtime's `SectionData`) | The base64 text of the file that `qti-metadata-ref` references: the JSON of App. B, with one record for each item.   |
| REST/JSON binding, `SectionDType` (§5.2.1, App. B) | An object of `QTIMetadataDType`: one QTI metadata record (`composite`, `interactionType`, `scoringMode`, and so on). |

The port follows the binding, because it defines the JSON on the wire: CAT §3 sends the reader to the binding for the full
technical details of the requests and their bodies, and the schema has `additionalProperties: false`, so an engine that
validates the body rejects text where it expects an object. The metadata file of the section data is not a
`QTIMetadataDType` record, so no field of the binding carries it:

- **Create Section** sends `sectionConfiguration` and `qtiUsagedata` only. The metadata file does not reach the engine, though
  CAT §4.1 says a platform must transmit it. The binding gives the file no place, so an engine cannot read it over REST.
- **Get Section** accepts a `qtiMetadata` object, checks that it is one, and leaves it out of the section data.

`datestamp` is a `date-time` of RFC 3339 in the binding's schema; the port sends the `xs:dateTime` of the result as it is.

The binding's OpenAPI 3 file is named in Appendix B of the binding as
`https://purl.imsglobal.org/cat/v1p0/schema/openapi/imscatv1p0_openapi3_v1p0.json`; that address does not serve the file. The
listing in Appendix B1.2 of <https://www.imsglobal.org/spec/cat/v1p0/bind> is the text the codec of the runtime was written against.

## deployCatSections

`deployCatSections(pkg, port)` deploys the adaptive sections of every test of a package, in document order. For each:

1. It reads the files that the `qti-adaptive-selection` references, against the document that holds the section: the
   settings, and the usage data and the metadata when referenced. A selection without a settings reference sends an empty
   settings file, because the engine may be configured elsewhere (CAT §2.2).
2. It calls `port(selection)` for the engine, which is the host's choice by `qti-adaptive-engine-ref`.
3. It makes Create Section with `sectionData` of the runtime, then Get Section, and checks the pool against the item references
   with `checkPool` (CAT §2.1, §2.2).

The result maps the identifier of each adaptive section to `{ prefix, sectionIdentifier }`, which is
`DeliveryDefinition.catSections`. Create Section is not idempotent at a remote engine, so deploy once. When a check fails,
the sections made so far stay, and the `DataError` names the section at the engine, so that the host can end it.

## Errors

| Error          | When                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DataError`    | An option or an argument has the wrong type, or section data, a `sessionState` or an engine's answer is malformed. |
| `ServiceError` | The engine answers with a status other than 2xx, or with a body that is not JSON, or the token endpoint fails.     |

Errors of the runtime pass through unchanged: `ReadError` and `SecurityError` of the usage data and the package, and the `DataError`
of the runtime for an assessment result or an item stage of an answer that is not the JSON of the binding. The errors of measurekit pass
through unchanged too.
measurekit reports a section that cannot run, such as content targets without content areas or cut points that do not match the
modules, when the section is created.
