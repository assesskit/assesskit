# delivery

`@assesskit/runtime/delivery` is the headless delivery engine. `createEngine` builds the engine of a test, or of an item
delivered alone for practice, after a static gate over everything a session can reach; the engine is a pure reducer of
candidate sessions: actions in, a new state and events or a refusal out, with navigation and submission, outcome
processing, time limits and deadlines, suspension, supports, variants and serializable states. Below it, the module plans a
test session: which sections and items a candidate meets, in which order, under which rules. It resolves the section
references of a test, selects and orders the children of every section from a seeded generator, numbers the item
instances, decides what follows an item in a linear test part under pre-conditions and branch rules, inherits item session
control, and computes time limits with a candidate's extra time. It runs the session of each item instance: attempts,
adaptive items, end attempt interactions, drafts and submitted responses, review and solution, comments, the states of
portable custom interactions, and processing failures as data. It builds the view of a candidate session, which holds no
answer key, processing or hidden content, and writes and reads the JSON forms of views and actions. The engine also holds
what it waits on the host for: scoring requests for externally scored outcomes with the scorer view, the sessions of
adaptive sections with a CAT engine and `drainCat`, links to tools scored by their tool, and the results report of a
session. It imports `values`, `asi`, `results`, `pnp`, `interactions`, `content`, `processing`, `cat`, `package` and
`validate` and runs in any JavaScript runtime. It reads no clock:
every step takes the time it happened.

| Export                                                        | Purpose                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `createEngine(definition, options?)`                          | The `Engine`: `start`, `apply`, `deadlines`, `view`, `pending`, `scorerView`, `results`.       |
| `stamp(state, action, now)`                                   | The action with `at` = max(`now`, the time of the latest step).                                |
| `viewToJson(view)`, `viewFromJson(json)`                      | The JSON form of a `CandidateView`, and the view of a JSON form.                               |
| `actionToJson(action)`, `parseCandidateAction(json, limits?)` | The JSON form of a candidate action, and the action of a JSON form, within limits.             |
| `CandidateView`, `CandidateItem`, `NavigationEntry`, …        | What the candidate sees: the item, the navigation map, timers, actions and supports.           |
| `DEFAULT_ACTION_LIMITS`, `ActionLimits`                       | The limits of `parseCandidateAction`.                                                          |
| `serializeState(state)`, `deserializeState(text)`             | The JSON text of a state, and the state of a text, with the version of the format.             |
| `DeliveryState`, `Step`, `Deadline`                           | A candidate session as plain data, the result of a step, a time limit as an absolute time.     |
| `CandidateAction`, `HostAction`, `Action`                     | The actions of the candidate and the host, with their time.                                    |
| `DeliveryDefinition`, `EngineOptions`, `StartOptions`         | What the engine delivers, its options, and the options of a session.                           |
| `drainCat(engine, state, port, now)`                          | Makes the waiting requests of CAT engines through a `CatPort` and applies each answer.         |
| `PendingWork`, `ScoringRequest`, `CatRequest`                 | What the engine waits on the host for: scores and answers of CAT engines.                      |
| `ScorerView`, `ScorerItem`                                    | What a scorer needs to rate a request, correct responses included.                             |
| `CatSession`, `CatSectionRef`                                 | The session of an adaptive section in a state, and where its CAT engine is.                    |
| `resolveStructure(test, base, resolvers)`                     | The `TestStructure`: parts, sections and item references, section references replaced.         |
| `planTest(structure, options)`                                | A `TestPlan`: the sections and item instances of one session.                                  |
| `planItems(plan, part?)`                                      | The item instances of a plan, or of one test part, in order of presentation.                   |
| `nextItem(structure, plan, from, rules)`                      | The item to present after `from`, or the first item; pre-conditions and branch rules apply.    |
| `previousItem(structure, plan, from)`                         | The item before `from`, in a nonlinear part.                                                   |
| `sessionControl(item)`                                        | The item session control of an item reference after inheritance.                               |
| `timeLimits(node, extra?)`                                    | The time limits of the test, a part, a section or an item reference, with extra time.          |
| `additionalTestingTime(profile)`                              | The extra testing time of a PNP.                                                               |
| `ancestry(node)`, `partOf(node)`                              | The nodes that enclose a node, outermost first; the test part of a section or item reference.  |
| `ItemKey`                                                     | An item instance: the identifier of the item reference and the instance, from 1.               |
| `TestPlan`, `PlannedPart`, `PlannedSection`, …                | The plan: plain data, identifiers and numbers only.                                            |
| `TestNode`, `PartNode`, `SectionNode`, …                      | The nodes of the structure, with their models and the path of the document that holds them.    |
| `RuleContext`                                                 | What pre-conditions and branch rules read.                                                     |
| `EffectiveSessionControl`, `EffectiveTimeLimits`              | The results of `sessionControl` and `timeLimits`.                                              |
| `DEFAULT_PLAN_LIMITS`, `PlanLimits`, `PlanOptions`            | The limit on the size of a plan, and the options of `planTest`.                                |
| `startItemSession(key, at, context, options?)`                | A new item session in the state `initial`, after template processing.                          |
| `presentItem(session, at, context)`                           | Presents the item: the first time it starts the first attempt; a suspended session resumes.    |
| `suspendItem(session, at)`                                    | Suspends an interacting session, as when the candidate moves to another item.                  |
| `closeItem(session, at, context)`                             | Closes the session, ending an open attempt with its drafts.                                    |
| `applyItemAction(session, action, context)`                   | Applies an action of the candidate: responses, submit, skip, end attempt, review and more.     |
| `itemFeedback(session, item, control)`                        | The outcomes that decide the feedback shown in the state of the session.                       |
| `itemResponses(session)`                                      | The responses the item shows: drafts, submitted responses, or the solution.                    |
| `resultStatus(session, item)`                                 | The session status of Results Reporting.                                                       |
| `standaloneSessionControl(control?)`                          | The item session control of an item delivered alone.                                           |
| `ItemSession`, `ItemSessionStatus`                            | The state of an item session: plain data with its variables, drafts and attempts.              |
| `ItemSessionContext`, `ItemAction`, `ItemStep`                | What a step reads besides the session, the actions of the candidate, and the result of a step. |
| `Refusal`, `RefusalCode`, `DeliveryEvent`, …                  | Why a step is refused, and what an accepted step reports.                                      |

## Engine

```ts
import { readAsi } from "@assesskit/runtime/asi";
import { createEngine, deserializeState, serializeState, stamp } from "@assesskit/runtime/delivery";
import { single } from "@assesskit/runtime/values";

const item = (identifier: string) => {
  const document =
    readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="${identifier}"
    title="${identifier}" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-simple-choice identifier="A">A</qti-simple-choice>
      <qti-simple-choice identifier="B">B</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>
</qti-assessment-item>`);
  if (document.kind !== "item") throw new Error("Expected an item.");
  return document.item;
};

const test =
  readAsi(`<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="quiz" title="Quiz">
  <qti-outcome-declaration identifier="TOTAL" cardinality="single" base-type="float"/>
  <qti-time-limits max-time="600"/>
  <qti-test-part identifier="part" navigation-mode="linear" submission-mode="individual">
    <qti-assessment-section identifier="main" title="Main" visible="true">
      <qti-assessment-item-ref identifier="q1" href="q1.xml"/>
      <qti-assessment-item-ref identifier="q2" href="q2.xml"/>
    </qti-assessment-section>
  </qti-test-part>
  <qti-outcome-processing>
    <qti-set-outcome-value identifier="TOTAL"><qti-sum><qti-test-variables variable-identifier="SCORE"/></qti-sum></qti-set-outcome-value>
  </qti-outcome-processing>
</qti-assessment-test>`);
if (test.kind !== "test") throw new Error("Expected a test.");

const items = new Map([
  ["q1.xml", item("q1")],
  ["q2.xml", item("q2")],
]);
const engine = createEngine({
  kind: "test",
  test: test.test,
  base: "quiz.xml",
  resolvers: {
    items: (href) => {
      const found = items.get(href);
      if (found === undefined) throw new Error(`No item ${href}.`);
      return { resource: href, deliverable: { kind: "qti", item: found }, hazards: [], variants: [] };
    },
    sections: () => {
      throw new Error("The test has no section references.");
    },
    stimuli: () => {
      throw new Error("The items have no stimuli.");
    },
  },
});

const started = engine.start({ seed: 42, at: 1_000 });
if (!started.ok) throw new Error(started.refusal.message);
started.events; // [{ type: "section-entered", at: 1000, scope: "main" }, { type: "presented", at: 1000, item: { ref: "q1", instance: 1 } }]
engine.deadlines(started.state); // [{ scope: "test", identifier: "quiz", kind: "max-time", at: 601000, lateSubmission: false }]

const q1 = { ref: "q1", instance: 1 };
const answer = {
  type: "set-responses" as const,
  item: q1,
  responses: new Map([["RESPONSE", single("identifier", "B")]]),
};
const answered = engine.apply(started.state, stamp(started.state, answer, 5_000));
if (!answered.ok) throw new Error(answered.refusal.message);
const moved = engine.apply(answered.state, { type: "move", to: "next", at: 9_000 });
if (!moved.ok) throw new Error(moved.refusal.message);
// Events: attempt-ended, response-processed, outcome-processed, moved, presented.
moved.state.outcomes.get("TOTAL"); // { cardinality: "single", baseType: "float", value: 1 }
moved.state.current; // { ref: "q2", instance: 1 }
engine.apply(moved.state, { type: "move", to: "previous", at: 10_000 });
// { ok: false, refusal: { code: "linear-backward", message: "The test part is linear, so the candidate moves forward only.", source: "INFO §2.8.2" } }

const restored = deserializeState(serializeState(moved.state));
const timedOut = engine.apply(restored, { type: "time", at: 601_000 });
// Events at 601000: time-out, attempt-ended, response-processed, outcome-processed, part-ended, test-ended; status "ended".
```

The engine is a pure reducer (E1). `start` gives the first state, `apply(state, action)` the next state and its events or
a refusal, and `deadlines(state)` the times at which the host sends `{ type: "time", at }`. A step never changes the state
it is given, and a refusal gives no state. `apply` never throws on a state of its engine: a processing failure is an event
(E26).

### Definition and options

| `DeliveryDefinition` | Fields                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `kind: "test"`       | `test`, `base`, `resolvers` (such as `packageResolvers(pkg)`), `catSections` (default: none)            |
| `kind: "item"`       | `item`, `base` (the path of the item document), `control` (a `qti-item-session-control`; default: none) |

| `EngineOptions`   | Default                                            | Meaning                                                                     |
| ----------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `customOperators` | none                                               | The custom operators, by `definition`, else `class` (INFO §2.11.3.2).       |
| `resolveTemplate` | none                                               | The response processing of a template URI other than the six standard ones. |
| `limits`          | `maxContainerSize`: 10,000; `maxPlanNodes`: 10,000 | The limits of processing and of the plan of a session.                      |

`createEngine` runs the static gate first (E26): `validateTest`, or `validateAsi` for an item, with the custom operators
and the template resolver given, so that a custom operator that none serves is an error. Any issue of severity `error` is a
`DataError` whose message lists the issues with their codes and paths; warnings pass. It then resolves the section
references and every item reference with its variants, once. An item reference that names a link to a tool is an item
without response variables and with the outcomes `SCORE` and `MAXSCORE`, single floats scored by the tool
(`external-scored="externalMachine"`, E25, G42).

### Resolvers

`resolvers` are three synchronous functions. Each takes the `href` as the document writes it and the path of the document
that holds it.

| Resolver               | Returns                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `items(href, base)`    | A `ResolvedItem`: the resource, the deliverable (a QTI item or an LTI link), its DRD hazards and its variants. |
| `sections(href, base)` | The `AssessmentSection` that a `qti-assessment-section-ref` names.                                             |
| `stimuli(href, base)`  | The `AssessmentStimulus` that a `qti-assessment-stimulus-ref` names.                                           |

`packageResolvers(pkg)` builds them from a `QtiPackage`. A resolver reports a reference it cannot resolve by throwing, and
the error leaves `createEngine`. A resolver returns its value and never a promise: `createEngine` throws a `DataError` that
names the resolver, and `validateTest` and `resolveStructure` do the same. `createEngine` calls each resolver while
it builds the engine and the engine never calls one again, so a host whose documents are in a store loads those the test can
reach, a pool of an adaptive section included, before it calls `createEngine`, and returns them from memory. One engine
serves every session of a test, and a session does no I/O.

### Start

| `StartOptions`      | Default                      | Meaning                                                                                                    |
| ------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `seed`              | —                            | The seed of the generator of the session: selection, ordering, template values, shuffles.                  |
| `at`                | —                            | The time of the start, in epoch milliseconds.                                                              |
| `pnp`               | none                         | The candidate's profile: supports, extra time, hazards avoided, item translation.                          |
| `universalSupports` | none                         | Supports the program gives every candidate; options unless the profile names them.                         |
| `context`           | none                         | Values of context variables, `QTI_CONTEXT` included, for the test and every item that declares them (B50). |
| `resultContext`     | `{ sessionIdentifiers: [] }` | Who took the test, for the results `context`: `sourcedId` and delivery system sessions (E24).              |

`start` plans the session with `planTest` and `createRandom(seed)`, and presents the first item that the walk of
pre-conditions and branch rules gives; a test with nothing to present ends at once. A context value must fit every
declaration of its variable, in the test and in its items, else `start` throws a `DataError`. A time, in `at` and in every
action, is epoch milliseconds from the year 1 to the year 9999, so that a results report can write it as a datestamp.

### Actions

| Action                                                                                            | Effect                                                                        |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `set-responses`, `submit`, `skip`, `end-attempt`, `next-attempt`, `review`, `solution`, `comment` | `applyItemAction` on the item presented; an attempt that ends is a submission |
| `move` `next`                                                                                     | Leaves the item presented for what the walk gives (B26, B28, B29)             |
| `move` `previous`                                                                                 | The item before, in a nonlinear part                                          |
| `move` to an item instance                                                                        | Any item of the part in a nonlinear part; the next item only in a linear part |
| `end-part`                                                                                        | Ends the test part, then goes on after it                                     |
| `end-test`                                                                                        | Ends the test part and the test                                               |
| `suspend`, `resume`                                                                               | Suspends and resumes the candidate session                                    |
| `support`                                                                                         | Turns a support that is an option on or off                                   |
| `time` (host)                                                                                     | Applies the maximum times that passed; nothing else                           |
| `supply-scores` (host)                                                                            | Gives the value of an externally scored outcome, in any state (E15)           |
| `cat-response` (host)                                                                             | Gives the answer of a CAT engine to a request, in any state (E18)             |

Every action carries `at`. Before the action, the maximum times that passed by `at` apply, each at its own time (E7).
`stamp(state, action, now)` sets `at` to max(`now`, `state.at`), so a server whose clock steps back never has an action
refused; an action stamped earlier than the latest step is refused `clock-regression` (E5, G27).

| Refusal                        | When                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `ended`                        | The test has ended.                                                                                         |
| `clock-regression`             | `at` is before the latest step.                                                                             |
| `suspended`                    | The session is suspended and the action is not `resume`.                                                    |
| `time-over`                    | The item, or a scope that holds it, closed at its maximum time; or the test ended at it in this step.       |
| `unknown-item`                 | The plan has no such item instance, or no item before the first of a nonlinear part.                        |
| `not-current`                  | An action on an item that is not presented; a move to another part, or past the next item in a linear part. |
| `linear-backward`              | `previous`, or a move to an earlier item, in a linear part.                                                 |
| `wrong-submission-mode`        | `submit`, `skip` or `end-attempt` in a part with simultaneous submission.                                   |
| `min-time-not-reached`         | Leaving an item, section, part or test before its minimum time.                                             |
| `support-not-available`        | `support` for a support that is not an option.                                                              |
| `awaiting-cat`                 | The next item depends on a CAT engine that has not answered, or a first stage is awaited.                   |
| `unknown-request`              | `supply-scores` or `cat-response` names a request the state lacks, or one that waits for no answer.         |
| `score-type-mismatch`          | `supply-scores` gives a value that does not fit the declaration of the outcome.                             |
| `invalid-response`             | Also a `cat-response` that does not fit its request, or whose stage exceeds `maxPlanNodes`.                 |
| the codes of `applyItemAction` | The rules of the item session (see Item sessions).                                                          |

### Navigation and submission

| Part                       | Leaving the item presented                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| linear, individual         | An open attempt is submitted, with the checks of skipping and validity, and the session closes: the candidate cannot come back (INFO §2.8.2, B88). |
| nonlinear, individual      | The session is suspended with its attempt open; the candidate submits each item.                                                                   |
| simultaneous (either mode) | The session is suspended with its attempt open; no item is submitted alone (INFO §2.8.2).                                                          |

- The walk decides after the submission and its outcome processing, so pre-conditions and branch rules read the new
  outcomes.
- When the walk leaves the test part, the part ends: every session of the part closes, so an open attempt ends with its
  drafts (in simultaneous mode this submits the group); outcome processing runs; then the part is completed, so its own
  branch rules read the outcomes of the group, and the walk goes on. `end-part` and `end-test` end the part the same way,
  from any item. A branch rule that leads to another part ends the part first too.
- The items of an adaptive section are submitted one by one, also in a part with simultaneous submission (CAT §2.4, B27).
- An item is reviewed while its part is current; a part that ended is not visited again.

### Outcome processing

Outcome processing runs once after the attempts that ended in a step: after a submission in individual mode, after the
group at the end of a simultaneous part (INFO §2.9, B37). The outcomes start from their defaults each time. What the
test's expressions read:

| Reference                                       | Value                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ITEM.VAR`                                      | The instance whose attempt ended last; before any ended, the last instance of the plan (B38, G9).                 |
| `ITEM.n.VAR`                                    | The instance `n`.                                                                                                 |
| the `qti-number-*`, `qti-test-variables`, …     | Every instance of the plan; one not yet presented is a session in the state `initial` before template processing. |
| `duration`, `PART.duration`, `SECTION.duration` | The time spent in the test, part or section, suspended time excluded (T22, G23).                                  |
| a context variable, `QTI_CONTEXT`               | The value given at the start, else the default (B50).                                                             |

Item variables are read with the weights and variable mappings of the item reference (B39, B40) and as submitted, never
as drafts (B96). The template defaults of an item reference are evaluated in the test when the item is first presented,
and replace the defaults of its template variables before template processing (B41).

The cost of outcome processing is stated in [architecture](architecture.md#outcome-processing).

### Time limits

Time runs in the test, the test part and the sections of the item presented, and in the item while its session is
interacting; never while the session is suspended (G23). A section selected more than once has one clock.
`deadlines(state)` gives the maximum time of each running scope that has not passed and the minimum time not yet reached,
as absolute times with the candidate's extra time (E6, G41).

| Maximum time passes             | Effect (D9)                                                                                                                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| without `allow-late-submission` | `time-out`: the open attempts of the scope end with the drafts received before the deadline, the scope closes, and the candidate goes on as after leaving it: the next item, the part after a part, the end of the test. Later actions in the scope are refused `time-over`. |
| with `allow-late-submission`    | `time-limit-passed`: the scope stays open; each attempt that ends in it reports `late-submission`, until the candidate or the host ends the scope.                                                                                                                           |

A refused action leaves the state as it was, the time-outs it applied included; the next `time` action applies them again.
The minimum time of a scope must be reached before the candidate leaves it by `move`, `end-part` or `end-test`; a time-out
leaves without it.

### Suspension, supports and variants

- `suspend` suspends the item presented and stops every clock; while suspended, every action but `resume` is refused.
  `resume` presents the item again. `resume` on a running session changes nothing.
- Supports (E28): a support the profile names has the state `resolveSupports` gives it, on from the start when `active`
  or `assigned`; a universal support it does not name is an option. Only an option turns on and off. The supports on while
  an item is presented are recorded with the item (`DeliveredItem.supports`).
- Variants (B100): at the first presentation of an instance, the item or one of its variants is chosen and kept for the
  session: candidates with a hazard the profile avoids are dropped; among the rest a variant whose `languageOfAdaptation` is
  the `item-translation` language is preferred, the whole tag first, then the primary subtag, else the item itself, or the
  first variant left when the item was dropped. When every candidate is dropped, the item itself is presented and the step
  reports `hazard-unavoidable`. A choice among variants reports `variant-selected`.

### Events

`Step.events` lists what happened, in order, with times and the item or scope: the item events of item sessions, and
`outcome-processed`, `moved`, `section-entered`, `part-ended`, `test-ended`, `time-limit-passed`, `time-out`,
`late-submission`, `suspended`, `resumed`, `support-changed`, `variant-selected`, `hazard-unavoidable`, `scoring-requested`,
`scores-applied`, `scores-replaced`, `cat-requested` and `cat-stage-added` (E23). The TSDoc of `DeliveryEventType` gives
the fields of each.

### State

`DeliveryState` is plain data that holds no item content: the version of the format, the status, the time of the latest
step, the generator state, the plan, the item presented, the item instances presented with their sessions, variants,
supports and expiries, the test outcomes, the context values, the clocks of the test, parts and sections, the supports,
what the engine takes from the profile, the scoring requests with their supplied values, the sessions of adaptive sections,
and the context of the results. `serializeState` writes it as JSON with values as `WireValue`s and maps as arrays
of entries; `deserializeState` reads it back equal and refuses another version of the format (E2). Replaying the actions
from the seed reproduces a state and its events exactly (E3).

### Item delivered alone

`createEngine({ kind: "item", item, base, control })` delivers an item as a test of one nonlinear test part with individual
submission (E12): the test is named as the item, the part `<identifier>-part`, its section `<identifier>-section`, and the
item reference has the identifier of the item. Its control is `standaloneSessionControl(control)`. The definition may give
`resolvers` with `stimuli`, to present the stimuli the item names.

## Modes

The same engine serves an exam on a server and practice on a device. Only the placement of the answer keys differs.

| Mode   | Where the engine runs | What the client holds                         | Use                                        |
| ------ | --------------------- | --------------------------------------------- | ------------------------------------------ |
| Server | On the server         | Views, and the actions it sends               | Exams: the keys and the seed never leave.  |
| Device | In the client         | The engine, the items, the keys and the state | Practice: nothing needs to be kept secret. |

**Server mode.** The server owns the engine, the states and the clock. A request is handled in four steps, and the answer is
the view:

1. `parseCandidateAction(json, limits?)` reads the JSON of the client into an action, and throws a `DataError` for one that is
   malformed, too large or an action of the host.
2. `stamp(state, action, now)` sets the time of the action to the clock of the server.
3. `engine.apply(state, action)` gives the next state, or a refusal, which the server reports to the client.
4. `viewToJson(engine.view(state, now))` is what the client receives.

The server keeps the state between requests with `serializeState`, fires `{ type: "time", at }` at the `deadlines` of the
state, and supplies the other actions of the host, `supply-scores` and `cat-response`. A client holds only views, which
`viewFromJson` reads, and sends actions, which `actionToJson` writes; neither imports engine code, so a bundle of them holds
no answer key. The seed of a session stays on the server too: selection and shuffles are reproducible from it
([SECURITY](https://github.com/assesskit/assesskit/blob/main/SECURITY.md)).

**Device mode.** The engine and `engine.view` run in the client, with actions passed to `apply` directly and nothing
converted. The client holds the items with their correct responses, processing and the seed, so the mode is for practice,
and a candidate who wants the answers can read them. The core uses no platform API, so the engine runs in a browser.

**Client actions.** The engine applies every action that its rules allow, whoever sends it. Among the actions of a candidate
are `suspend` and `resume`, and suspended time counts nowhere (G23), so a client that may send them can stop its own clock.
The policy about which candidate actions a client may send belongs to the player, not to the runtime. The player's exam default allows
every candidate action except `suspend` and `resume`, and breaks go through the proctor, on the host's authority. A host that
uses the runtime without the player filters the actions of its clients before it applies them.

## Time

The runtime reads no clock. Every time is epoch milliseconds, between the year 1 and the year 9999, that the caller supplies:

| Where                                        | The time is                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `start({ at })` and the `at` of every action | When the step happened. An action before the latest step is refused `clock-regression` (E5, G27).                             |
| `stamp(state, action, now)`                  | Sets `at` to the greater of `now` and the time of the latest step, so a server's clock stepping back never refuses an action. |
| `engine.view(state, now)`                    | The moment of the view. The maximum times that passed by `now` apply to the view; the state is not changed (E7).              |
| `engine.deadlines(state)`                    | Absolute times at which the host sends `{ type: "time", at }`, with the candidate's extra time (E6, G41).                     |
| `drainCat(engine, state, port, now)`         | A function that gives the time of each answer of a CAT engine.                                                                |

Time runs in the test, the test part, the sections and the item presented, and stops while the session is suspended (G23).
Every duration and datestamp of a results report derives from these times, so replaying the actions from the seed gives the
same states and events (E3). The extra time of a candidate comes from the PNP given to `start`; the engine has no action that
extends a limit during a session. [Time limits](#time-limits) describes what happens when a maximum time passes, and
[Time limits of the plan](#time-limits-of-the-plan) the arithmetic of the limits.

## Candidate view

`engine.view(state, now)` gives what the candidate sees of a state (E19). It first applies the maximum times that passed up
to `now`, each at its time, as a `time` action would (E7); a time before the latest step counts as that step. It then builds
the view field by field from the item session and the item, so that nothing else can reach it (E20). The state is not
changed.

```ts
// Continues the example above.
const view = engine.view(started.state, 2_000);
view.status; // "in-progress"
view.part; // { identifier: "part", navigationMode: "linear", submissionMode: "individual" }
view.navigation; // [{ kind: "section", identifier: "main", title: "Main", depth: 0 },
//                    { kind: "item", key: { ref: "q1", instance: 1 }, title: "q1", depth: 1, status: "interacting", current: true, reachable: false }]
view.current?.interactions[0]?.choices.map((choice) => choice.identifier); // ["A", "B"], in the order of presentation
view.timers; // [{ scope: "test", identifier: "quiz", remaining: 599000, late: false }]
view.actions; // ["set-responses", "submit", "skip", "move", "end-part", "end-test", "suspend"]
engine.view(answered.state, 700_000).status; // "ended": the maximum time of the test passed
```

| Field of `CandidateView` | Holds                                                                                                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                 | `in-progress`, `suspended` or `ended`. A suspended session shows no content and the action `resume` only; an ended one shows the test feedback `atEnd`.                                                                                                                |
| `test`, `part`           | The identifier and title of the test; the identifier, navigation mode and submission mode of the test part presented.                                                                                                                                                  |
| `navigation`             | The visible sections and the item instances of the test part, in order, with the state of each item session, whether it is current and whether a `move` reaches it. A nonlinear part lists every instance; a linear part lists those presented so far, none reachable. |
| `current`                | The `CandidateItem`.                                                                                                                                                                                                                                                   |
| `rubric`                 | The content of the rubric blocks for the candidate: of the test, then of the test part, then of the sections from the top down (F-m25).                                                                                                                                |
| `testFeedback`           | The content of the test feedback that is shown: `during` while the session runs, of the test and of the test part; `atEnd` once it ended, of the test and of the test parts entered.                                                                                   |
| `timers`                 | For each running scope with a limit: `remaining` and `minimumRemaining` in milliseconds, and `late` after a maximum time that allows late submission.                                                                                                                  |
| `actions`                | The types of the actions the state allows. The data of an action can still make it refused, such as a `submit` without a response under `allow-skipping="false"`.                                                                                                      |
| `supports`               | Each support with its state, whether it is on and the settings of the profile; the settings of a prohibited support stay out.                                                                                                                                          |

| Field of `CandidateItem`                             | Holds                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`, `title`, `label`, `language`, `timeDependent` | The item instance and the attributes of the item, of the variant when one was presented; the title of a link to a tool is the title of the link.                                                                                                                          |
| `status`, `numAttempts`, `attemptsLeft`              | The state of the item session, the attempts started, and the attempts left including the open one; none when the item allows any number.                                                                                                                                  |
| `body`, `stimuli`, `modalFeedback`                   | Content after resolution (below).                                                                                                                                                                                                                                         |
| `stylesheets`, `catalogs`, `companionMaterials`      | The package paths of the stylesheets of the item and its stimuli, the catalogs of the visible content, and the materials of the item.                                                                                                                                     |
| `interactions`, `responses`                          | The `InteractionDescriptor` of each interaction in the content, with its choices in the order of presentation; and its response by identifier: the drafts while the session is open, the submitted responses once it closed, the correct responses in the solution state. |
| `pci`                                                | For each portable custom interaction: the template and context values it names with `qti-template-variable` and `qti-context-variable`, and its stored state (E29).                                                                                                       |
| `variant`, `hazards`, `lti`                          | The variant presented with its language (B100); the hazards in the terms of the PNP with whether the candidate avoids each (B99); the link to a tool (E25).                                                                                                               |

Resolution of content follows `content.resolveContent` for the view `candidate`: printed variables become text; feedback,
template content and choices that the variables hide are removed; rubric blocks without the view `candidate` are removed.
Then every list of choices in an interaction takes the order that the session drew, so that the content and the
descriptors agree. References in the content are as the item writes them, against the document of the item; only
`stylesheets` are package paths.

While the first stage of an adaptive section is awaited (E18), no item is presented: the view has the part, the navigation
map of its presented items and the actions `end-part`, `end-test` and `suspend` (and `support` when a support is an option),
and no `current`.

The view never holds (E20, E21):

- response, template or outcome processing, mappings, area mappings and lookup tables;
- correct responses, except in the solution state, which the item session control allows only after the item closed;
- outcome declarations or values: the candidate sees outcomes through feedback and printed variables only;
- template declarations or values, except those a portable custom interaction names;
- hidden feedback, template content and choices, and rubric for other views;
- any metadata but the hazards.

The property in `delivery.test.ts` runs random actions on a test whose items have a correct response, a mapping, outcome
and template values, hidden content and rubric for the scorer, each marked, and checks every view as JSON text for the
marks.

### Wire forms

The JSON forms carry values as `WireValue` (E30): `{ cardinality, baseType?, value }` around the JSON of BPIG Appendix C,
with NULL as `null`, durations as `PT<seconds>S`, and files as references. Maps are arrays of `[identifier, value]` entries,
so an identifier such as `__proto__` stays data. They decode without declarations and lose nothing: `multiple` stays apart
from `ordered`, and the NULL of one type from that of another.

| Function                              | Does                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `viewToJson(view)`                    | Builds the JSON form property by property, reads it back with `viewFromJson` and returns it. The content nodes are shared with the view.                     |
| `viewFromJson(json)`                  | Checks every property of the form and no other, the type of each field, the values, and the content as plain JSON of at most 256 levels with finite numbers. |
| `actionToJson(action)`                | Writes the properties of the action's type and no other: the time `at` is not written.                                                                       |
| `parseCandidateAction(json, limits?)` | Reads an action of the candidate, checks its type, its properties and its limits, and refuses an action of the host and any property `at`.                   |

| Limit               | Default   | Bounds                                                                                                     |
| ------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| `maxActionSize`     | `4194304` | The size of the action: each node of the JSON counts 1, and each string and property name adds its length. |
| `maxPciStateLength` | `1048576` | The length of one portable custom interaction state, in code units.                                        |

```ts
import { actionToJson, parseCandidateAction, stamp, viewToJson } from "@assesskit/runtime/delivery";

// The client sends JSON text of its action; the server reads, stamps, applies and answers with the view.
const text = JSON.stringify(actionToJson(answer)); // {"type":"set-responses","item":{"ref":"q1","instance":1},"responses":[["RESPONSE",{"cardinality":"single","baseType":"identifier","value":{"base":{"identifier":"B"}}}]]}
const received = parseCandidateAction(JSON.parse(text), { maxActionSize: 100_000 });
const stamped = stamp(started.state, received, 5_000); // { ...received, at: 5000 }
const step = engine.apply(started.state, stamped);
if (!step.ok) throw new Error(step.refusal.message);
const reply = JSON.stringify(viewToJson(engine.view(step.state, 5_000)));
parseCandidateAction({ type: "time" });
// DataError: The type "time" is an action of the host, and a candidate does not send it; the type of an action of a candidate is "set-responses", "submit", ...
```

Host actions (`time`, `supply-scores`, `cat-response`) never come from a client, and the time of an action is the server's
`stamp`. `viewFromJson` and `actionToJson` import no engine code, so a browser bundle of them holds none of the answer keys.
[Modes](#modes) says how a server and a device use these forms.

## Pending work

`engine.pending(state)` lists what the session waits on the host for: `scoring`, the scoring requests whose value has not
been supplied, and `cat`, the requests that wait for the answer of a CAT engine. Nothing in the session blocks on it, apart
from an adaptive section that cannot present an item until its engine has answered. The host answers with an action of its
own: `supply-scores` for a score, `cat-response` for a CAT engine. Both are accepted in any state, after the test ended too,
as long as their request exists.

### Scoring requests

An outcome with `external-scored` is one that a scorer sets, not processing (INFO §4.5.10, W18). The engine asks for each
one once, and keeps the request in the state after its value is supplied, so that a second supply can replace the first
(E13). `pending(state).scoring` lists the requests with no value yet.

| Outcome of | The request is made when …                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| an item    | the session of the instance is over: its last attempt ended, or the part or a time-out closed it, or the candidate left it in a linear part |
| the test   | every response its covers name has been presented and its session is over (G26); with no covers, when the test ends (O5)                    |

| `ScoringRequest`                           | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                       | `item:<ref>:<instance>:<outcome>` or `test:<outcome>`, which `supply-scores` and `scorerView` name.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `scope`, `item`                            | `item` with the instance, or `test`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `outcome`, `mode`, `variableIdentifierRef` | The outcome, who scores it (`human` or `externalMachine`), and the `variable-identifier-ref` of its declaration.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `declaration`                              | Cardinality, base type, normal minimum and maximum, mastery value, interpretation and long interpretation.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `covers`                                   | The responses the outcome rates (E14, O12): the instance, the response identifier, the label, `presented`, the kind of interaction and the last submitted value, exact. An item outcome covers the responses of its item. A test outcome covers what the `qti-rubric-block` of the runtime convention names (§4.16, `readScoreCovers`), resolved to every instance in the plan; an instance never presented has `presented: false` and a NULL response. The covers come from the blocks only, never from the rules that use the outcome (O4). |
| `lti`                                      | `true` for an item that models a link to a tool (E25).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `requestedAt`, `supplied`                  | When it was made, and the value supplied with its time and scorer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

`supply-scores` gives one value for one request (E15). The value must fit the declaration, an integer for a float; NULL is
a value. It is accepted in any state, also after the test ended and while the session is suspended, as long as the request
exists, and a second one replaces the first (`scores-replaced`). An item outcome is set in the item session without
running response processing again (G25); the outcome processing of the test runs again, and an externally scored outcome
of the test starts every run from its supplied value, since INFO §2.9 would reset it (G24, E16); until then it has its
declared default. A link to a tool is an item whose `SCORE` and `MAXSCORE` are scored by the tool: both are requested when
`submit` or leaving closes the session, and the host supplies the grade and its maximum from the tool (E25, G42).

While a request is pending the report is provisional: the item result has the status `pendingExternalScoring`, and the
responses it covers `scoreStatus="notscored"` (E17).

```ts
import { readAsi } from "@assesskit/runtime/asi";
import { createEngine } from "@assesskit/runtime/delivery";
import { single } from "@assesskit/runtime/values";

const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="essay"
    title="Essay" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="human"/>
  <qti-item-body><qti-extended-text-interaction response-identifier="RESPONSE"/></qti-item-body>
</qti-assessment-item>`);
if (document.kind !== "item") throw new Error("Expected an item.");

const engine = createEngine({ kind: "item", item: document.item, base: "essay.xml" });
const started = engine.start({ seed: 1, at: 0 });
if (!started.ok) throw new Error(started.refusal.message);
const item = { ref: "essay", instance: 1 };
const written = engine.apply(started.state, {
  type: "set-responses",
  item,
  responses: new Map([["RESPONSE", single("string", "Dear Sir")]]),
  at: 1_000,
});
if (!written.ok) throw new Error(written.refusal.message);
const submitted = engine.apply(written.state, { type: "submit", item, at: 2_000 });
if (!submitted.ok) throw new Error(submitted.refusal.message);

const [request] = engine.pending(submitted.state).scoring;
request?.id; // "item:essay:1:SCORE"
request?.covers[0]?.response; // { cardinality: "single", baseType: "string", value: "Dear Sir" }
engine.results(submitted.state).itemResults[0]?.sessionStatus; // "pendingExternalScoring"

const scored = engine.apply(submitted.state, {
  type: "supply-scores",
  request: request?.id ?? "",
  value: single("float", 7.5),
  scorer: "human",
  at: 3_000,
});
if (!scored.ok) throw new Error(scored.refusal.message);
scored.events.map(({ type }) => type); // ["scores-applied", "outcome-processed"]
engine.pending(scored.state).scoring; // []
engine.results(scored.state).itemResults[0]?.sessionStatus; // "final"
```

### Scorer view

`scorerView(state, requestId)` gives what a rater needs (E27, R6): the request; the `rubric` of the test for the `scorer`
view, and for an item outcome that of its part and sections too, without the covers blocks of other outcomes; and for each
covered instance its title, its body as the candidate saw it after template processing, followed by the rubric blocks of the
item that only the scorer sees, its template values, submitted responses and correct responses. An instance not presented
has an empty body and empty maps. The view holds the correct responses, so it belongs on the server.

### Adaptive sections

An adaptive section (`qti-adaptive-selection`) takes its items from a CAT engine in stages (CAT §2). The definition names
the engine of each one in `catSections`: the URL prefix and the identifier that `CatPort.createSection` returned when the
host deployed the section (C1). The host answers the engine's requests; `drainCat` does it through a `CatPort`.

| Moment                                                         | What the engine does                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The candidate reaches the section                              | Makes the Create Session request, with the candidate's PNP as `writePnp` writes it, in base64 (C3), and waits: no item is presented, and the clocks stand still.                                                                                                                                      |
| `cat-response` to Create Session                               | Stores the session identifier and state, adds the items of the first stage to the section, each an instance as in a selection with replacement (C8), and presents the first.                                                                                                                          |
| The first `stageLength` items of the stage are submitted       | Makes the Submit Results request (C4) with the minimal report of CAT §4.3.1 for the items not yet reported (C10), the earlier ones again when a further attempt changed them (B98), and the stored `sessionState`. The candidate is refused `awaiting-cat` where the next item depends on the answer. |
| `cat-response` to Submit Results                               | Merges the outcomes the engine reported, stores `sessionState` (an absent one clears it), drops the items of the old stage that were not presented, and adds the next stage; an answer without items ends the session.                                                                                |
| The candidate leaves the section, or the part or the test ends | Sends the results not yet reported in a last Submit Results, and End Session unless the engine's answer ended the session (C5).                                                                                                                                                                       |

- A candidate who moves on while a request is made waits where the move was asked; when the answer has come, the move goes on.
- Pre-conditions and branch rules on the items of an adaptive section are ignored; a branch rule that targets one finds no
  target, since the pool is not in the plan until the engine sends it (B66). The section itself keeps both.
- The items of an adaptive section are processed one by one, also in a part with simultaneous submission: response and
  outcome processing run before the request (B27, CAT §2.4).
- The outcomes of a report (CAT §4.3.2, B67): a declared outcome with `external-scored="externalMachine"` takes the value,
  by its own identifier or by its `variable-identifier-ref`, and keeps it through later outcome processing; the same name as a
  context, template or response variable, or as an outcome without that attribute, is ignored; any other outcome is kept as
  if declared, with `external-scored="externalMachine"` in the results. An outcome that one engine set is not overwritten by
  the engine of another section. The sessions of the report join the `context` of the results.
- A report to the engine names an item the plan holds more than once `<ref>.<instance>` (CAT §4.3.1), has an empty `context`,
  and gives an item that the candidate submitted without a response no response variables and no `SCORE`, with the status
  `initial`; items not presented are left out.
- `drainCat(engine, state, port, now)` makes the waiting requests one by one and applies each answer with `now()` as its time.
  A request that the port rejects rejects the call and loses the answers so far, because the requests of a CAT engine are not
  idempotent: a host that must resume applies the answers itself, one `cat-response` at a time, from `pending(state).cat`.

A test part that holds an adaptive section should be linear (CAT §2.3); the engine waits for the first stage where the walk
reaches the section, in a nonlinear part too.

## Results

`results(state)` assembles the report of RR (E24): the `context` given at `start`; the result of the test, with its
`duration`, `PART.duration` and `SECTION.duration`, its context variables and outcomes, and the supports used; and an item
result for each instance presented, in order of presentation, with `sequenceIndex` from 1 (INFO §5.98).

| Item result       | Content                                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `datestamp`       | The time of its last event: the end of its last attempt (a submission, a skip, a time-out), else its latest change. `RFC 3339` with the offset `Z` and milliseconds.                                                        |
| `sessionStatus`   | `resultStatus`, with `pendingExternalScoring` until every score of the item is supplied, and while a pending score of the test covers one of its responses (E17).                                                           |
| responses         | `numAttempts` and `duration` (also for an item that is not time dependent), then each declared response with its last submitted value, `choiceSequence` when the choices were shuffled, `scoreStatus` and `answeredStatus`. |
| other variables   | Template and context variables, then `completionStatus` and each declared outcome with its `view`, interpretation, normal and mastery values, `external-scored` and `variable-identifier-ref`.                              |
| comment, supports | The candidate's comment, and the supports on while the item was presented: `assigned` when the profile names them, `universal` when only the program gives them (E28).                                                      |

The result of the test has no datestamp of its own: it is the time of the latest step. An item delivered alone has no result
of the test. A datestamp is always written with an offset because the JSON binding of CAT 1.0 declares it as
`format: date-time` (CAT binding Appendix B1.2), which RFC 3339 defines with one, while an `xs:dateTime` may lack it.

## Planning example

```ts
import { createRandom } from "@assesskit/runtime";
import { readAsi } from "@assesskit/runtime/asi";
import {
  nextItem,
  planItems,
  planTest,
  resolveStructure,
  sessionControl,
  timeLimits,
} from "@assesskit/runtime/delivery";
import { single } from "@assesskit/runtime/values";

const document =
  readAsi(`<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="demo" title="Demo">
  <qti-outcome-declaration identifier="PASSED_WARMUP" cardinality="single" base-type="boolean"/>
  <qti-time-limits max-time="3600"/>
  <qti-test-part identifier="part" navigation-mode="linear" submission-mode="individual">
    <qti-item-session-control show-feedback="true" max-attempts="1"/>
    <qti-assessment-section identifier="warmup" title="Warm-up" visible="true">
      <qti-assessment-item-ref identifier="w1" href="w1.xml"/>
    </qti-assessment-section>
    <qti-assessment-section identifier="main" title="Main" visible="true">
      <qti-pre-condition><qti-variable identifier="PASSED_WARMUP"/></qti-pre-condition>
      <qti-selection select="2"/>
      <qti-ordering shuffle="true"/>
      <qti-assessment-item-ref identifier="q1" href="q1.xml"/>
      <qti-assessment-item-ref identifier="q2" href="q2.xml"/>
      <qti-assessment-item-ref identifier="q3" href="q3.xml">
        <qti-item-session-control max-attempts="3"/>
      </qti-assessment-item-ref>
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`);

if (document.kind === "test") {
  const structure = resolveStructure(document.test, "tests/demo.xml", {
    sections: () => {
      throw new Error("This test has no section references.");
    },
  });
  const plan = planTest(structure, { random: createRandom(7) });
  planItems(plan); // [{ ref: "w1", instance: 1 }, { ref: "q2", instance: 1 }, { ref: "q3", instance: 1 }]

  const rules = (passed: boolean) => ({
    outcomes: new Map([["PASSED_WARMUP", single("boolean", passed)]]),
    scope: { itemSessions: () => [], itemSession: () => undefined, variable: () => undefined },
    context: { random: createRandom(1) },
  });
  const first = nextItem(structure, plan, undefined, rules(true)); // { ref: "w1", instance: 1 }
  nextItem(structure, plan, first, rules(true)); // { ref: "q2", instance: 1 }
  nextItem(structure, plan, first, rules(false)); // undefined: the section "main" is skipped and the test ends

  const q3 = structure.itemRef("q3");
  if (q3) sessionControl(q3); // { maxAttempts: 3, showFeedback: true, allowReview: true, showSolution: false, … }
  timeLimits(structure.test); // { maxTime: 3600, allowLateSubmission: false }
  timeLimits(structure.test, { kind: "time-multiplier", multiplier: 1.5 }); // { maxTime: 5400, allowLateSubmission: false }
}
```

## Structure

`resolveStructure` calls `resolvers.sections(href, base)` once for each `qti-assessment-section-ref` and puts the section it
returns where the reference was (INFO §7.5, BIND §8.2). The references inside that section resolve against the path of its
document, which `resolveReference` of `package` computes from the reference and its base, so that each node records the
`base` of the document that holds it. Item references stay unresolved: a session resolves an item only when it presents it.

- The identifiers of test parts, sections and item references are one set. A repeat is a `DataError`, also when one section
  document is referenced from two places.
- A section reference and the section it names have the same identifier; a different one is a `DataError`.
- An `xi:include` left in a section is a `DataError`; `packageResolvers` resolves includes.
- `structure.part(id)`, `structure.section(id)` and `structure.itemRef(id)` find a node, `undefined` for an identifier the
  test does not have.
- An adaptive section keeps its item references in the structure, as the pool of its CAT engine; the plan gives it no items.

`SectionNode.dissolved` tells whether ordering mixes a section into its parent (see Ordering).

## Plan

`planTest(structure, { random })` returns a `TestPlan`: test parts in document order, each with its sections, and in them the
item instances and sections that selection left, in the order ordering gave. The plan is plain data, so it serializes as it
is, and the same structure rebuilds the same session from it. The test parts, and the sections of a part, keep document
order. Only the children of a section are selected and ordered, by its `qti-selection` and `qti-ordering`.

The draws come from `random` in a fixed order, so equal generator states give equal plans and a stored state replays a
session: depth first in document order, a section draws its selection, then each section it selected draws its own, then it
draws its ordering. A section that selects all its children without shuffling takes no draw. Changing a draw procedure is a
breaking change.

### Selection

| Case                | Procedure (G8)                                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `qti-selection`  | Every child.                                                                                                                                                                                  |
| Without replacement | Every `required` child, and a uniform subset of the others: they are shuffled with the procedure below and the first places are taken (INFO §5.129.1, §4.2.2). A section counts as one child. |
| With replacement    | Every `required` child once, then `select` minus their number independent draws, each `floor(uniform × n)` over all `n` children (INFO §5.129.2). `select` may exceed `n`.                    |

The selected children are in document order, the copies of one child next to each other. A selection that asks for fewer
children than are required, for more than exist without replacement, for a negative number, or for children of a section
that has none, is a `DataError`.

### Ordering

`qti-ordering shuffle="true"` permutes the selected children with the Fisher–Yates procedure of `shuffle` in `random.ts`: for
`i` from the last movable place down to 1, the item at `i` swaps with the item at `floor(uniform × (i + 1))`. Children with
`fixed="true"` keep their places, which are the places in the selected list (INFO §5.98.1, §4.2.3). Without `shuffle` the
order is the selected order.

An invisible section that is not kept together (`visible="false" keep-together="false"`) and is not `fixed` is mixed into
the list of its parent when the parent shuffles: it first selects and orders its own children, then they stand in the
parent's list as if they were its children, and a section nested in it that qualifies goes up with them (INFO §4.2.6–7). Such
a section is not in the plan, and its pre-conditions, branch rules and time limits are not in force, because it has no
place of its own. A visible section, a section kept together (the default), and a `fixed` section stay a block. A parent
that does not shuffle never mixes.

### Instances

Each occurrence of an item reference in the plan is an item instance `{ ref, instance }`, counted from 1 in order of
presentation across the whole test, so that selection with replacement gives one reference several instances and
`ITEM.2.VAR` names the second (INFO §2.11.1.2). A section selected more than once is planned once for each selection, with
draws of its own, and numbered the same way.

### Limits

| Limit          | Default | Unit  | Meaning                                                                                                                            |
| -------------- | ------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `maxPlanNodes` | 10,000  | nodes | The most sections and items a plan may hold. A larger plan is a `SecurityError`, raised before a selection with replacement draws. |

## Navigation

`nextItem(structure, plan, from, rules)` returns the item to present after the candidate leaves `from`, or the first item of
the test when `from` is `undefined`; `undefined` is returned when no item follows. `rules` holds the outcomes of the test, the
`TestScope` of its item sessions and the processing context, as `runOutcomeProcessing` takes them.

| Topic             | Rule                                                                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nonlinear part    | The next item of the plan. Pre-conditions and branch rules of the part and of what it holds are ignored (INFO §2.8.3). A part ends into the first item of the next part.                                                                           |
| Linear part       | Entering a node evaluates its pre-conditions in order; a false or NULL one skips the node with everything in it (INFO §4.2.9). A part with nothing to present is passed over.                                                                      |
| Branch rules      | Completing a node evaluates its branch rules in order; the first true one decides. A NULL expression is false. A skipped node is not completed, so its rules do not run (INFO §2.8.3.2).                                                           |
| Completing        | A node is completed after its last child, and after an exit that names it. A node that was entered but has nothing to present, such as an adaptive section, is completed too.                                                                      |
| Targets           | An item or section in the same part, or a test part, that comes after the node that has the rule. A rule whose target is behind, inside, in another part, or not in the plan is not evaluated. Of the repeats of a target, the first ahead counts. |
| Entering a target | The sections of the target that the walk is not in are entered from the outermost, and a false pre-condition skips that section.                                                                                                                   |
| `EXIT_SECTION`    | Completes the section that holds the node, so its branch rules follow. A node that is a section or a part has nothing to leave: the walk goes on after it.                                                                                         |
| `EXIT_TESTPART`   | Completes the test part, so its branch rules follow. `EXIT_TEST` ends the test.                                                                                                                                                                    |
| Expressions       | NULL counts as false; a value that is not a single boolean is a `ProcessingError`.                                                                                                                                                                 |

`previousItem` gives the item before `from` in a nonlinear part, `undefined` at the first item and in a linear part, which
moves forward only (INFO §2.8.2).

## Item session control

`sessionControl(item)` starts from the defaults and applies the `qti-item-session-control` of the test part, of each section
from the outermost, and of the item reference, attribute by attribute (INFO §5.159.9, §4.2.11, §5.6.10). A section that
ordering mixes into its parent still passes its control to its items.

| Attribute            | Default                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `max-attempts`       | Absent: the item decides, 1 for a non-adaptive item (INFO §7.19.1). |
| `show-feedback`      | `false`                                                             |
| `allow-review`       | `true`                                                              |
| `show-solution`      | `false`                                                             |
| `allow-comment`      | `false`                                                             |
| `allow-skipping`     | `true`                                                              |
| `validate-responses` | `false`                                                             |

## Time limits of the plan

`timeLimits(node, extra?)` returns `minTime`, `maxTime` (seconds, absent when undeclared) and `allowLateSubmission`
(default `false`) of the scope. Each scope declares its own limits; nothing is inherited (INFO §2.8.5, §7.40). The minimum
time of a section or item reference is absent in a nonlinear part. A section that ordering mixes into its parent has no
limits.

Extra time comes from `additionalTestingTime(profile)`, the `additional-testing-time` support unless the profile prohibits it
(BPIG §5.2.4), and changes maximum times only (G41):

| Extra time        | Effect on each maximum time                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time-multiplier` | Multiplied by the factor, which must be positive.                                                                                                 |
| `fixed-minutes`   | The minutes are added to the outermost maximum: a scope whose enclosing scopes declare none. Each path from the test to an item is extended once. |
| `unlimited`       | Removed.                                                                                                                                          |

## Item sessions

An item session is the state of one item instance for one candidate (INFO §2.2.1): its variables, its drafts, its
attempts and its state. `ItemSession` is plain data that holds no item content, so each step takes the item in an
`ItemSessionContext` with the item session control in force and what processing needs: `random`, `customOperators`,
`resolveTemplate` and `limits`. A step returns `{ ok: true, session, events }` or `{ ok: false, refusal }`, and never
changes the session it is given. Every step takes `at`, epoch milliseconds; a step earlier than the latest change of the
session is refused `clock-regression`.

```ts
import { createRandom } from "@assesskit/runtime";
import { readAsi } from "@assesskit/runtime/asi";
import {
  applyItemAction,
  type ItemSessionContext,
  presentItem,
  resultStatus,
  standaloneSessionControl,
  startItemSession,
} from "@assesskit/runtime/delivery";
import { single } from "@assesskit/runtime/values";

const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="capital"
    title="Capital" adaptive="true" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>jakarta</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-simple-choice identifier="bandung">Bandung</qti-simple-choice>
      <qti-simple-choice identifier="jakarta">Jakarta</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
  <qti-response-processing>
    <qti-response-condition>
      <qti-response-if>
        <qti-match><qti-variable identifier="RESPONSE"/><qti-correct identifier="RESPONSE"/></qti-match>
        <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value>
        <qti-set-outcome-value identifier="completionStatus"><qti-base-value base-type="identifier">completed</qti-base-value></qti-set-outcome-value>
      </qti-response-if>
    </qti-response-condition>
  </qti-response-processing>
</qti-assessment-item>`);

if (document.kind === "item") {
  const context: ItemSessionContext = {
    item: document.item,
    control: standaloneSessionControl(),
    random: createRandom(7),
  };
  const key = { ref: "capital", instance: 1 };
  const answer = (choice: string) => ({
    type: "set-responses" as const,
    item: key,
    responses: new Map([["RESPONSE", single("identifier", choice)]]),
  });

  const started = startItemSession(key, 0, context);
  if (!started.ok) throw new Error(started.refusal.message);
  const presented = presentItem(started.session, 1_000, context);
  if (!presented.ok) throw new Error(presented.refusal.message);
  let session = presented.session; // status "interacting", numAttempts 1

  for (const [choice, at] of [
    ["bandung", 5_000],
    ["jakarta", 9_000],
  ] as const) {
    const answered = applyItemAction(session, { ...answer(choice), at }, context);
    if (!answered.ok) throw new Error(answered.refusal.message);
    const submitted = applyItemAction(answered.session, { type: "submit", item: key, at: at + 500 }, context);
    if (!submitted.ok) throw new Error(submitted.refusal.message);
    session = submitted.session;
  }
  // After "bandung": interacting, SCORE 0, numAttempts 1. After "jakarta": closed, SCORE 1, numAttempts 2.
  session.variables.responses.get("duration"); // { cardinality: "single", baseType: "duration", value: 8.5 }
  resultStatus(session, context.item); // "final"
  applyItemAction(session, { ...answer("bandung"), at: 10_000 }, context);
  // { ok: false, refusal: { code: "item-closed", message: "The item session is closed, so its responses are fixed.", source: "INFO §2.2.1" } }
}
```

`startItemSession(key, at, context, options?)` takes these options:

| Option             | Default | Meaning                                                                                                                                                                                                                                                  |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contextValues`    | none    | The values of context variables, `QTI_CONTEXT` included, set before any processing; one left out has its default, else NULL (INFO §2.2.2.1).                                                                                                             |
| `templateDefaults` | none    | The defaults that the test gives template variables in place of their declared ones, from the `qti-template-default` of the item reference (INFO §5.152); an identifier that names no template variable, or a value that does not fit, is a `DataError`. |

### States

| From                       | Step                                                   | To                             |
| -------------------------- | ------------------------------------------------------ | ------------------------------ |
| —                          | `startItemSession`                                     | `initial`                      |
| `initial`                  | `presentItem`: the first attempt starts                | `interacting`                  |
| `initial`                  | `closeItem`: never attempted, responses stay NULL (B6) | `closed`                       |
| `interacting`              | `suspendItem`                                          | `suspended`                    |
| `suspended`                | `presentItem`                                          | `interacting`                  |
| `interacting`              | `submit`, `skip`, `end-attempt` with no attempt left   | `closed`                       |
| `interacting`              | `submit`, `skip`, `end-attempt` with attempts left     | `interacting`, no attempt open |
| `interacting`, `suspended` | `closeItem`: an open attempt ends with its drafts      | `closed`                       |
| `closed`, `solution`       | `review`, when `allow-review` is true                  | `review`                       |
| `closed`, `review`         | `solution`, when `show-solution` is true               | `solution`                     |

`presentItem` on a session that is interacting or closed, `suspendItem` on one that is not interacting, and `closeItem`
on a closed one change nothing.

### Attempts

| Topic                   | Rule                                                                                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start                   | `numAttempts` is 0, then goes up by 1 when an attempt starts (INFO §2.2.2.2). The first starts at the first presentation; the next with `next-attempt`, or with the next action on the item.                                                              |
| First attempt           | Each response variable takes its default value; the drafts take the responses the interactions start with, so a choice interaction starts with nothing selected; `completionStatus` goes from `not_attempted` to `unknown` (INFO §2.2.2.2–3, §2.4.1.1).   |
| End                     | `submit`, `skip` and `end-attempt` end the attempt; the drafts become the submitted responses and response processing runs (INFO §2.5).                                                                                                                   |
| End attempt interaction | Its variable is true when it ended the attempt, false otherwise; its default is ignored (INFO §2.4.5).                                                                                                                                                    |
| Outcomes                | A non-adaptive item resets its outcomes to their default values, else 0 for a numeric single, else NULL, before each response processing; an adaptive item keeps them. `completionStatus` is never reset (INFO §2.2.2.3, §2.5).                           |
| Budget                  | A non-adaptive item closes when the attempts counted reach `max-attempts`: absent is 1, 0 is unlimited (INFO §7.19.1). An attempt that an end attempt interaction with `count-attempt="false"` ended is not counted, though `numAttempts` counts it (D8). |
| Adaptive item           | `max-attempts` is ignored; the session closes when response processing sets `completionStatus` to `completed` (INFO §2.2.2.3).                                                                                                                            |
| Choices                 | The order of the choices of every interaction is drawn at the first presentation and kept (INFO §5.30.1); an order interaction with a default keeps the order of the document (INFO §2.4.1.2).                                                            |
| Time                    | `duration` sums the time the session is interacting, between attempts included, and leaves out suspended time and the time after it closed; it is truncated to the millisecond (INFO §2.2.2.2, G20).                                                      |

Only submitted responses count: the response variables, which processing and a test read, change only when an attempt
starts for the first time or ends (B96). The drafts hold what the candidate entered.

### Actions and refusals

`applyItemAction` takes an `ItemAction` with `at`. The rules are checked in this order, and the first that fails refuses
the action.

| Action          | Refused with                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| any             | `unknown-item` for another item instance; `clock-regression`; `not-current` before the first presentation; `suspended` while suspended                                                                                                                                                                                                                                             |
| `set-responses` | `item-closed` after the session closed; `invalid-response` for a variable the candidate does not set (undeclared, built in, or of an end attempt interaction), a value of another cardinality or base type (an integer goes into a float), or a PCI state for a variable without a portable custom interaction; `value-out-of-range` for an integer outside the safe integers (D3) |
| `submit`        | `item-closed`; `skipping-not-allowed` under `allow-skipping="false"` when every response is NULL or its default; `invalid-response` under `validate-responses="true"` when the response of an interaction the candidate sees breaks its constraints (INFO §7.19.6–7)                                                                                                               |
| `skip`          | `item-closed`; `skipping-not-allowed` under `allow-skipping="false"`, unless the item has no response variables. A skip submits every response as NULL.                                                                                                                                                                                                                            |
| `end-attempt`   | `item-closed`; `invalid-response` when no end attempt interaction is bound to `interaction`. It is neither a skip nor checked for validity.                                                                                                                                                                                                                                        |
| `next-attempt`  | `attempts-exhausted` after the session closed; during an attempt it changes nothing                                                                                                                                                                                                                                                                                                |
| `review`        | `review-not-allowed` before the session closed or without `allow-review`                                                                                                                                                                                                                                                                                                           |
| `solution`      | `solution-not-allowed` before the session closed or without `show-solution`                                                                                                                                                                                                                                                                                                        |
| `comment`       | `comment-not-allowed` without `allow-comment`; a comment replaces the one before                                                                                                                                                                                                                                                                                                   |

`set-responses` may carry `pciStates`, the opaque state of each portable custom interaction by response identifier; the
session keeps the latest for the PCI's `getInstance` (BPIG §3.7.12).

### Feedback and responses shown

`itemFeedback` gives the outcomes that decide integrated feedback and whether modal feedback shows, for `content` to
resolve (INFO §7.19.1–3). Feedback that is not shown is decided by the values that response processing starts from, which
show the body as at the start of an attempt.

| State                | Feedback shown                                                                       |
| -------------------- | ------------------------------------------------------------------------------------ |
| `initial`            | none                                                                                 |
| an attempt open      | the integrated feedback of earlier attempts for an adaptive item; none otherwise     |
| between attempts     | all, modal included: more than one attempt means feedback is shown                   |
| `closed`             | all when `show-feedback` is true                                                     |
| `review`, `solution` | all when `show-feedback` is true, or when the item is adaptive and review is allowed |

`itemResponses` gives the drafts while the session is open, the submitted responses when it is closed or in review, and in
the solution state the correct responses, NULL where none is declared (INFO §2.2.1); the session keeps the candidate's.

### Results status and processing failures

| `resultStatus`              | When                                                                            |
| --------------------------- | ------------------------------------------------------------------------------- |
| `initial`                   | `numAttempts` is 0                                                              |
| `pendingSubmission`         | an attempt is open                                                              |
| `pendingResponseProcessing` | response processing of the latest submission failed                             |
| `pendingExternalScoring`    | response processing ran and the item declares an outcome with `external-scored` |
| `final`                     | response processing ran                                                         |

Template and response processing never throw from a step. When one fails with a runtime error, such as a container above
`maxContainerSize` or a value of the wrong type, the step reports `processing-failed` with the message: template
variables keep their defaults, and outcomes stay as response processing found them, the reset values of a non-adaptive
item or the outcomes of the earlier attempt of an adaptive one (RR §2.7.7, E26). The attempt still counts.

### Item delivered alone

`standaloneSessionControl(control?)` gives the control of an item delivered outside a test (E12): the defaults of item
session control, except that `show-feedback` and `allow-review` are true, with the attributes of the control given in
their place. `max-attempts` stays with the item when no control sets it.

## Decisions

Where the specifications are silent or contradict themselves:

| Gap or topic | Decision                                                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G8           | Without replacement, a uniform subset of the children that are not required, plus the required ones. With replacement, the required ones once and the other draws uniform over all children. Ordering follows.                                     |
| G41          | A multiplier on every maximum, the fixed minutes on the outermost maximum, `unlimited` removes the maximums, minimums unchanged.                                                                                                                   |
| B21          | The selected children keep document order until ordering reorders them. A `select` above the number of children is a `DataError` without replacement.                                                                                              |
| B24          | An invisible section that is not kept together or fixed is mixed into a shuffled parent and has no pre-conditions, branch rules or time limits of its own.                                                                                         |
| B25          | A section reference has the identifier of the section it names.                                                                                                                                                                                    |
| B28          | A NULL pre-condition skips. A nonlinear part ignores its own pre-conditions and branch rules as well as those of its sections and items.                                                                                                           |
| B29          | A target is an item or section of the same part, or a part. `EXIT_SECTION` and `EXIT_TESTPART` complete the container, so its rules follow. The first repeat ahead is the target.                                                                  |
| B36          | Extra time applies whenever the profile has the support and does not prohibit it, whether or not a set lists it.                                                                                                                                   |
| E11          | Instances are counted in order of presentation, for sections too.                                                                                                                                                                                  |
| B3           | An attempt starts at the first presentation, with `next-attempt`, or with the next action on the item after the feedback of the last attempt.                                                                                                      |
| B32          | A skip submits NULL responses. The variables of end attempt interactions are not responses, so an end attempt is never a skip.                                                                                                                     |
| B33          | Only the interactions that the candidate sees are validated: those in hidden feedback or template content are not, and an end attempt is not.                                                                                                      |
| E26          | A failed response processing leaves the outcomes it started from: the reset values of a non-adaptive item, the earlier outcomes of an adaptive one.                                                                                                |
| B2           | An item with an externally scored outcome is `pendingExternalScoring` after response processing, until the scores are supplied (E17).                                                                                                              |
| B41, B100    | An item session starts at the first presentation of its instance: the variant is chosen and the template defaults are evaluated then. An instance not yet presented reads as a session before template processing.                                 |
| B38, G9      | `ITEM.VAR` reads the instance whose attempt ended last, in both submission modes. `validateTest` warns when a test reads it for an item that selection with replacement can repeat in a part that submits each item alone.                         |
| E9           | Leaving an item of a linear part with individual submission submits its open attempt, with the checks, and closes it. `end-part` and `end-test` work from any item, and end open attempts without the checks.                                      |
| B29          | The branch rules of a test part are evaluated after the part ended, so after the submission of a simultaneous group.                                                                                                                               |
| E7, D9       | After a time-out the candidate goes on as after leaving the scope, in both navigation modes. Minimum times bind the candidate's moves, not time-outs.                                                                                              |
| E26          | A pre-condition or branch rule that fails ends the test; outcome processing that fails leaves the outcomes at their defaults; a template default that fails leaves the declared default. Each reports `processing-failed`.                         |
| E28          | Supports `active` and `assigned` are on from the start; only options turn on and off; universal supports are options unless the profile names them.                                                                                                |
| B100         | When the item itself has an avoided hazard and no variant matches the language, the first variant without one is presented.                                                                                                                        |
| E19          | The navigation map lists the item instances of the test part presented only; a linear part lists those presented so far and marks none reachable, a nonlinear part marks every other instance that no maximum time closed.                         |
| E19          | A suspended session shows no content, so that suspending the session withholds the items. An ended one shows the `atEnd` test feedback and no rubric.                                                                                              |
| E19          | `rubric`, `testFeedback` and `modalFeedback` are the contents of the blocks and feedback that are shown, concatenated in order. The stylesheets and catalogs of a block of the test are not carried; those of the item and its modal feedback are. |
| E19          | An invisible section has no entry in the map and its items stand at the depth of the section above; its rubric is still given, because INFO §2.8.6 orders the rubric of every section that holds the item.                                         |
| E19          | `stylesheets` are package paths against the document of the item, and of each stimulus against its own; a variant, whose path the resolvers do not give, resolves against the package root.                                                        |
| E19          | `timeDependent` is part of `CandidateItem`, because the player marks time-dependent items (BPIG §4.3). The title of an item that models a link to a tool is the title of the link.                                                                 |
| E19          | `remaining` and `minimumRemaining` are in milliseconds, like every time of the engine.                                                                                                                                                             |
| E22          | A request larger than a limit of `parseCandidateAction` is a `DataError`, as §3.9 says, and not a `SecurityError`. The limits belong to `parseCandidateAction`; `EngineOptions.limits` keeps the limits of processing and planning.                |
| E28          | The settings of a support are kept in the state (`SessionSupport.settings`), so that the view of a state read back on another device has them.                                                                                                     |

## Errors

| Class             | Thrown when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DataError`       | `parseCandidateAction` meets input that is not an action of the candidate, or larger than a limit; `viewFromJson` meets JSON that is not a view; `viewToJson` or `actionToJson` is given something else; the static checks of `createEngine` find an error; a context value given to `start` names no context variable or does not fit one; a state is not one of the format; an argument has the wrong type; identifiers repeat; a section reference and its section differ; a selection cannot be made; a multiplier is not positive; a plan does not match its structure; an item instance is not in the plan; a context value does not fit its declaration; a response is not a value. |
| `SecurityError`   | A plan would hold more than `maxPlanNodes` sections and items, also at `start`; an expression of a pre-condition or branch rule builds a container above its limit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ProcessingError` | A pre-condition or branch rule fails, or does not give a boolean; a declared value of an item is not in the lexical form of its base type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ReadError`       | A resolver cannot find a section.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| E13, G26          | A test outcome is requested when its covers are presented and over, or the test ended; with no covers, at the end. An item outcome, when its session is over. A request is made once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| E15, G24          | A supplied value of a test outcome is its starting value for every later outcome processing, a failed run included. A supply is accepted after the test ended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| G25               | Supplying an item score does not run response processing again; the outcome processing of the test does run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| C4                | Results go to a CAT engine when the first `stageLength` items are submitted, or the candidate leaves the section (past its last item, or the part or test ends). A `stageLength` absent or 0 is the whole stage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| C8                | Items of a stage not presented when the next stage comes leave the plan: a stage replaces what the engine did not ask the candidate to answer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| B66               | A test part with an adaptive section waits for the first stage where the walk reaches the section, also when the part is nonlinear.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| C9, G21           | The port carries the typed `AssessmentResult`; the codec of [CAT](cat.md#json-binding) writes and reads the field names of the binding's OpenAPI 3.0 listing (Appendix B1.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| E24               | A datestamp is a time in UTC with milliseconds and `Z`; a time outside the years 1 to 9999 is a `DataError` at `start` and `apply`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

A well-formed action that the rules do not allow is a refusal, not an error, and processing failures in item sessions and
in the engine are data.
