import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { type AssessmentItem, type AssessmentTest, readAsi } from "../src/asi/index.js";
import {
  type Action,
  type ContentNode,
  createEngine,
  type DeliveryState,
  type Engine,
  readItemVariables,
  readTestInputs,
  resolveStructure,
  type TestStructure,
} from "../src/delivery/index.js";
import { DataError, ReadError } from "../src/errors.js";
import { createRandom } from "../src/index.js";
import { readPackageFile } from "../src/node/index.js";
import { createPackageResolvers, type Resolvers } from "../src/package/index.js";
import { type ItemVariables, runOutcomeProcessing, runResponseProcessing } from "../src/processing/index.js";
import type { Value } from "../src/values/index.js";

const examples = join(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");

/** The seeds of the simulated candidates. */
const SEEDS = [1, 2, 3, 4, 5, 6];

/** The most actions a simulated candidate takes. */
const MOST_ACTIONS = 80;

/** The time that a simulated candidate lets pass before the deadlines are applied, in milliseconds: an hour. */
const TIME_OUT = 3_600_000;

/** Whether a model uses `qti-random`, `qti-random-integer` or `qti-random-float`, whose draws a report does not hold. */
const usesRandom = (model: unknown): boolean => JSON.stringify(model ?? null).includes('"kind":"random');

/** An item with one response variable, which stands in for the items that the tests of the examples name. */
const STAND_IN: AssessmentItem = (() => {
  const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="stand-in" title="Stand-in" time-dependent="false">
    <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
    <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
    <qti-item-body/>
  </qti-assessment-item>`);
  if (document.kind !== "item") throw new Error("Expected an item.");
  return document.item;
})();

/** A test of the examples with what delivering it needs. */
interface Delivered {
  readonly name: string;
  readonly test: AssessmentTest;
  readonly base: string;
  readonly resolvers: Resolvers;
}

/** The item reference nodes of a structure. */
function itemRefs(structure: TestStructure): readonly string[] {
  const found: string[] = [];
  const visit = (nodes: readonly ContentNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "item-ref") found.push(node.model.identifier);
      else visit(node.children);
    }
  };
  for (const part of structure.test.parts) visit(part.sections);
  return found;
}

/** The tests of the examples that stand alone: those of `tests/`, with a stand-in item, and those of the packages. */
async function deliverable(): Promise<readonly Delivered[]> {
  const found: Delivered[] = [];
  const standIn: Resolvers = {
    items: (href) => ({ resource: href, deliverable: { kind: "qti", item: STAND_IN }, hazards: [], variants: [] }),
    sections: () => {
      throw new ReadError("The tests of the examples have no section references.", []);
    },
    stimuli: () => {
      throw new ReadError("The tests of the examples have no stimuli.", []);
    },
  };
  for (const file of readdirSync(join(examples, "tests")).filter((name) => name.endsWith(".xml"))) {
    try {
      const document = readAsi(readFileSync(join(examples, "tests", file), "utf8"), { path: file });
      if (document.kind === "test") {
        found.push({ name: `tests/${file}`, test: document.test, base: file, resolvers: standIn });
      }
    } catch (error) {
      if (!(error instanceof ReadError)) throw error;
    }
  }
  for (const directory of readdirSync(join(examples, "packaging"))) {
    const pkg = await readPackageFile(join(examples, "packaging", directory)).catch((error: unknown) => {
      if (error instanceof ReadError) return undefined;
      throw error;
    });
    if (pkg === undefined) continue;
    for (const path of pkg.paths.filter((each) => each.endsWith(".xml"))) {
      try {
        const document = pkg.document(path);
        if (document.kind === "test") {
          found.push({
            name: `${directory}/${path}`,
            test: document.test,
            base: path,
            resolvers: createPackageResolvers(pkg),
          });
        }
      } catch (error) {
        if (!(error instanceof ReadError)) throw error;
      }
    }
  }
  return found;
}

/** What a simulated candidate did, and whether the engine could process everything. */
interface Sitting {
  readonly state: DeliveryState;
  /** Whether the engine recorded a failure of processing, in which case a rescoring would throw the same. */
  readonly failed: boolean;
}

/**
 * A simulated candidate: it answers the item shown with its correct responses or with none, submits, skips, moves on,
 * ends a part or the test, or lets an hour pass so that the time limits run out. The random draws come from the seed.
 */
function sit(engine: Engine, seed: number): Sitting {
  const random = createRandom(seed);
  const started = engine.start({ seed, at: 0 });
  if (!started.ok) throw new Error(started.refusal.message);
  let state = started.state;
  let failed = false;
  let at = 0;
  const apply = (action: (time: number) => Action): void => {
    at += 1 + Math.floor(random.uniform() * 30_000);
    const step = engine.apply(state, action(at));
    if (!step.ok) return;
    state = step.state;
    failed ||= step.events.some((event) => event.type === "processing-failed");
  };
  for (let turn = 0; turn < MOST_ACTIONS && state.status !== "ended"; turn += 1) {
    const current = state.current;
    if (current === undefined) break;
    const delivered = state.items.find(
      ({ session }) => session.key.ref === current.ref && session.key.instance === current.instance,
    );
    const draw = random.uniform();
    if (draw < 0.7) {
      const keys = [...(delivered?.session.variables.correctResponses ?? [])].filter(
        (entry): entry is [string, Value] => entry[1] !== null,
      );
      const responses = new Map(random.uniform() < 0.6 ? keys : []);
      apply((time) => ({ type: "set-responses", item: current, responses, at: time }));
      apply((time) => ({ type: "submit", item: current, at: time }));
    } else if (draw < 0.8) {
      apply((time) => ({ type: "skip", item: current, at: time }));
    }
    const move = random.uniform();
    if (move < 0.05) apply((time) => ({ type: "end-part", at: time }));
    else if (move < 0.08) apply((time) => ({ type: "end-test", at: time }));
    else if (move < 0.13) {
      at += TIME_OUT;
      apply((time) => ({ type: "time", at: time }));
    } else apply((time) => ({ type: "move", to: "next", at: time }));
  }
  if (state.status !== "ended" && random.uniform() < 0.5) apply((time) => ({ type: "end-test", at: time }));
  return { state, failed };
}

/** The outcomes of the recipe of `docs/runtime/delivery.md`, with every item corrected that can be. */
function rescored(
  structure: TestStructure,
  report: ReturnType<Engine["results"]>,
  items: ReadonlyMap<string, AssessmentItem>,
): ReadonlyMap<string, Value | null> {
  const context = { random: createRandom(1) };
  const variables = new Map<number, ItemVariables>();
  report.itemResults.forEach((result, position) => {
    const item = items.get(result.identifier);
    if (item === undefined || item.adaptive === true || usesRandom(item.responseProcessing)) return;
    if (result.sessionStatus === "initial" || result.sessionStatus === "pendingSubmission") return;
    variables.set(position, runResponseProcessing(item, readItemVariables(item, result), context));
  });
  const inputs = readTestInputs(structure, report, items, { variables });
  return runOutcomeProcessing(structure.test.model, inputs.outcomes, inputs.scope, context);
}

describe("rescoring a report of the examples", () => {
  it("gives the outcomes of the engine for simulated candidates of every test that stands alone", async () => {
    let compared = 0;
    for (const delivered of await deliverable()) {
      if (usesRandom(delivered.test.outcomeProcessing)) continue;
      let engine: Engine;
      let structure: TestStructure;
      const items = new Map<string, AssessmentItem>();
      try {
        engine = createEngine({
          kind: "test",
          test: delivered.test,
          base: delivered.base,
          resolvers: delivered.resolvers,
        });
        structure = resolveStructure(delivered.test, delivered.base, delivered.resolvers);
        for (const ref of itemRefs(structure)) {
          const node = structure.itemRef(ref);
          const resolved =
            node === undefined ? undefined : delivered.resolvers.items(node.model.href, node.base).deliverable;
          if (resolved?.kind !== "qti") throw new ReadError("The test names a link to a tool.", []);
          items.set(ref, resolved.item);
        }
      } catch (error) {
        const refused = error instanceof DataError && error.message.startsWith("The test cannot be delivered");
        if (!refused && !(error instanceof ReadError)) throw error;
        continue;
      }
      for (const seed of SEEDS) {
        const { state, failed } = sit(engine, seed);
        if (failed) continue;
        expect(rescored(structure, engine.results(state), items), `${delivered.name} with the seed ${seed}`).toEqual(
          state.outcomes,
        );
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(SEEDS.length * 20);
  });
});
