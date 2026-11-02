import {
  ASI_NAMESPACE,
  type AssessmentItem,
  applyItemAction,
  createEngine,
  createRandom,
  type ItemKey,
  type ItemSession,
  type ItemSessionContext,
  presentItem,
  readAsi,
  single,
  startItemSession,
  type Value,
  validateAsi,
} from "@assesskit/runtime";
import {
  createItemSession,
  parseQtiTest,
  parseQtiXml,
  type QtiDocument,
  type QtiItemSession,
  startQtiTest,
  submitQtiTestAnswer,
  validateAssessmentItem,
} from "@longsightgroup/qti3-core";
import { expect, test } from "vitest";
import { compareRow, LONGSIGHT_BUDGETS } from "./budgets.js";
import { EXAMPLES } from "./corpus-items.js";
import { corpusCases } from "./differential/cases.js";
import { CHOICE_ITEM } from "./differential/items.js";
import { longsight } from "./differential/longsight.js";
import type { ItemCase } from "./differential/model.js";
import { runtime, sessionContext, turnValues } from "./differential/runtime.js";
import {
  act,
  begun,
  engineOf,
  fail,
  next,
  outcome,
  part,
  pick,
  played,
  processing,
  refs,
  SUM_SCORES,
  section,
  setOutcome,
} from "./pending-fixtures.js";

// The runtime against Longsight qti3-core with the work that both do, on the same items and responses: the 1EdTech
// examples for items, and a fixed test of choice items for a submission with outcome processing. Longsight's tests
// have a fixed order, individual submission and the sum of the scores, so the test is that, and the runtime's own
// benchmark of selection, ordering and many rules stands alone in delivery.bench.ts.

/** An example item that both implementations read and score, with the responses the oracle takes as correct. */
interface Subject extends ItemCase {
  /** The item as the runtime reads it. */
  readonly item: AssessmentItem;
  /** The item as Longsight parses it. */
  readonly document: QtiDocument;
  /** The responses as the runtime takes them, which Longsight takes as they are. */
  readonly values: ReadonlyMap<string, Value | null>;
}

/** The times a row of the few items with template processing repeats its work, so that a sample is long enough to time. */
const TEMPLATED_REPEATS = 20;

const keyOf = ({ identifier }: AssessmentItem): ItemKey => ({ ref: identifier, instance: 1 });

/** Starts an item session of the runtime and presents it, which draws the choice orders and starts the first attempt. */
function presented(
  item: AssessmentItem,
  seed: number,
): { session: ItemSession; context: ItemSessionContext } | undefined {
  const context = sessionContext(item, seed);
  const started = startItemSession(keyOf(item), 0, context);
  if (!started.ok) return undefined;
  const step = presentItem(started.session, 0, { ...context, random: createRandom(seed) });
  return step.ok ? { session: step.session, context } : undefined;
}

/** Enters the responses of a subject and submits them in a session of the runtime that has been presented. */
function submitted(
  item: AssessmentItem,
  values: Subject["values"],
  { session, context }: { session: ItemSession; context: ItemSessionContext },
): boolean {
  const key = keyOf(item);
  const set = applyItemAction(session, { type: "set-responses", item: key, responses: values, at: 1 }, context);
  return set.ok && applyItemAction(set.session, { type: "submit", item: key, at: 2 }, context).ok;
}

/** The examples that both implementations read and score, whose responses the runtime takes. */
function subjects(): Subject[] {
  return corpusCases(EXAMPLES)
    .filter(({ name }) => name.endsWith("(correct responses)"))
    .flatMap((testCase) => {
      if (!(longsight.run(testCase).accepted && runtime.run(testCase).accepted)) return [];
      const read = readAsi(testCase.xml);
      const { document } = parseQtiXml(testCase.xml);
      if (read.kind !== "item" || document === undefined) return [];
      const subject = { ...testCase, item: read.item, document, values: turnValues(read.item, testCase.responses) };
      const session = presented(subject.item, subject.seed);
      return session !== undefined && submitted(subject.item, subject.values, session) ? [subject] : [];
    });
}

const EXAMPLE_SUBJECTS = subjects();

test("has examples that both implementations read and score", () => {
  expect(EXAMPLE_SUBJECTS.length).toBeGreaterThan(200);
});

test("parses the example items as fast as Longsight", async ({ annotate, bench }) => {
  await compareRow(
    { annotate, bench },
    {
      name: "parse an item",
      budget: LONGSIGHT_BUDGETS.parse,
      runtime: () => {
        for (const { xml } of EXAMPLE_SUBJECTS) readAsi(xml);
      },
      reference: () => {
        for (const { xml } of EXAMPLE_SUBJECTS) parseQtiXml(xml);
      },
    },
  );
});

test("validates the example items within its budget against Longsight", async ({ annotate, bench }) => {
  await compareRow(
    { annotate, bench },
    {
      name: "validate an item",
      budget: LONGSIGHT_BUDGETS.validate,
      runtime: () => {
        for (const { item } of EXAMPLE_SUBJECTS) validateAsi({ kind: "item", item });
      },
      reference: () => {
        for (const { document } of EXAMPLE_SUBJECTS) validateAssessmentItem(document);
      },
    },
  );
});

test("starts an item session, with template processing, as fast as Longsight", async ({ annotate, bench }) => {
  const start = (list: readonly Subject[], repeats: number) => () => {
    for (let run = 0; run < repeats; run++) for (const { item, seed } of list) presented(item, seed);
  };
  const open = (list: readonly Subject[], repeats: number) => () => {
    for (let run = 0; run < repeats; run++)
      for (const { document, seed } of list) createItemSession(document, undefined, { randomSeed: seed });
  };
  const templated = EXAMPLE_SUBJECTS.filter(({ item }) => (item.templateProcessing?.rules.length ?? 0) > 0);
  expect(templated.length).toBeGreaterThan(3);
  await compareRow(
    { annotate, bench },
    {
      name: "start an item session",
      budget: LONGSIGHT_BUDGETS.start,
      runtime: start(EXAMPLE_SUBJECTS, 1),
      reference: open(EXAMPLE_SUBJECTS, 1),
    },
  );
  await compareRow(
    { annotate, bench },
    {
      name: "start an item session that has template processing",
      budget: LONGSIGHT_BUDGETS.startTemplated,
      runtime: start(templated, TEMPLATED_REPEATS),
      reference: open(templated, TEMPLATED_REPEATS),
    },
  );
});

test("enters responses and processes them on submit as fast as Longsight", async ({ annotate, bench }) => {
  let sessions: { session: ItemSession; context: ItemSessionContext }[] = [];
  let oracle: QtiItemSession[] = [];
  await compareRow(
    { annotate, bench },
    {
      name: "submit responses",
      budget: LONGSIGHT_BUDGETS.submit,
      runtime: () => {
        EXAMPLE_SUBJECTS.forEach(({ item, values }, index) => {
          const session = sessions[index];
          if (session !== undefined) submitted(item, values, session);
        });
      },
      reference: () => {
        EXAMPLE_SUBJECTS.forEach(({ responses }, index) => {
          const session = oracle[index];
          if (session === undefined) return;
          for (const [identifier, value] of Object.entries(responses)) session.respond(identifier, value);
          session.score();
        });
      },
      prepareRuntime: () => {
        sessions = EXAMPLE_SUBJECTS.flatMap(({ item, seed }) => presented(item, seed) ?? []);
      },
      prepareReference: () => {
        oracle = EXAMPLE_SUBJECTS.map(({ document, seed }) =>
          createItemSession(document, undefined, { randomSeed: seed }),
        );
      },
    },
  );
});

test("takes an item from its document to its score as fast as Longsight", async ({ annotate, bench }) => {
  await compareRow(
    { annotate, bench },
    {
      name: "read, start and score an item",
      budget: LONGSIGHT_BUDGETS.score,
      runtime: () => {
        for (const subject of EXAMPLE_SUBJECTS) {
          const read = readAsi(subject.xml);
          if (read.kind !== "item") continue;
          const session = presented(read.item, subject.seed);
          if (session !== undefined) submitted(read.item, subject.values, session);
        }
      },
      reference: () => {
        for (const { xml, responses, seed } of EXAMPLE_SUBJECTS) {
          const { document } = parseQtiXml(xml);
          if (document === undefined) continue;
          const session = createItemSession(document, undefined, { randomSeed: seed });
          for (const [identifier, value] of Object.entries(responses)) session.respond(identifier, value);
          session.score();
        }
      },
    },
  );
});

/** The sections of the test and the items of each, and the share of the items answered before the one that is timed. */
const TEST_SECTIONS = 10;
const TEST_ITEMS_PER_SECTION = 10;
const ANSWERED_BEFORE = 50;
/** The submissions in a sample of that row: one takes about 20 microseconds, and a sample of milliseconds is long enough to time. */
const SUBMITS_PER_SAMPLE = 100;

/**
 * The test of {@link TEST_SECTIONS} sections of {@link TEST_ITEMS_PER_SECTION} choice items with the sum of the scores as
 * its outcome, as the engine of the runtime delivers it and as Longsight executes it, with the identifiers of its items.
 */
function choiceTest() {
  const itemRefs = Array.from({ length: TEST_SECTIONS }, (_, place) =>
    Array.from({ length: TEST_ITEMS_PER_SECTION }, (_, item) => `s${place}i${item}`),
  );
  const content =
    outcome("TOTAL", "float") +
    part("P", itemRefs.map((list, place) => section(`sec${place}`, refs(...list))).join("")) +
    processing(setOutcome("TOTAL", SUM_SCORES));
  // The engine is the build, which `createEngine` of this import is: the helpers of the fixtures import the sources.
  const engine = engineOf(content, { create: createEngine });
  const parsed = parseQtiTest(
    `<qti-assessment-test xmlns="${ASI_NAMESPACE}" identifier="T" title="T">${content}</qti-assessment-test>`,
  );
  if (!parsed.ok) fail("Longsight does not accept the test.");
  return { engine, test: parsed.value, names: itemRefs.flat() };
}

/** The starts in a sample of that row: one takes microseconds, and a sample of milliseconds is long enough to time. */
const STARTS_PER_SAMPLE = 100;

test("starts a session of a test within its budget against Longsight", async ({ annotate, bench }) => {
  const { engine, test } = choiceTest();
  const started = engine.start({ seed: 1, at: 0 });
  expect(started.ok && started.state.plan.parts[0]?.children).toHaveLength(TEST_SECTIONS);
  expect(startQtiTest(test).ok).toBe(true);
  // The engine starts the session of the first item as it starts the test; Longsight starts an item session apart.
  const item = parseQtiXml(CHOICE_ITEM).document ?? fail("Longsight does not accept the item.");
  await compareRow(
    { annotate, bench },
    {
      name: "start a test",
      budget: LONGSIGHT_BUDGETS.testStart,
      runtime: () => {
        for (let start = 0; start < STARTS_PER_SAMPLE; start++) engine.start({ seed: 1, at: 0 });
      },
      reference: () => {
        for (let start = 0; start < STARTS_PER_SAMPLE; start++) {
          startQtiTest(test);
          createItemSession(item, undefined, { randomSeed: 1 });
        }
      },
    },
  );
});

test("processes the outcomes of a test on a submission as fast as Longsight", async ({ annotate, bench }) => {
  const { engine, test, names } = choiceTest();
  const answer = (index: number, at: number) => [pick(names[index] ?? fail("No such item."), "B", at)];
  // The session halfway through: the first items answered rightly, and the draft of the next one entered.
  let state = begun(engine).state;
  let at = 0;
  for (let index = 0; index < ANSWERED_BEFORE; index++) {
    state = played(
      engine,
      state,
      ...answer(index, ++at),
      act("submit", names[index] ?? fail("No such item."), ++at),
      next(++at),
    ).state;
  }
  const ref = names[ANSWERED_BEFORE] ?? fail("No such item.");
  const drafted = played(engine, state, ...answer(ANSWERED_BEFORE, ++at)).state;
  const submission = act("submit", ref, ++at);
  const submitted = engine.apply(drafted, submission);
  if (!submitted.ok) fail(`The submission was refused: ${submitted.refusal.code}.`);
  expect(submitted.state.outcomes.get("TOTAL")).toEqual(single("float", ANSWERED_BEFORE + 1));

  let oracle = startQtiTest(test);
  if (!oracle.ok) fail("Longsight does not start the test.");
  for (let index = 0; index < ANSWERED_BEFORE; index++) {
    oracle = submitQtiTestAnswer(test, oracle.value, { itemRef: names[index] ?? fail("No such item."), score: 1 });
    if (!oracle.ok) fail("Longsight refuses an answer.");
  }
  const before = oracle.value;
  const item = parseQtiXml(CHOICE_ITEM).document ?? fail("Longsight does not accept the item.");
  let sessions: QtiItemSession[] = [];
  const prepare = () => {
    sessions = Array.from({ length: SUBMITS_PER_SAMPLE }, () => {
      const session = createItemSession(item);
      session.respond("RESPONSE", "B");
      return session;
    });
  };
  prepare();
  const checked = submitQtiTestAnswer(test, before, {
    itemRef: ref,
    score: Number(sessions[0]?.score().outcomes.SCORE),
  });
  expect(checked.ok && checked.value.outcomes.TOTAL).toBe(ANSWERED_BEFORE + 1);
  prepare();

  await compareRow(
    { annotate, bench },
    {
      name: "submit an item of a test",
      budget: LONGSIGHT_BUDGETS.testSubmit,
      runtime: () => {
        for (let submit = 0; submit < SUBMITS_PER_SAMPLE; submit++) engine.apply(drafted, submission);
      },
      reference: () => {
        for (const session of sessions) {
          submitQtiTestAnswer(test, before, { itemRef: ref, score: Number(session.score().outcomes.SCORE) });
        }
      },
      prepareReference: prepare,
    },
  );
});
