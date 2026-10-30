# delivery

`@luthfanwakan/olah/delivery` is the headless delivery engine. `createEngine` builds the engine of a test, or of an item
delivered alone for practice, after a static gate over everything a session can reach; the engine is a pure reducer of
candidate sessions: actions in, a new state and events or a refusal out, with navigation and submission, outcome
processing, time limits and deadlines, suspension, supports, variants and serializable states. Below it, the module plans a
test session: which sections and items a candidate meets, in which order, under which rules. It resolves the section
references of a test, selects and orders the children of every section from a seeded generator, numbers the item
instances, decides what follows an item in a linear test part under pre-conditions and branch rules, inherits item session
control, and computes time limits with a candidate's extra time. It runs the session of each item instance: attempts,
adaptive items, end attempt interactions, drafts and submitted responses, review and solution, comments, the states of
portable custom interactions, and processing failures as data. It imports `values`, `asi`, `results`, `pnp`,
`interactions`, `content`, `processing`, `package` and `validate` and runs in any JavaScript runtime. It reads no clock:
every step takes the time it happened.

| Export                                                | Purpose                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `createEngine(definition, options?)`                  | The `Engine` of a test or an item: `start`, `apply`, `deadlines`.                              |
| `stamp(state, action, now)`                           | The action with `at` = max(`now`, the time of the latest step).                                |
| `serializeState(state)`, `deserializeState(text)`     | The JSON text of a state, and the state of a text, with the version of the format.             |
| `DeliveryState`, `Step`, `Deadline`                   | A candidate session as plain data, the result of a step, a time limit as an absolute time.     |
| `CandidateAction`, `HostAction`, `Action`             | The actions of the candidate and the host, with their time.                                    |
| `DeliveryDefinition`, `EngineOptions`, `StartOptions` | What the engine delivers, its options, and the options of a session.                           |
| `resolveStructure(test, base, resolvers)`             | The `TestStructure`: parts, sections and item references, section references replaced.         |
| `planTest(structure, options)`                        | A `TestPlan`: the sections and item instances of one session.                                  |
| `planItems(plan, part?)`                              | The item instances of a plan, or of one test part, in order of presentation.                   |
| `nextItem(structure, plan, from, rules)`              | The item to present after `from`, or the first item; pre-conditions and branch rules apply.    |
| `previousItem(structure, plan, from)`                 | The item before `from`, in a nonlinear part.                                                   |
| `sessionControl(item)`                                | The item session control of an item reference after inheritance.                               |
| `timeLimits(node, extra?)`                            | The time limits of the test, a part, a section or an item reference, with extra time.          |
| `additionalTestingTime(profile)`                      | The extra testing time of a PNP.                                                               |
| `ancestry(node)`, `partOf(node)`                      | The nodes that enclose a node, outermost first; the test part of a section or item reference.  |
| `ItemKey`                                             | An item instance: the identifier of the item reference and the instance, from 1.               |
| `TestPlan`, `PlannedPart`, `PlannedSection`, …        | The plan: plain data, identifiers and numbers only.                                            |
| `TestNode`, `PartNode`, `SectionNode`, …              | The nodes of the structure, with their models and the path of the document that holds them.    |
| `RuleContext`                                         | What pre-conditions and branch rules read.                                                     |
| `EffectiveSessionControl`, `EffectiveTimeLimits`      | The results of `sessionControl` and `timeLimits`.                                              |
| `DEFAULT_PLAN_LIMITS`, `PlanLimits`, `PlanOptions`    | The limit on the size of a plan, and the options of `planTest`.                                |
| `startItemSession(key, at, context, options?)`        | A new item session in the state `initial`, after template processing.                          |
| `presentItem(session, at, context)`                   | Presents the item: the first time it starts the first attempt; a suspended session resumes.    |
| `suspendItem(session, at)`                            | Suspends an interacting session, as when the candidate moves to another item.                  |
| `closeItem(session, at, context)`                     | Closes the session, ending an open attempt with its drafts.                                    |
| `applyItemAction(session, action, context)`           | Applies an action of the candidate: responses, submit, skip, end attempt, review and more.     |
| `itemFeedback(session, item, control)`                | The outcomes that decide the feedback shown in the state of the session.                       |
| `itemResponses(session)`                              | The responses the item shows: drafts, submitted responses, or the solution.                    |
| `resultStatus(session, item)`                         | The session status of Results Reporting.                                                       |
| `standaloneSessionControl(control?)`                  | The item session control of an item delivered alone.                                           |
| `ItemSession`, `ItemSessionStatus`                    | The state of an item session: plain data with its variables, drafts and attempts.              |
| `ItemSessionContext`, `ItemAction`, `ItemStep`        | What a step reads besides the session, the actions of the candidate, and the result of a step. |
| `Refusal`, `RefusalCode`, `DeliveryEvent`, …          | Why a step is refused, and what an accepted step reports.                                      |

## Engine

```ts
import { readAsi } from "@luthfanwakan/olah/asi";
import { createEngine, deserializeState, serializeState, stamp } from "@luthfanwakan/olah/delivery";
import { single } from "@luthfanwakan/olah/values";

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
| `kind: "test"`       | `test`, `base` (the path of the test document), `resolvers` (such as `packageResolvers(pkg)`)           |
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

### Start

| `StartOptions`      | Default | Meaning                                                                                                    |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `seed`              | —       | The seed of the generator of the session: selection, ordering, template values, shuffles.                  |
| `at`                | —       | The time of the start, in epoch milliseconds.                                                              |
| `pnp`               | none    | The candidate's profile: supports, extra time, hazards avoided, item translation.                          |
| `universalSupports` | none    | Supports the program gives every candidate; options unless the profile names them.                         |
| `context`           | none    | Values of context variables, `QTI_CONTEXT` included, for the test and every item that declares them (B50). |

`start` plans the session with `planTest` and `createRandom(seed)`, and presents the first item that the walk of
pre-conditions and branch rules gives; a test with nothing to present ends at once. A context value must fit every
declaration of its variable, in the test and in its items, else `start` throws a `DataError`.

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
`late-submission`, `suspended`, `resumed`, `support-changed`, `variant-selected` and `hazard-unavoidable` (E23). The
TSDoc of `DeliveryEventType` gives the fields of each.

### State

`DeliveryState` is plain data that holds no item content: the version of the format, the status, the time of the latest
step, the generator state, the plan, the item presented, the item instances presented with their sessions, variants,
supports and expiries, the test outcomes, the context values, the clocks of the test, parts and sections, the supports and
what the engine takes from the profile. `serializeState` writes it as JSON with values as `WireValue`s and maps as arrays
of entries; `deserializeState` reads it back equal and refuses another version of the format (E2). Replaying the actions
from the seed reproduces a state and its events exactly (E3).

### Item delivered alone

`createEngine({ kind: "item", item, base, control })` delivers an item as a test of one nonlinear test part with individual
submission (E12): the test is named as the item, the part `<identifier>-part`, its section `<identifier>-section`, and the
item reference has the identifier of the item. Its control is `standaloneSessionControl(control)`.

## Planning example

```ts
import { createRandom } from "@luthfanwakan/olah";
import { readAsi } from "@luthfanwakan/olah/asi";
import {
  nextItem,
  planItems,
  planTest,
  resolveStructure,
  sessionControl,
  timeLimits,
} from "@luthfanwakan/olah/delivery";
import { single } from "@luthfanwakan/olah/values";

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

## Time limits

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
import { createRandom } from "@luthfanwakan/olah";
import { readAsi } from "@luthfanwakan/olah/asi";
import {
  applyItemAction,
  type ItemSessionContext,
  presentItem,
  resultStatus,
  standaloneSessionControl,
  startItemSession,
} from "@luthfanwakan/olah/delivery";
import { single } from "@luthfanwakan/olah/values";

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

Template and response processing never throw from a step. When one fails with an olah error, such as a container above
`maxContainerSize` or a value of the wrong type, the step reports `processing-failed` with the message: template
variables keep their defaults, and outcomes stay as response processing found them, the reset values of a non-adaptive
item or the outcomes of the earlier attempt of an adaptive one (RR §2.7.7, E26). The attempt still counts.

### Item delivered alone

`standaloneSessionControl(control?)` gives the control of an item delivered outside a test (E12): the defaults of item
session control, except that `show-feedback` and `allow-review` are true, with the attributes of the control given in
their place. `max-attempts` stays with the item when no control sets it.

## Decisions

Where the specifications are silent or contradict themselves:

| Gap or topic | Decision                                                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G8           | Without replacement, a uniform subset of the children that are not required, plus the required ones. With replacement, the required ones once and the other draws uniform over all children. Ordering follows.             |
| G41          | A multiplier on every maximum, the fixed minutes on the outermost maximum, `unlimited` removes the maximums, minimums unchanged.                                                                                           |
| B21          | The selected children keep document order until ordering reorders them. A `select` above the number of children is a `DataError` without replacement.                                                                      |
| B24          | An invisible section that is not kept together or fixed is mixed into a shuffled parent and has no pre-conditions, branch rules or time limits of its own.                                                                 |
| B25          | A section reference has the identifier of the section it names.                                                                                                                                                            |
| B28          | A NULL pre-condition skips. A nonlinear part ignores its own pre-conditions and branch rules as well as those of its sections and items.                                                                                   |
| B29          | A target is an item or section of the same part, or a part. `EXIT_SECTION` and `EXIT_TESTPART` complete the container, so its rules follow. The first repeat ahead is the target.                                          |
| B36          | Extra time applies whenever the profile has the support and does not prohibit it, whether or not a set lists it.                                                                                                           |
| E11          | Instances are counted in order of presentation, for sections too.                                                                                                                                                          |
| B3           | An attempt starts at the first presentation, with `next-attempt`, or with the next action on the item after the feedback of the last attempt.                                                                              |
| B32          | A skip submits NULL responses. The variables of end attempt interactions are not responses, so an end attempt is never a skip.                                                                                             |
| B33          | Only the interactions that the candidate sees are validated: those in hidden feedback or template content are not, and an end attempt is not.                                                                              |
| E26          | A failed response processing leaves the outcomes it started from: the reset values of a non-adaptive item, the earlier outcomes of an adaptive one.                                                                        |
| B2           | An item with an externally scored outcome is `pendingExternalScoring` after response processing; supplying the scores is pending work of the test.                                                                         |
| B41, B100    | An item session starts at the first presentation of its instance: the variant is chosen and the template defaults are evaluated then. An instance not yet presented reads as a session before template processing.         |
| B38, G9      | `ITEM.VAR` reads the instance whose attempt ended last, in both submission modes.                                                                                                                                          |
| E9           | Leaving an item of a linear part with individual submission submits its open attempt, with the checks, and closes it. `end-part` and `end-test` work from any item, and end open attempts without the checks.              |
| B29          | The branch rules of a test part are evaluated after the part ended, so after the submission of a simultaneous group.                                                                                                       |
| E7, D9       | After a time-out the candidate goes on as after leaving the scope, in both navigation modes. Minimum times bind the candidate's moves, not time-outs.                                                                      |
| E26          | A pre-condition or branch rule that fails ends the test; outcome processing that fails leaves the outcomes at their defaults; a template default that fails leaves the declared default. Each reports `processing-failed`. |
| E28          | Supports `active` and `assigned` are on from the start; only options turn on and off; universal supports are options unless the profile names them.                                                                        |
| B100         | When the item itself has an avoided hazard and no variant matches the language, the first variant without one is presented.                                                                                                |

## Errors

| Class             | Thrown when                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataError`       | The static checks of `createEngine` find an error; a context value given to `start` names no context variable or does not fit one; a state is not one of the format; an argument has the wrong type; identifiers repeat; a section reference and its section differ; a selection cannot be made; a multiplier is not positive; a plan does not match its structure; an item instance is not in the plan; a context value does not fit its declaration; a response is not a value. |
| `SecurityError`   | A plan would hold more than `maxPlanNodes` sections and items, also at `start`; an expression of a pre-condition or branch rule builds a container above its limit.                                                                                                                                                                                                                                                                                                               |
| `ProcessingError` | A pre-condition or branch rule fails, or does not give a boolean; a declared value of an item is not in the lexical form of its base type.                                                                                                                                                                                                                                                                                                                                        |
| `ReadError`       | A resolver cannot find a section.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

A well-formed action that the rules do not allow is a refusal, not an error, and processing failures in item sessions and
in the engine are data.
