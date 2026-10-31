import {
  type AssessmentItem,
  applyItemAction,
  createRandom,
  type ItemKey,
  type ItemSession,
  type ItemSessionContext,
  presentItem,
  readAsi,
  startItemSession,
  type Value,
} from "@assesskit/runtime";
import { createItemSession, parseQtiXml, type QtiDocument, type QtiItemSession } from "@longsightgroup/qti3-core";
import { expect, type TestContext, test } from "vitest";
import { BENCH_OPTIONS, expectAgainst, LONGSIGHT_BUDGETS, type LongsightBudget } from "./budgets.js";
import { EXAMPLES } from "./corpus-items.js";
import { corpusCases } from "./differential/cases.js";
import { longsight } from "./differential/longsight.js";
import type { ItemCase } from "./differential/model.js";
import { runtime, sessionContext, turnValues } from "./differential/runtime.js";

// The runtime against Longsight qti3-core on the 1EdTech examples, with the work that both do, on the same items and
// responses. Longsight has no outcome processing of a test, so the runtime's own benchmark of it stands alone.

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

/** One row of the comparison: what each implementation does in a run, and the hooks that prepare a run outside the time. */
interface Row {
  readonly name: string;
  readonly budget: LongsightBudget;
  readonly runtime: () => void;
  readonly longsight: () => void;
  readonly prepareRuntime?: () => void;
  readonly prepareLongsight?: () => void;
}

/** Times both implementations on a row, the oracle second, and holds the runtime to its budgets. */
async function compareRow(context: Pick<TestContext, "annotate" | "bench">, row: Row): Promise<void> {
  const { annotate, bench } = context;
  const subject = await bench(`${row.name}: runtime`, { beforeEach: row.prepareRuntime }, row.runtime).run(
    BENCH_OPTIONS,
  );
  const reference = await bench(`${row.name}: Longsight`, { beforeEach: row.prepareLongsight }, row.longsight).run(
    BENCH_OPTIONS,
  );
  await expectAgainst(annotate, row.name, subject, reference, row.budget);
}

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
      longsight: () => {
        for (const { xml } of EXAMPLE_SUBJECTS) parseQtiXml(xml);
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
      longsight: open(EXAMPLE_SUBJECTS, 1),
    },
  );
  await compareRow(
    { annotate, bench },
    {
      name: "start an item session that has template processing",
      budget: LONGSIGHT_BUDGETS.startTemplated,
      runtime: start(templated, TEMPLATED_REPEATS),
      longsight: open(templated, TEMPLATED_REPEATS),
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
      longsight: () => {
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
      prepareLongsight: () => {
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
      longsight: () => {
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
