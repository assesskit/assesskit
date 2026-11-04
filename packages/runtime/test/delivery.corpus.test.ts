import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import {
  type Action,
  type AssessmentItem,
  type AssessmentTest,
  applyItemAction,
  buildContainer,
  buildSingle,
  type CandidateAction,
  createEngine,
  createItemVariables,
  createPackageResolvers,
  createRandom,
  type DeliveryState,
  deriveItemFeedback,
  deriveSessionStatus,
  deserializeState,
  type Engine,
  findNextItem,
  type ItemAction,
  type ItemKey,
  type ItemSession,
  type ItemSessionContext,
  type ItemSessionView,
  type ItemStep,
  listPlanItems,
  planTest,
  presentItem,
  readAsi,
  readCandidateAction,
  readView,
  resolveSessionControl,
  resolveStandaloneSessionControl,
  resolveStructure,
  selectModalFeedback,
  serializeState,
  startItemSession,
  type TestScope,
  type TestStructure,
  timeLimits,
  type Value,
  validateAsi,
  writeView,
} from "../src/index.js";
import { readPackageFile } from "../src/node/index.js";
import { exampleItems } from "./corpus-items.js";
import { readFixture, type StateFixture } from "./fixtures.js";

const written = readFixture<StateFixture>("state-1.json");

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
      answer === undefined ? null : buildSingle("identifier", answer),
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
    let at = findNextItem(structure, plan, undefined, rules);
    at !== undefined;
    at = findNextItem(structure, plan, at, rules)
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
        Object.entries(responses).map(([identifier, choice]) => [identifier, buildSingle("identifier", choice)]),
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
  it("turns the failing rules of feedback_adaptive.xml into data, attempt after attempt", () => {
    // Its qti-member has the container first, where the information model wants the single value, and for the correct response
    // it sets the multiple FEEDBACK to a single value, so that every run fails.
    const item = itemAt("packaging/items/feedback_adaptive.xml");
    const context: ItemSessionContext = { item, control: resolveStandaloneSessionControl(), random: createRandom(1) };
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
      expect([
        session.status,
        session.variables.responses.get("numAttempts"),
        deriveSessionStatus(session, item),
      ]).toEqual(["interacting", buildSingle("integer", attempt + 1), "pendingResponseProcessing"]);
      expect([outcomeOf(session, "SCORE"), outcomeOf(session, "completionStatus")]).toEqual([
        buildSingle("float", 0),
        buildSingle("identifier", "unknown"),
      ]);
    }
    expect(details).toEqual([
      member,
      member,
      "The variable FEEDBACK is a multiple identifier and cannot be set to a single identifier.",
      member,
    ]);
  });

  it("gives the hint of hint.xml through its end attempt interaction, and scores the next attempt", () => {
    const item = itemAt("packaging/items/hint.xml");
    const context: ItemSessionContext = { item, control: resolveStandaloneSessionControl(), random: createRandom(1) };
    const hinted = accepted(turn(sessionOf(context), context, {}, "HINTREQUEST"));
    expect([hinted.variables.responses.get("HINTREQUEST"), outcomeOf(hinted, "FEEDBACK")]).toEqual([
      buildSingle("boolean", true),
      buildSingle("identifier", "HINT"),
    ]);
    const answered = accepted(turn(hinted, context, { RESPONSE: "MGH001C" }));
    expect([
      answered.variables.responses.get("HINTREQUEST"),
      outcomeOf(answered, "FEEDBACK"),
      outcomeOf(answered, "SCORE"),
      answered.variables.responses.get("numAttempts"),
      answered.status,
    ]).toEqual([
      buildSingle("boolean", false),
      buildSingle("identifier", "NOHINT"),
      buildSingle("float", 1),
      buildSingle("integer", 2),
      "interacting",
    ]);
  });

  it("plays the Monty Hall game of adaptive.xml to completion: the switch wins and the strategy is asked", () => {
    const item = itemAt("packaging/items/adaptive.xml");
    const context: ItemSessionContext = { item, control: resolveStandaloneSessionControl(), random: createRandom(3) };
    const first = accepted(turn(sessionOf(context), context, { DOOR: "DoorA" }));
    const revealed = outcomeOf(first, "REVEALED");
    if (revealed?.cardinality !== "single") throw new Error("Monty reveals one door.");
    const other = ["DoorB", "DoorC"].find((door) => door !== revealed.value) ?? "";
    expect([outcomeOf(first, "STORY"), outcomeOf(first, "FIRSTDOOR"), outcomeOf(first, "completionStatus")]).toEqual([
      buildSingle("identifier", "tempter"),
      buildSingle("identifier", "DoorA"),
      buildSingle("identifier", "incomplete"),
    ]);
    expect(outcomeOf(first, "CLOSED")).toEqual(buildContainer("multiple", "identifier", ["DoorA", other]));
    const second = accepted(turn(first, context, { DOOR: other }));
    expect([
      outcomeOf(second, "STORY"),
      outcomeOf(second, "PRIZE"),
      outcomeOf(second, "SCORE"),
      outcomeOf(second, "FEEDBACK"),
    ]).toEqual([
      buildSingle("identifier", "prize"),
      buildSingle("identifier", other),
      buildSingle("float", 1),
      buildSingle("identifier", "poser"),
    ]);
    const last = accepted(turn(second, context, { RESPONSE: "switchStrategy" }));
    expect([last.status, outcomeOf(last, "SCORE"), outcomeOf(last, "completionStatus")]).toEqual([
      "closed",
      buildSingle("float", 3),
      buildSingle("identifier", "completed"),
    ]);
    const feedback = deriveItemFeedback(last, item, context.control);
    expect(selectModalFeedback(item, feedback.outcomes).map(({ identifier }) => identifier)).toEqual([
      "switchStrategy",
    ]);
  });
});

describe("the tests of the examples", () => {
  it("plan under many seeds into item instances of their own item references", () => {
    expect(tests.size).toBeGreaterThan(20);
    for (const path of tests.keys()) {
      const structure = structureAt(path);
      for (let seed = 1; seed <= 20; seed++) {
        const plan = planTest(structure, { random: createRandom(seed) });
        const keys = listPlanItems(plan);
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

  it("selects 2 of 3 items with item034 required, and one of two with the block required", () => {
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

  it("keeps item034 first and the block B1 together in its order", () => {
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

  it("presents item160 after the response Y and item063 after N", () => {
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

  it("branches to item656, or leaves section B, by the response to item347", () => {
    const structure = structureAt("tests/rtest13.xml");
    expect(walk(structure, { item034: "Y", item347: "N" })).toEqual(["item034", "item160", "item347", "item656"]);
    // Neither N nor Y: the second rule exits section B, which is the last section.
    expect(walk(structure, { item034: "Y", item347: "X" })).toEqual(["item034", "item160", "item347"]);
  });

  it("presents section SA only for the response A to the switch item (RTEST-COMPLETE)", () => {
    const structure = structureAt("tests/complete.xml");
    expect(walk(structure, { switch: "A" })).toEqual(["switch", "A1"]);
    expect(walk(structure, { switch: "B" })).toEqual(["switch"]);
  });

  it("gives the item session control of the test part to its items (RTEST-COMPLETE)", () => {
    const structure = structureAt("tests/complete.xml");
    const item = structure.itemRef("A1");
    if (item === undefined) throw new Error("No A1.");
    expect(resolveSessionControl(item)).toEqual({
      maxAttempts: 1,
      showFeedback: true,
      allowReview: false,
      showSolution: false,
      allowComment: false,
      allowSkipping: true,
      validateResponses: false,
    });
  });

  it("gives the limits of the test and its part, and adds the extra time of a candidate (RTEST-COMPLETE)", () => {
    const structure = structureAt("tests/complete.xml");
    const part = structure.part("RTEST-COMPLETE-PTI");
    if (part === undefined) throw new Error("No part.");
    expect(timeLimits(structure.test)).toEqual({ minTime: 600, maxTime: 3600, allowLateSubmission: false });
    expect(timeLimits(part)).toEqual({ maxTime: 3600, allowLateSubmission: false });
    expect(timeLimits(structure.test, { extra: { kind: "time-multiplier", multiplier: 1.25 } }).maxTime).toBe(4500);
    expect(timeLimits(structure.test, { extra: { kind: "fixed-minutes", minutes: 15 } }).maxTime).toBe(4500);
    expect(timeLimits(part, { extra: { kind: "fixed-minutes", minutes: 15 } }).maxTime).toBe(3600);
    expect(timeLimits(structure.test, { extra: { kind: "unlimited" } })).toEqual({
      minTime: 600,
      allowLateSubmission: false,
    });
  });
});

/** The engine of a test of a package of the examples, with the item that each item reference names. */
async function deliveryOf(directory: string, path: string) {
  const pkg = await readPackageFile(join(examples, "packaging", directory));
  const document = pkg.document(path);
  if (document.kind !== "test") throw new Error(`${path} is not a test.`);
  const resolvers = createPackageResolvers(pkg);
  const engine = createEngine({ kind: "test", test: document.test, base: path, resolvers });
  const items = new Map<string, AssessmentItem>();
  const structure = resolveStructure(document.test, path, resolvers);
  for (const key of listPlanItems(planTest(structure, { random: createRandom(1) }))) {
    const node = structure.itemRef(key.ref);
    const resolved = node === undefined ? undefined : resolvers.items(node.model.href, node.base).deliverable;
    if (resolved?.kind === "qti") items.set(key.ref, resolved.item);
  }
  return { engine, items };
}

describe("the engine on the examples", () => {
  /** Plays a test to its end: each item presented gets its correct responses, and is submitted in an individual part. */
  function answerAll(engine: Engine, items: ReadonlyMap<string, AssessmentItem>, individual: boolean): DeliveryState {
    const started = engine.start({ seed: 1, at: 0 });
    if (!started.ok) throw new Error(started.refusal.message);
    let { state } = started;
    let at = 0;
    const apply = (action: CandidateAction): void => {
      at += 1000;
      const step = engine.apply(state, { ...action, at });
      if (!step.ok) throw new Error(`${action.type} was refused: ${step.refusal.message}`);
      state = step.state;
      const view = engine.view(state, at);
      expect(readView(JSON.parse(JSON.stringify(writeView(view))))).toEqual(view);
    };
    for (let current = state.current; current !== undefined; current = state.current) {
      const item = items.get(current.ref);
      if (item === undefined) throw new Error(`No item ${current.ref}.`);
      const correct = [...createItemVariables(item).correctResponses].filter(([, value]) => value !== null);
      apply({ type: "set-responses", item: current, responses: new Map(correct) });
      if (individual) apply({ type: "submit", item: current });
      apply({ type: "move", to: "next" });
    }
    return state;
  }

  it("refuses the example tests that the static checks find errors in", async () => {
    await expect(deliveryOf("basicFeedbackTest", "assessment.xml")).rejects.toThrow(
      /assesskit\/validate\/adaptive-simultaneous in assessment\.xml/,
    );
    await expect(deliveryOf("BBQsTest", "assessment.xml")).rejects.toThrow(/assesskit\/validate\/custom-operator/);
  });

  it("scores the correct answers of englishBasicLevelV2, submitted together, at its MAXSCORE", async () => {
    const { engine, items } = await deliveryOf("englishBasicLevelV2", "Test_258641331.xml");
    const state = answerAll(engine, items, false);
    expect(state.status).toBe("ended");
    expect(state.outcomes.get("SCORE")).toEqual(buildSingle("float", 24));
    expect(state.outcomes.get("MAXSCORE")).toEqual(buildSingle("float", 24));
  });

  it("scores the correct answers of interactionMixSaxonyV3, submitted one by one", async () => {
    const { engine, items } = await deliveryOf("interactionMixSaxonyV3", "InteractionMixSachsen_1901710679.xml");
    const state = answerAll(engine, items, true);
    expect(state.status).toBe("ended");
    // Of its MAXSCORE of 18, the 3 points of the item with three text entries come from a mapping, and that item
    // declares no correct response, so the correct responses score 15.
    expect(state.outcomes.get("MAXSCORE")).toEqual(buildSingle("float", 18));
    expect(state.outcomes.get("SCORE")).toEqual(buildSingle("float", 15));
  });

  it("delivers the links to tools of testWithLti as items with the outcomes SCORE and MAXSCORE", async () => {
    const { engine } = await deliveryOf("testWithLti", "assessment.xml");
    const started = engine.start({ seed: 1, at: 0 });
    if (!started.ok) throw new Error(started.refusal.message);
    const ended = engine.apply(started.state, { type: "end-test", at: 1000 });
    if (!ended.ok) throw new Error(ended.refusal.message);
    const link = ended.state.items[0]?.session;
    expect(link?.key).toEqual({ ref: "i853928446", instance: 1 });
    expect([...(link?.variables.outcomes.keys() ?? [])]).toEqual(["completionStatus", "SCORE", "MAXSCORE"]);
    expect(ended.state.outcomes.get("TEST_total")).toEqual(buildSingle("float", 0));
  });

  it("delivers alone every example item that the static checks accept, and plays it without throwing", () => {
    let delivered = 0;
    for (const { path, item } of exampleItems()) {
      const issues = validateAsi({ kind: "item", item }, { customOperators: new Map() });
      if (issues.some((issue) => issue.severity === "error")) continue;
      const engine = createEngine({ kind: "item", item, base: path });
      const started = engine.start({ seed: 1, at: 0 });
      if (!started.ok) throw new Error(`${path}: ${started.refusal.message}`);
      const key = started.state.current;
      if (key === undefined) throw new Error(`${path} presents no item.`);
      const skipped = engine.apply(started.state, { type: "skip", item: key, at: 1 });
      const after = skipped.ok ? skipped.state : started.state;
      const ended = engine.apply(after, { type: "end-test", at: 2 });
      expect(ended.ok && ended.state.status, path).toBe("ended");
      delivered += 1;
    }
    expect(delivered).toBeGreaterThan(40);
  });

  /** The example items that the static checks accept. */
  const accepted = exampleItems().filter(
    ({ item }) =>
      !validateAsi({ kind: "item", item }, { customOperators: new Map() }).some(({ severity }) => severity === "error"),
  );

  /** The names of a view that an answer key would be under. */
  const KeyNames = [
    "correctResponse",
    "mapping",
    "areaMapping",
    "lookupTable",
    "responseProcessing",
    "templateProcessing",
    "outcomeDeclarations",
    "responseDeclarations",
    "templateDeclarations",
    "defaultValue",
  ];

  const namesIn = (value: unknown, names: Set<string>): Set<string> => {
    if (Array.isArray(value)) for (const member of value) namesIn(member, names);
    else if (typeof value === "object" && value !== null) {
      for (const [name, member] of Object.entries(value)) namesIn(member, names.add(name));
    }
    return names;
  };

  it("has more than 40 example items that the static checks accept, to show as views", () => {
    expect(accepted.length).toBeGreaterThan(40);
  });

  it.for(accepted)(
    "shows the example item $path as a view that holds no key and reads back from its JSON text",
    ({ path, item }) => {
      const engine = createEngine({ kind: "item", item, base: path });
      const started = engine.start({ seed: 1, at: 0 });
      if (!started.ok) throw new Error(`${path}: ${started.refusal.message}`);
      const closed = engine.apply(started.state, {
        type: "skip",
        item: started.state.current ?? { ref: "", instance: 1 },
        at: 1,
      });
      for (const state of [started.state, closed.ok ? closed.state : started.state]) {
        const view = engine.view(state, 5);
        const written = writeView(view);
        expect(readView(JSON.parse(JSON.stringify(written))), path).toEqual(view);
        const names = namesIn(written, new Set());
        for (const forbidden of KeyNames) expect(names.has(forbidden), `${path}: ${forbidden}`).toBe(false);
      }
    },
  );
});

// The file holds states that the first release wrote in the format version 1, and is never written again. Every later
// 1.x release reads it, goes on from it, and reaches what a replay from the seed reaches. A change of the meaning of a
// field makes a new format version, which adds a file of its own and keeps this one.
describe("a state that an earlier release wrote", () => {
  const actions: readonly Action[] = written.actions.map(({ at, action }) => ({ ...readCandidateAction(action), at }));

  /** The engine of the test, and the states that replaying the actions from the seed reaches, the first before any. */
  async function replay() {
    const { engine } = await deliveryOf(written.package, written.test);
    const started = engine.start({ seed: written.seed, at: written.at });
    if (!started.ok) throw new Error(started.refusal.message);
    const states = [started.state];
    for (const action of actions) {
      const step = engine.apply(states[states.length - 1] ?? started.state, action);
      if (!step.ok) throw new Error(`${action.type} was refused: ${step.refusal.message}`);
      states.push(step.state);
    }
    return { engine, states };
  }

  it("reads as the replay of its actions reaches it, and is written back as it was", async () => {
    const { states } = await replay();
    const read = deserializeState(written.suspended);
    expect(read.status).toBe("suspended");
    expect(read).toEqual(states[written.suspendedAfter]);
    expect(serializeState(read)).toBe(written.suspended);
    expect(deserializeState(written.ended)).toEqual(states[actions.length]);
  });

  it("goes on, action by action, through the states of the replay to the end of the test", async () => {
    const { engine, states } = await replay();
    let state = deserializeState(written.suspended);
    for (const [index, action] of actions.slice(written.suspendedAfter).entries()) {
      const step = engine.apply(state, action);
      if (!step.ok) throw new Error(`${action.type} was refused: ${step.refusal.message}`);
      state = step.state;
      expect(state).toEqual(states[written.suspendedAfter + index + 1]);
    }
    expect(state.status).toBe("ended");
    expect(engine.results(state)).toEqual(engine.results(deserializeState(written.ended)));
  });
});
