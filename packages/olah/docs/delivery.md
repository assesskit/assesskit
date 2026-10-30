# delivery

`@luthfanwakan/olah/delivery` plans a test session: which sections and items a candidate meets, in which order, under which
rules. It resolves the section references of a test, selects and orders the children of every section from a seeded
generator, numbers the item instances, decides what follows an item in a linear test part under pre-conditions and branch
rules, inherits item session control, and computes time limits with a candidate's extra time. It imports `values`, `asi`,
`pnp`, `processing` and `package` and runs in any JavaScript runtime. It holds no session state and runs no processing of its
own: the expressions of pre-conditions and branch rules go to `processing`.

| Export                                             | Purpose                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `resolveStructure(test, base, resolvers)`          | The `TestStructure`: parts, sections and item references, section references replaced.        |
| `planTest(structure, options)`                     | A `TestPlan`: the sections and item instances of one session.                                 |
| `planItems(plan, part?)`                           | The item instances of a plan, or of one test part, in order of presentation.                  |
| `nextItem(structure, plan, from, rules)`           | The item to present after `from`, or the first item; pre-conditions and branch rules apply.   |
| `previousItem(structure, plan, from)`              | The item before `from`, in a nonlinear part.                                                  |
| `sessionControl(item)`                             | The item session control of an item reference after inheritance.                              |
| `timeLimits(node, extra?)`                         | The time limits of the test, a part, a section or an item reference, with extra time.         |
| `additionalTestingTime(profile)`                   | The extra testing time of a PNP.                                                              |
| `ancestry(node)`, `partOf(node)`                   | The nodes that enclose a node, outermost first; the test part of a section or item reference. |
| `ItemKey`                                          | An item instance: the identifier of the item reference and the instance, from 1.              |
| `TestPlan`, `PlannedPart`, `PlannedSection`, …     | The plan: plain data, identifiers and numbers only.                                           |
| `TestNode`, `PartNode`, `SectionNode`, …           | The nodes of the structure, with their models and the path of the document that holds them.   |
| `RuleContext`                                      | What pre-conditions and branch rules read.                                                    |
| `EffectiveSessionControl`, `EffectiveTimeLimits`   | The results of `sessionControl` and `timeLimits`.                                             |
| `DEFAULT_PLAN_LIMITS`, `PlanLimits`, `PlanOptions` | The limit on the size of a plan, and the options of `planTest`.                               |

## Example

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

## Decisions

Where the specifications are silent or contradict themselves:

| Gap or topic | Decision                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G8           | Without replacement, a uniform subset of the children that are not required, plus the required ones. With replacement, the required ones once and the other draws uniform over all children. Ordering follows. |
| G41          | A multiplier on every maximum, the fixed minutes on the outermost maximum, `unlimited` removes the maximums, minimums unchanged.                                                                               |
| B21          | The selected children keep document order until ordering reorders them. A `select` above the number of children is a `DataError` without replacement.                                                          |
| B24          | An invisible section that is not kept together or fixed is mixed into a shuffled parent and has no pre-conditions, branch rules or time limits of its own.                                                     |
| B25          | A section reference has the identifier of the section it names.                                                                                                                                                |
| B28          | A NULL pre-condition skips. A nonlinear part ignores its own pre-conditions and branch rules as well as those of its sections and items.                                                                       |
| B29          | A target is an item or section of the same part, or a part. `EXIT_SECTION` and `EXIT_TESTPART` complete the container, so its rules follow. The first repeat ahead is the target.                              |
| B36          | Extra time applies whenever the profile has the support and does not prohibit it, whether or not a set lists it.                                                                                               |
| E11          | Instances are counted in order of presentation, for sections too.                                                                                                                                              |

## Errors

| Class             | Thrown when                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataError`       | An argument has the wrong type; identifiers repeat; a section reference and its section differ; a selection cannot be made; a multiplier is not positive; a plan does not match its structure; an item instance is not in the plan. |
| `SecurityError`   | A plan would hold more than `maxPlanNodes` sections and items; an expression builds a container above its limit.                                                                                                                    |
| `ProcessingError` | A pre-condition or branch rule fails, or does not give a boolean.                                                                                                                                                                   |
| `ReadError`       | A resolver cannot find a section.                                                                                                                                                                                                   |
