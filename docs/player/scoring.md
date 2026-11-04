# Scoring sessions

An outcome with `external-scored` is one that a person or a machine sets, not processing. The runtime's engine asks the host
for each one with a scoring request and waits (see Scoring requests in the runtime's delivery guide).
`@assesskit/player/scoring` hands a request to a scorer and the score back to the engine; the player shows the request to a
rater.

```mermaid
sequenceDiagram
  participant E as Engine<br/>(runtime)
  participant H as Host<br/>(server)
  participant R as Rater or<br/>scoring service
  E-->>H: pending(state).scoring: a scoring request
  H->>H: buildSubmission(scorerView)
  H->>R: Submission as JSON, with the correct responses
  Note over R: mountSubmission shows it to a person,<br/>mountRatingForm collects the ratings
  R-->>H: the score, or the ratings
  H->>H: buildSupplyScores(request, score, scorer)
  H->>E: apply(state, action with at)
  E-->>H: scores-applied, or scores-replaced for a second score
```

| Step                                  | Where                               | Function                                          |
| ------------------------------------- | ----------------------------------- | ------------------------------------------------- |
| Turn a request into a JSON submission | shared, `@assesskit/player/scoring` | `buildSubmission`                                 |
| Show a submission to a rater          | browser, `@assesskit/player/player` | `mountSubmission`                                 |
| Show a rating form                    | browser, `@assesskit/player/player` | `mountRatingForm` ([rating](rating.md))           |
| Turn ratings into a score             | shared, `@assesskit/runtime/asi`    | `rubricScore`, which the form calls               |
| Turn the rater's score into an action | shared, `@assesskit/player/scoring` | `buildSupplyScores`                               |
| Give the action to the engine         | server or device, the host session  | `session(id).apply(action)`, `host.apply(action)` |
| Read the score of a session           | shared, `@assesskit/player/scoring` | `buildSessionScore`                               |

On a device the page learns of a request from `host.subscribeSteps` on `scoring-requested`, and checks `host.pending()` once after
`createLocalSession` ([client](client.md#the-host-side)); a server's rater endpoint calls `session(id).pending()` and
`session(id).scorerView(request)` ([server](server.md#the-host-side)).

The rating form is the player's ([rating](rating.md)): it shows the `scoringRubric` of the submission and gives the ratings and
their score. The rating workflow, such as assignment and double scoring, is the host's. A submission holds the correct
responses of the items, so the host gives it only to authorized raters.

## Quick start

Build the submission that a rater sees, and the action that supplies the score to the engine:

```ts
import { readAsi } from "@assesskit/runtime/asi";
import { createEngine } from "@assesskit/runtime/delivery";
import { buildSingle } from "@assesskit/runtime/values";
import { buildSubmission, buildSupplyScores } from "@assesskit/player/scoring";

const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="essay"
    title="Essay" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="human"
      normal-minimum="0" normal-maximum="10"/>
  <qti-item-body>
    <p>Write about your town.</p>
    <qti-extended-text-interaction response-identifier="RESPONSE"/>
    <qti-rubric-block view="scorer" use="scoring"><qti-content-body><p>Give 0 to 10 points.</p></qti-content-body></qti-rubric-block>
  </qti-item-body>
</qti-assessment-item>`);
if (document.kind !== "item") throw new Error("Expected an item.");

const engine = createEngine({ kind: "item", item: document.item, base: "essay.xml" });
const started = engine.start({ seed: 1, at: 0 });
if (!started.ok) throw new Error(started.refusal.message);
const item = { ref: "essay", instance: 1 };
const written = engine.apply(started.state, {
  type: "set-responses",
  item,
  responses: new Map([["RESPONSE", buildSingle("string", "Dear Sir")]]),
  at: 1_000,
});
if (!written.ok) throw new Error(written.refusal.message);
const submitted = engine.apply(written.state, { type: "submit", item, at: 2_000 });
if (!submitted.ok) throw new Error(submitted.refusal.message);

// The host sends the submission to the rater as JSON.
const [request] = engine.pending(submitted.state).scoring;
if (request === undefined) throw new Error("No request waits.");
const submission = buildSubmission(engine.scorerView(submitted.state, request.id));
submission.request; // => "item:essay:1:SCORE"
submission.declaration; // => { cardinality: "single", baseType: "float", normalMinimum: 0, normalMaximum: 10 }
submission.parts[0]?.value; // => { cardinality: "single", baseType: "string", value: { base: { string: "Dear Sir" } } }

// The rater scores it; the host gives the score to the engine.
const action = buildSupplyScores(request, 7.5, "human");
action; // => { type: "supply-scores", request: "item:essay:1:SCORE", value: { cardinality: "single", baseType: "float", value: 7.5 }, scorer: "human" }
const scored = engine.apply(submitted.state, { ...action, at: 3_000 });
if (!scored.ok) throw new Error(scored.refusal.message);
scored.events.map(({ type }) => type); // => ["scores-applied", "outcome-processed"]
engine.pending(scored.state).scoring.length; // => 0

// The rater changes the score: the second supply replaces the first.
const again = engine.apply(scored.state, { ...buildSupplyScores(request, 8, "human"), at: 4_000 });
if (!again.ok) throw new Error(again.refusal.message);
again.events.map(({ type }) => type); // => ["scores-replaced", "outcome-processed"]
```

## The submission

`buildSubmission(view)` takes what `Engine.scorerView(state, request.id)` returns. One submission is one scoring request, so it
rates one outcome. It is JSON text as it is: `JSON.parse(JSON.stringify(submission))` equals it.

| Property                | Type                               | Meaning                                                                                                                                                                 |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request`               | `string`                           | The identifier of the request, `item:<ref>:<instance>:<outcome>` or `test:<outcome>`, which `buildSupplyScores` answers                                                 |
| `outcome`               | `string`                           | The identifier of the outcome                                                                                                                                           |
| `mode`                  | `"human"` or `"externalMachine"`   | Who is to score it                                                                                                                                                      |
| `variableIdentifierRef` | `string`                           | The `variable-identifier-ref` of the declaration; absent when it has none                                                                                               |
| `lti`                   | `true`                             | The item is a link to a tool; absent otherwise                                                                                                                          |
| `declaration`           | The runtime's `ScoringDeclaration` | Cardinality, base type, normal minimum and maximum, mastery value, interpretation and long interpretation                                                               |
| `requestedAt`           | `number`                           | When the request was made, in epoch milliseconds                                                                                                                        |
| `supplied`              | `{ value, at, scorer }`            | The score supplied before; absent while the request is pending                                                                                                          |
| `rubric`                | `BodyNode[]`                       | The rubric of the scorer view: that of the test, and for an item outcome that of its part and sections                                                                  |
| `scoringRubric`         | The runtime's `ScoringRubric`      | The criteria, levels and weights of the outcome, which a rating form shows ([conventions](../runtime/conventions.md#scoring-rubrics)); absent when the outcome has none |
| `parts`                 | `SubmissionPart[]`                 | The responses the outcome rates, in the order of the covers                                                                                                             |
| `items`                 | `SubmissionItem[]`                 | The item instances the outcome covers, each once, in the order of the covers                                                                                            |

| `SubmissionPart`     | Type                | Meaning                                                                                  |
| -------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `item`               | `{ ref, instance }` | The item instance; it names one of `items`                                               |
| `responseIdentifier` | `string`            | The response variable                                                                    |
| `label`              | `string`            | The label of the cover in the test; absent when it has none                              |
| `presented`          | `boolean`           | Whether the candidate was presented the item; if not, `value` is `null`                  |
| `interaction`        | `string`            | The kind of the interaction that binds the response, such as `extended-text-interaction` |
| `value`              | `SubmissionValue`   | The last submitted response, exact                                                       |

| `SubmissionItem`   | Type                   | Meaning                                                                                                           |
| ------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `key`              | `{ ref, instance }`    | The item instance                                                                                                 |
| `title`            | `string`               | The title of the item                                                                                             |
| `presented`        | `boolean`              | Whether the candidate was presented the item; if not, the body and the lists are empty                            |
| `body`             | `BodyNode[]`           | The body as the candidate saw it after template processing, then the item's rubric blocks that only a scorer sees |
| `templateValues`   | `SubmissionVariable[]` | The template variables of the instance                                                                            |
| `correctResponses` | `SubmissionVariable[]` | The correct response of each response variable of the item                                                        |

- A value is the runtime's `WireValue`: `{ cardinality, baseType, value }` whose `value` is the JSON of the QTI 3.0 Best Practices guide, Appendix C. It decodes
  with `readWireValue` of `@assesskit/runtime/values` without a declaration. NULL is `null`.
- A file stays a reference, `{ reference, mime, name }`. The host resolves it to a URL with its own files service.
- A variable is `{ identifier, value }` in a list, so that an identifier such as `__proto__` stays data.
- The content is the runtime's typed nodes, as JSON.

`buildSubmission` and `mountSubmission` check a submission: every property of its
form and no other, the type of every field, the content as nodes as a view carries them, the scoring rubric as the runtime's `checkScoringRubric`
does, and that each part names an item the submission has once. It reads no value; `readWireValue` does when the value is
shown.

## The score

`buildSupplyScores(request, score, scorer)` builds the `supply-scores` action for one request and one value.

| Argument  | Type                                                       | Meaning                                                                                                                                   |
| --------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `request` | `Pick<ScoringRequest, "id" \| "outcome" \| "declaration">` | A request of `Engine.pending(state).scoring`, or from a rater's page `{ id: submission.request, outcome, declaration }` of a `Submission` |
| `score`   | `Value`, `number`, `string`, `boolean`, `null`             | A value of the runtime, or a plain value for a single outcome, which becomes a single value of the outcome's base type; `null` for NULL   |
| `scorer`  | `"human"` or `"externalMachine"`                           | Who scored it                                                                                                                             |

The value is checked against the declaration of the request, as the engine does (`score-type-mismatch`): the cardinality
and the base type must be the outcome's. An integer fits a float or duration outcome and is promoted. NULL fits, and so does
the empty string, which is NULL. A plain value for an outcome that is not single is a `DataError`. The result is the action
without `at`: the host stamps it.


The engine accepts the action while the request exists, also after the test ended or while the session is suspended. It
keeps the request after its value is supplied, so a second action for it replaces the value and reports `scores-replaced`;
that is how a score is corrected or scored again. An action for a request the state lacks is refused with `unknown-request`.
Until a request is supplied the results report is provisional: the item result has the status `pendingExternalScoring`.

## The score of a session

`buildSessionScore(result, pending)` reads the score of a session as plain data, for a gradebook or any other place that wants it. A host
calls it from a job and not from a step: it reads `results()` and `pending()` from `session(id)` at the time it needs the score,
and gives both to the function. The function is pure: the same report and pending work give the same score.

```mermaid
flowchart LR
  J[A job of the host] --> R["session(id).results()"]
  J --> P["session(id).pending()"]
  R --> S[buildSessionScore]
  P --> S
  S --> O["SessionScore: progress, timestamp,<br/>score, maximum, rawScore"]
  O --> G[Any sink: a gradebook, a report]
```

| Field       | Meaning                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress`  | `complete` when no request is open, `awaiting-service` while only scoring services must score, `awaiting-person` while a person must            |
| `timestamp` | The time of the report's last change, in ISO 8601 UTC with milliseconds. Two steps may share it, because the clock of a session never goes back |
| `score`     | The outcome `SCORE`, raised to 0 when it is negative. Absent while `progress` is `awaiting-person` and when the report has no `SCORE`           |
| `maximum`   | The outcome `MAXSCORE`, above 0. Absent when the report has none                                                                                |
| `rawScore`  | The value of a negative `SCORE`. Absent otherwise                                                                                               |

The score comes from the test result, or from the one item result when a session delivered an item alone. `result` must be the
report that `SessionHost.results` returned: a copy of it, and the report of a practice session, is not branded.

## The display

`mountSubmission(host, submission, options)` shows a submission read-only to a rater and returns `{ update, destroy }`. It
attaches an open shadow root to `host`, which must have none. In it:

| Part                           | Markup                                                                                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The display                    | `article.ak-submission`, labelled by its `h2`, with `lang` set to the language of the interface                                                                                                                                           |
| The facts of the request       | `dl.ak-submission-facts`: the outcome, who scores it, its type, range, mastery value, meaning, variable reference, when it was requested and the earlier score                                                                            |
| The notice of a link to a tool | `p.ak-submission-note`                                                                                                                                                                                                                    |
| The rubric                     | `section` with an `h3`, and a content root in `div.ak-submission-content`                                                                                                                                                                 |
| An item                        | `section` with an `h3` of its title: the notice that the candidate was not shown it, its body in a content root, its scorer rubric in a second content root, `ol.ak-submission-parts`, then the correct responses and the template values |
| A response the outcome rates   | `li.ak-submission-part` with an `h4` of its label (else its response variable) and `dl.ak-submission-facts`                                                                                                                               |

A body is drawn by a content root of the player ([content](content.md)), so it is sanitized as a candidate's is. Rubric blocks
that the candidate saw are drawn for the `candidate` view and those that only the scorer sees for the `scorer` view. Interactions
are placeholders; the response of the candidate is shown in its part whatever
the interaction is.

A value shows by its cardinality: a single value as text in its lexical form (a point as `10 20`, a duration in seconds), a container as a list (`ol` for `ordered`), a record as names and
values, NULL as a message. A string keeps its line breaks and takes the direction of its text (`dir="auto"`). A file shows by
its media type: an image as `img`, audio and video with controls, anything else as a link that opens in a tab of its own with
`rel="noopener noreferrer"`. A file is never framed, because the candidate chose its bytes and its type. The URL comes from
`files.url`, which must give an `http` or `https` URL.

| Option       | Type                                | Meaning                                                                                                                                                                                                                 |
| ------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets`     | `(path: string) => string`          | Turns the path of a file in the package into the URL to load it from. Required                                                                                                                                          |
| `stylesheet` | `CSSStyleSheet`                     | The player's stylesheet, built from `player.css` ([styling](styling.md)). Required                                                                                                                                      |
| `language`   | `string`                            | The language of the interface, a BCP 47 tag. Default: `"en"`                                                                                                                                                            |
| `catalogs`   | `Record<string, Partial<Messages>>` | The catalogs of the languages the host shows, by language tag ([messages](messages.md)). Default: none, English                                                                                                         |
| `files`      | `{ url(file: FileValue): string }`  | The URL that plays or opens a file value that a candidate submitted. Default: none, so that a file shows as its name                                                                                                    |
| `origins`    | `readonly string[]`                 | The origins besides the package's that content may reference. Default: none                                                                                                                                             |
| `mathjax`    | `string`                            | The URL of MathJax 4's `mml-chtml.js` ([math](math.md)). Default: none, so that the browser renders MathML                                                                                                              |
| `itemPath`   | `(item: ItemKey) => string`         | The path in the package of the document of an item instance, such as `items/q1/item.xml`, against which the relative references of its content resolve. The scorer view does not carry it. Default: `""` for every item |

`stylesheet`, `language`, `catalogs`, `origins`, `mathjax` and `files.url` are the options of the same names of `mountDelivery` ([delivery](delivery.md)),
so a host passes the same values to both.

| Member               | Meaning                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `update(submission)` | Shows another submission in place of the one on show, for a rater who moves to the next. When it throws, the display is as it was |
| `destroy()`          | Takes the display and its content roots down; the shadow root stays, empty                                                        |

`mountSubmission` and `update` throw `DataError` when an option or the submission is not valid, and `mountSubmission` when
the host has a shadow root. A host stays without a shadow root when the submission is wrong. A value that is not a wire
value throws the runtime's `DataError`. A MathJax that cannot load leaves the expressions as MathML and is not an error of the
display.

The themes and the PNP presentation of [styling](styling.md) apply when the host sets their attributes and properties on
`host`; the content roots in the display take the colors from it.

Raters have their own tools. The display adds no controls: the [rating form](rating.md) belongs beside it, in the host's page.

## Errors

| Call                                 | Throws `DataError` when                                                                                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildSubmission(view)`              | `view` is not a scorer view, a part of it has the wrong type, or what it holds is not a submission                                                                                                                                             |
| `buildSupplyScores(request, ...)`    | `request` is not a scoring request, `scorer` is not `human` or `externalMachine`, or the score does not fit the declaration, such as a single string for a single float outcome: `The outcome SCORE is a single float, found a single string.` |
| `buildSessionScore(result, pending)` | `result` is not the report of a session host, has no test result and not exactly one item result, `SCORE` or `MAXSCORE` is not a finite number, or `MAXSCORE` is not above 0                                                                   |
| `mountSubmission`, `update`          | an option or the submission is not valid, or the host has a shadow root                                                                                                                                                                        |

## Not included

| Not included                                 | Why                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A rating form, assignment and double scoring | They are the workflow of the host, which differs for each                                   |
| A machine scorer                             | A scoring service reads the submission and answers with a score through `buildSupplyScores` |

## Differences from the references

None. QTI defines no submission for a rater: the submission and the action that supplies the score follow the covers and the scoring rubrics of the runtime ([conventions](../runtime/conventions.md)), and a value is the JSON of Appendix C of the best practices guide.
