import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import {
  type AssessmentItem,
  type AssessmentTest,
  applyItemAction,
  container,
  createItemVariables,
  createRandom,
  type ItemAction,
  type ItemKey,
  type ItemSession,
  type ItemSessionContext,
  type ItemSessionView,
  type ItemStep,
  itemFeedback,
  nextItem,
  planItems,
  planTest,
  presentItem,
  readAsi,
  resolveStructure,
  resultStatus,
  sessionControl,
  single,
  standaloneSessionControl,
  startItemSession,
  type TestScope,
  type TestStructure,
  timeLimits,
  type Value,
  visibleModalFeedback,
} from "../src/index.js";

const examples = join(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");

/** The tests of the examples, by path. */
const tests = new Map<string, AssessmentTest>();
for (const path of readdirSync(examples, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".xml"))
  .sort()) {
  const text = readFileSync(join(examples, path), "utf8");
  if (!text.includes("<qti-assessment-test")) continue;
  const document = readAsi(text, { path });
  if (document.kind === "test") tests.set(path, document.test);
}

function structureAt(path: string): TestStructure {
  const test = tests.get(path);
  if (test === undefined) throw new Error(`The examples have no test ${path}.`);
  return resolveStructure(test, path, {
    sections: () => {
      throw new Error(`${path} has a section reference.`);
    },
  });
}

const shown = (key: ItemKey): string => `${key.ref}${key.instance > 1 ? `#${key.instance}` : ""}`;

/** An item with one response variable, which stands in for the items that the tests refer to. */
const ITEM: AssessmentItem = (() => {
  const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="stand-in" title="Stand-in" time-dependent="false">
    <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
    <qti-item-body/>
  </qti-assessment-item>`);
  if (document.kind !== "item") throw new Error("Expected an item.");
  return document.item;
})();

/** A test scope whose items have submitted the responses given, by item reference. */
function answers(structure: TestStructure, given: Readonly<Record<string, string>>): TestScope {
  const view = (ref: string): ItemSessionView | undefined => {
    const node = structure.itemRef(ref);
    if (node === undefined) return undefined;
    const variables = createItemVariables(ITEM);
    const answer = given[ref];
    const responses = new Map(variables.responses).set(
      "RESPONSE",
      answer === undefined ? null : single("identifier", answer),
    );
    return { ref: node.model, item: ITEM, variables: { ...variables, responses } };
  };
  return {
    itemSessions: () => Object.keys(given).flatMap((ref) => view(ref) ?? []),
    itemSession: (identifier) => view(identifier),
    variable: () => undefined,
  };
}

function walk(structure: TestStructure, given: Readonly<Record<string, string>>): string[] {
  const rules = { outcomes: new Map(), scope: answers(structure, given), context: { random: createRandom(1) } };
  const plan = planTest(structure, { random: createRandom(1) });
  const met: string[] = [];
  for (
    let at = nextItem(structure, plan, undefined, rules);
    at !== undefined;
    at = nextItem(structure, plan, at, rules)
  ) {
    met.push(shown(at));
  }
  return met;
}

/** The item of the examples at a path. */
function itemAt(path: string): AssessmentItem {
  const document = readAsi(readFileSync(join(examples, path), "utf8"), { path });
  if (document.kind !== "item") throw new Error(`${path} is not an item.`);
  return document.item;
}

const KEY: ItemKey = { ref: "item", instance: 1 };

function sessionOf(context: ItemSessionContext): ItemSession {
  const started = startItemSession(KEY, 0, context);
  if (!started.ok) throw new Error(started.refusal.message);
  const step = presentItem(started.session, 0, context);
  if (!step.ok) throw new Error(step.refusal.message);
  return step.session;
}

/** Answers the choice interaction `identifier` with `choice` and submits, or ends the attempt with a hint. */
function turn(
  session: ItemSession,
  context: ItemSessionContext,
  responses: Record<string, string>,
  end?: string,
): ItemStep {
  const at = session.updatedAt + 1000;
  const answered = applyItemAction(
    session,
    {
      type: "set-responses",
      item: KEY,
      responses: new Map(
        Object.entries(responses).map(([identifier, choice]) => [identifier, single("identifier", choice)]),
      ),
      at,
    },
    context,
  );
  if (!answered.ok) return answered;
  const ending: ItemAction =
    end === undefined ? { type: "submit", item: KEY } : { type: "end-attempt", item: KEY, interaction: end };
  return applyItemAction(answered.session, { ...ending, at: at + 1 }, context);
}

function accepted(step: ItemStep): ItemSession {
  if (!step.ok) throw new Error(`The step was refused: ${step.refusal.message}`);
  return step.session;
}

const outcomeOf = (session: ItemSession, identifier: string): Value | null =>
  session.variables.outcomes.get(identifier) ?? null;

describe("the adaptive items of the examples", () => {
  it("[E26][B3][C] turns the failing rules of feedback_adaptive.xml into data, attempt after attempt", () => {
    // Its qti-member has the container first, where INFO §2.11.3.29 wants the single value, and for the correct response
    // it sets the multiple FEEDBACK to a single value (INFO §5.130.2), so that every run fails.
    const item = itemAt("packaging/items/feedback_adaptive.xml");
    const context: ItemSessionContext = { item, control: standaloneSessionControl(), random: createRandom(1) };
    const member =
      "The operator qti-member takes multiple or ordered boolean or directedPair or file or float or identifier or integer or pair or point or string or uri operands, found a single identifier.";
    const details: (string | undefined)[] = [];
    let session = sessionOf(context);
    for (const [attempt, choice] of ["MGH001A", "MGH001B", "MGH001C", "MGH001D"].entries()) {
      const step = turn(session, context, { RESPONSE: choice });
      if (!step.ok) throw new Error(step.refusal.message);
      session = step.session;
      expect(step.events.map(({ type }) => type)).toEqual(["attempt-ended", "processing-failed"]);
      details.push(step.events[1]?.detail);
      expect([session.status, session.variables.responses.get("numAttempts"), resultStatus(session, item)]).toEqual([
        "interacting",
        single("integer", attempt + 1),
        "pendingResponseProcessing",
      ]);
      expect([outcomeOf(session, "SCORE"), outcomeOf(session, "completionStatus")]).toEqual([
        single("float", 0),
        single("identifier", "unknown"),
      ]);
    }
    expect(details).toEqual([
      member,
      member,
      "The variable FEEDBACK is a multiple identifier and cannot be set to a single identifier.",
      member,
    ]);
  });

  it("[E10][B10][C] gives the hint of hint.xml through its end attempt interaction, and scores the next attempt", () => {
    const item = itemAt("packaging/items/hint.xml");
    const context: ItemSessionContext = { item, control: standaloneSessionControl(), random: createRandom(1) };
    const hinted = accepted(turn(sessionOf(context), context, {}, "HINTREQUEST"));
    expect([hinted.variables.responses.get("HINTREQUEST"), outcomeOf(hinted, "FEEDBACK")]).toEqual([
      single("boolean", true),
      single("identifier", "HINT"),
    ]);
    const answered = accepted(turn(hinted, context, { RESPONSE: "MGH001C" }));
    expect([
      answered.variables.responses.get("HINTREQUEST"),
      outcomeOf(answered, "FEEDBACK"),
      outcomeOf(answered, "SCORE"),
      answered.variables.responses.get("numAttempts"),
      answered.status,
    ]).toEqual([
      single("boolean", false),
      single("identifier", "NOHINT"),
      single("float", 1),
      single("integer", 2),
      "interacting",
    ]);
  });

  it("[E10][B5][B9][C] plays the Monty Hall game of adaptive.xml to completion: the switch wins and the strategy is asked", () => {
    const item = itemAt("packaging/items/adaptive.xml");
    const context: ItemSessionContext = { item, control: standaloneSessionControl(), random: createRandom(3) };
    const first = accepted(turn(sessionOf(context), context, { DOOR: "DoorA" }));
    const revealed = outcomeOf(first, "REVEALED");
    if (revealed?.cardinality !== "single") throw new Error("Monty reveals one door.");
    const other = ["DoorB", "DoorC"].find((door) => door !== revealed.value) ?? "";
    expect([outcomeOf(first, "STORY"), outcomeOf(first, "FIRSTDOOR"), outcomeOf(first, "completionStatus")]).toEqual([
      single("identifier", "tempter"),
      single("identifier", "DoorA"),
      single("identifier", "incomplete"),
    ]);
    expect(outcomeOf(first, "CLOSED")).toEqual(container("multiple", "identifier", ["DoorA", other]));
    const second = accepted(turn(first, context, { DOOR: other }));
    expect([
      outcomeOf(second, "STORY"),
      outcomeOf(second, "PRIZE"),
      outcomeOf(second, "SCORE"),
      outcomeOf(second, "FEEDBACK"),
    ]).toEqual([
      single("identifier", "prize"),
      single("identifier", other),
      single("float", 1),
      single("identifier", "poser"),
    ]);
    const last = accepted(turn(second, context, { RESPONSE: "switchStrategy" }));
    expect([last.status, outcomeOf(last, "SCORE"), outcomeOf(last, "completionStatus")]).toEqual([
      "closed",
      single("float", 3),
      single("identifier", "completed"),
    ]);
    const feedback = itemFeedback(last, item, context.control);
    expect(visibleModalFeedback(item, feedback.outcomes).map(({ identifier }) => identifier)).toEqual([
      "switchStrategy",
    ]);
  });
});

describe("the tests of the examples", () => {
  it("[B21][B22][B23][B24][E11][C] plan under many seeds into item instances of their own item references", () => {
    expect(tests.size).toBeGreaterThan(20);
    for (const path of tests.keys()) {
      const structure = structureAt(path);
      for (let seed = 1; seed <= 20; seed++) {
        const plan = planTest(structure, { random: createRandom(seed) });
        const keys = planItems(plan);
        expect(keys.length, path).toBeGreaterThan(0);
        for (const key of keys) expect(structure.itemRef(key.ref), path).toBeDefined();
        const counts = new Map<string, number>();
        for (const key of keys) {
          counts.set(key.ref, (counts.get(key.ref) ?? 0) + 1);
          expect(key.instance, path).toBe(counts.get(key.ref));
        }
      }
    }
  });

  it("[B21][C] selects 2 of 3 items with item034 required, and one of two with the block required (RTEST-12)", () => {
    const structure = structureAt("tests/rtest12.xml");
    const sectionA = new Set<string>();
    const sectionB = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) {
      const plan = planTest(structure, { random: createRandom(seed) });
      const [a, b] = plan.parts[0]?.children ?? [];
      const refs = (children: typeof a): string[] =>
        (children?.children ?? []).flatMap((child) => (child.kind === "item" ? [child.key.ref] : []));
      expect(refs(a)[0]).toBe("item034");
      expect(refs(a)).toHaveLength(2);
      sectionA.add(refs(a)[1] ?? "");
      // Section B1 is invisible and not kept together, so its items mix with the one other item that B selected.
      expect(refs(b)).toHaveLength(4);
      for (const ref of ["item347", "item653", "item656"]) expect(refs(b)).toContain(ref);
      sectionB.add(
        refs(b)
          .filter((ref) => !["item347", "item653", "item656"].includes(ref))
          .join(),
      );
    }
    expect([...sectionA].sort()).toEqual(["item063", "item160"]);
    expect([...sectionB].sort()).toEqual(["item065", "item365", "item434"]);
  });

  it("[B23][B24][C] keeps item034 first and the block B1 together in its order (RTEST-24)", () => {
    const structure = structureAt("tests/rtest24.xml");
    for (let seed = 1; seed <= 100; seed++) {
      const plan = planTest(structure, { random: createRandom(seed) });
      const [a, b] = plan.parts[0]?.children ?? [];
      expect(a?.children[0]).toEqual({ kind: "item", key: { ref: "item034", instance: 1 } });
      const block = b?.children.find((child) => child.kind === "section");
      expect(
        block?.kind === "section" ? block.children.map((child) => (child.kind === "item" ? child.key.ref : "")) : [],
      ).toEqual(["item347", "item653"]);
    }
  });

  it("[B28][C] presents item160 after the response Y and item063 after N (RTEST-13)", () => {
    const structure = structureAt("tests/rtest13.xml");
    expect(walk(structure, { item034: "Y", item347: "Y" })).toEqual([
      "item034",
      "item160",
      "item347",
      "item653",
      "item656",
    ]);
    expect(walk(structure, { item034: "N", item347: "Y" })).toEqual([
      "item034",
      "item063",
      "item347",
      "item653",
      "item656",
    ]);
  });

  it("[B29][C] branches to item656, or leaves section B, by the response to item347 (RTEST-13)", () => {
    const structure = structureAt("tests/rtest13.xml");
    expect(walk(structure, { item034: "Y", item347: "N" })).toEqual(["item034", "item160", "item347", "item656"]);
    // Neither N nor Y: the second rule exits section B, which is the last section.
    expect(walk(structure, { item034: "Y", item347: "X" })).toEqual(["item034", "item160", "item347"]);
  });

  it("[B28][C] presents section SA only for the response A to the switch item (RTEST-COMPLETE)", () => {
    const structure = structureAt("tests/complete.xml");
    expect(walk(structure, { switch: "A" })).toEqual(["switch", "A1"]);
    expect(walk(structure, { switch: "B" })).toEqual(["switch"]);
  });

  it("[B30][C] gives the item session control of the test part to its items (RTEST-COMPLETE)", () => {
    const structure = structureAt("tests/complete.xml");
    const item = structure.itemRef("A1");
    if (item === undefined) throw new Error("No A1.");
    expect(sessionControl(item)).toEqual({
      maxAttempts: 1,
      showFeedback: true,
      allowReview: false,
      showSolution: false,
      allowComment: false,
      allowSkipping: true,
      validateResponses: false,
    });
  });

  it("[B35][B36][G41][C] gives the limits of the test and its part, and adds the extra time of a candidate (RTEST-COMPLETE)", () => {
    const structure = structureAt("tests/complete.xml");
    const part = structure.part("RTEST-COMPLETE-PTI");
    if (part === undefined) throw new Error("No part.");
    expect(timeLimits(structure.test)).toEqual({ minTime: 600, maxTime: 3600, allowLateSubmission: false });
    expect(timeLimits(part)).toEqual({ maxTime: 3600, allowLateSubmission: false });
    expect(timeLimits(structure.test, { kind: "time-multiplier", multiplier: 1.25 }).maxTime).toBe(4500);
    expect(timeLimits(structure.test, { kind: "fixed-minutes", minutes: 15 }).maxTime).toBe(4500);
    expect(timeLimits(part, { kind: "fixed-minutes", minutes: 15 }).maxTime).toBe(3600);
    expect(timeLimits(structure.test, { kind: "unlimited" })).toEqual({ minTime: 600, allowLateSubmission: false });
  });
});
