import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AssessmentItem,
  type CandidateAction,
  createEngine,
  createItemVariables,
  type DeliveryState,
  type Engine,
  packageResolvers,
  readResults,
  single,
  validateAsi,
  writeResults,
} from "../src/index.js";
import { readPackageFile } from "../src/node/index.js";
import { EXAMPLES, exampleItems } from "./corpus-items.js";

const packages = join(EXAMPLES, "packaging");

/** The engine of a test of an example package, with the items of its item references. */
async function deliveryOf(directory: string, path: string) {
  const pkg = await readPackageFile(join(packages, directory));
  const document = pkg.document(path);
  if (document.kind !== "test") throw new Error(`${path} is not a test.`);
  const resolvers = packageResolvers(pkg);
  const engine = createEngine({ kind: "test", test: document.test, base: path, resolvers });
  return { engine, resolvers, test: document.test };
}

/** Plays a test to its end with the correct responses, each item submitted when `individual`. */
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

/** The items of the item references of a test, by identifier. */
async function itemsOf(directory: string, path: string): Promise<ReadonlyMap<string, AssessmentItem>> {
  const { resolvers, test } = await deliveryOf(directory, path);
  const items = new Map<string, AssessmentItem>();
  const visit = (
    children: readonly { kind: string; identifier?: string; href?: string; children?: unknown[] }[],
  ): void => {
    for (const child of children) {
      if (child.kind === "assessment-item-ref" && child.href !== undefined && child.identifier !== undefined) {
        const resolved = resolvers.items(child.href, path).deliverable;
        if (resolved.kind === "qti") items.set(child.identifier, resolved.item);
      } else if (child.children !== undefined) visit(child.children as never);
    }
  };
  for (const testPart of test.testParts) visit(testPart.sections as never);
  return items;
}

describe("the pending work of the examples", () => {
  it("[E24][R][C] reports a finished session of englishBasicLevelV2, an item result for each item, and reads the report back", async () => {
    const { engine } = await deliveryOf("englishBasicLevelV2", "Test_258641331.xml");
    const items = await itemsOf("englishBasicLevelV2", "Test_258641331.xml");
    const state = answerAll(engine, items, false);
    const results = engine.results(state);
    // The test selects among its item references: an item result for each instance presented, from 1 on (INFO §5.98).
    expect(state.items.length).toBeGreaterThan(0);
    expect(results.itemResults.map(({ sequenceIndex }) => sequenceIndex)).toEqual(
      Array.from({ length: state.items.length }, (_, place) => place + 1),
    );
    expect(results.itemResults.every(({ sessionStatus }) => sessionStatus === "final")).toBe(true);
    const outcome = (name: string) => results.testResult?.variables.find(({ identifier }) => identifier === name);
    expect(outcome("SCORE")).toMatchObject({ kind: "outcome", value: single("float", 24) });
    expect(readResults(writeResults(results))).toEqual(results);
  });

  it("[E24][R][C] reports interactionMixSaxonyV3 submitted one by one, with the datestamp of each submission", async () => {
    const { engine } = await deliveryOf("interactionMixSaxonyV3", "InteractionMixSachsen_1901710679.xml");
    const items = await itemsOf("interactionMixSaxonyV3", "InteractionMixSachsen_1901710679.xml");
    const state = answerAll(engine, items, true);
    const results = engine.results(state);
    const stamps = results.itemResults.map(({ datestamp }) => Date.parse(datestamp));
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(new Set(stamps).size).toBe(stamps.length);
    expect(readResults(writeResults(results))).toEqual(results);
  });

  it("[E25][E13][E15][C] asks the tool of each link of testWithLti for SCORE and MAXSCORE, and sums the scores it supplies", async () => {
    const { engine } = await deliveryOf("testWithLti", "assessment.xml");
    const started = engine.start({ seed: 1, at: 0 });
    if (!started.ok) throw new Error(started.refusal.message);
    // The part is nonlinear: the candidate visits the second link, then ends the part, which closes both sessions.
    const visited = engine.apply(started.state, { type: "move", to: { ref: "i09f742081", instance: 1 }, at: 500 });
    if (!visited.ok) throw new Error(visited.refusal.message);
    const ended = engine.apply(visited.state, { type: "end-part", at: 1000 });
    if (!ended.ok) throw new Error(ended.refusal.message);
    const requests = engine.pending(ended.state).scoring;
    expect(requests.map(({ id, lti }) => [id, lti])).toEqual([
      ["item:i853928446:1:SCORE", true],
      ["item:i853928446:1:MAXSCORE", true],
      ["item:i09f742081:1:SCORE", true],
      ["item:i09f742081:1:MAXSCORE", true],
    ]);
    let state = ended.state;
    let at = 1000;
    for (const request of requests) {
      at += 1;
      const value = request.outcome === "SCORE" ? 3 : 5;
      const step = engine.apply(state, {
        type: "supply-scores",
        request: request.id,
        value: single("float", value),
        scorer: "externalMachine",
        at,
      });
      if (!step.ok) throw new Error(step.refusal.message);
      state = step.state;
    }
    expect(state.outcomes.get("TEST_total")).toEqual(single("float", 6));
    expect(engine.pending(state)).toEqual({ scoring: [], cat: [] });
    const results = engine.results(state);
    expect(results.itemResults.map(({ identifier, sessionStatus }) => [identifier, sessionStatus])).toEqual([
      ["i853928446", "final"],
      ["i09f742081", "final"],
    ]);
    expect(readResults(writeResults(results))).toEqual(results);
  });

  it("[B61][E13][E14][E15][C] asks for the score of the essay of essay.xml, with the exact text, and the scorer sees the rubric", () => {
    const example = exampleItems().find(({ path }) => path === "packaging/items/essay.xml");
    if (example === undefined) throw new Error("The examples have no essay.xml.");
    const engine = createEngine({ kind: "item", item: example.item, base: example.path });
    const started = engine.start({ seed: 1, at: 0 });
    if (!started.ok || started.state.current === undefined) throw new Error("The start was refused.");
    const item = started.state.current;
    const answered = engine.apply(started.state, {
      type: "set-responses",
      item,
      responses: new Map([["RESPONSE", single("string", "Line one\nLine two")]]),
      at: 1,
    });
    if (!answered.ok) throw new Error(answered.refusal.message);
    const submitted = engine.apply(answered.state, { type: "submit", item, at: 2 });
    if (!submitted.ok) throw new Error(submitted.refusal.message);
    const [request] = engine.pending(submitted.state).scoring;
    expect(request).toMatchObject({ scope: "item", outcome: "SCORE", mode: "human" });
    expect(request?.covers.map(({ response }) => response)).toEqual([single("string", "Line one\nLine two")]);
    expect(engine.results(submitted.state).itemResults[0]?.sessionStatus).toBe("pendingExternalScoring");
    const view = engine.scorerView(submitted.state, request?.id ?? "");
    expect(view.items.map(({ responses }) => [...responses.values()])).toEqual([
      [single("string", "Line one\nLine two")],
    ]);
  });

  it("[E24][R][C] reports every example item that is delivered alone, and the report reads back", () => {
    let reported = 0;
    for (const { path, item } of exampleItems()) {
      const issues = validateAsi({ kind: "item", item }, { customOperators: new Map() });
      if (issues.some((issue) => issue.severity === "error")) continue;
      const engine = createEngine({ kind: "item", item, base: path });
      const started = engine.start({ seed: 1, at: 0 });
      if (!started.ok || started.state.current === undefined) throw new Error(`${path}: the start was refused.`);
      const skipped = engine.apply(started.state, { type: "skip", item: started.state.current, at: 1 });
      const state = skipped.ok ? skipped.state : started.state;
      const results = engine.results(state);
      expect(readResults(writeResults(results)), path).toEqual(results);
      expect(results.itemResults, path).toHaveLength(1);
      reported += 1;
    }
    expect(reported).toBeGreaterThan(40);
  });
});
