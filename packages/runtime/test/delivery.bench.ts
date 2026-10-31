import { expect, test } from "vitest";
import {
  type Action,
  type DeliveryState,
  deserializeState,
  type Engine,
  type ItemKey,
  serializeState,
  single,
} from "../src/index.js";
import { BENCH_OPTIONS, BUDGETS, expectWithin } from "./budgets.js";
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

/** The sections of the large test, and the items that each selects of those it lists. */
const SECTIONS = 100;
const LISTED = 10;
const SELECTED = 8;
/** The items of the replayed session: four actions each make 1,000 actions. */
const REPLAYED_ITEMS = 250;
const ACTIONS_PER_ITEM = 4;
/** The items of the session whose state is measured. */
const MEASURED_ITEMS = 100;

/**
 * An engine of a linear test part with individual submission: `sections` sections that list `listed` items each, shuffle
 * them and keep `selected` of them, and outcome processing that sums `SCORE` of every section into `S<n>` and of the
 * test into `TOTAL`. Each rule reads the item sessions of its section, so the cost of an outcome processing is the rules
 * times the instances of the plan.
 */
function sectioned(sections: number, listed: number, selected = listed): Engine {
  const ids = Array.from({ length: sections }, (_, index) => index);
  const body = ids.map((id) =>
    section(
      `sec${id}`,
      `<qti-selection select="${selected}"/><qti-ordering shuffle="true"/>${refs(...Array.from({ length: listed }, (_, item) => `s${id}i${item}`))}`,
    ),
  );
  const rules = ids.map((id) =>
    setOutcome(
      `S${id}`,
      `<qti-sum><qti-test-variables variable-identifier="SCORE" section-identifier="sec${id}"/></qti-sum>`,
    ),
  );
  return engineOf(
    outcome("TOTAL", "float") +
      ids.map((id) => outcome(`S${id}`, "float")).join("") +
      part("P", body.join("")) +
      processing(...rules, setOutcome("TOTAL", SUM_SCORES)),
  );
}

/** The item presented. */
const presented = (state: DeliveryState): ItemKey => state.current ?? fail("The session presents no item.");

/**
 * Answers the items presented, one after the other: a wrong choice, the right one, the submission and the move to the
 * next item. Returns the actions, each at the next millisecond, and the state they lead to.
 */
function answered(engine: Engine, from: DeliveryState, items: number): { log: Action[]; state: DeliveryState } {
  const log: Action[] = [];
  let state = from;
  let at = state.at;
  for (let count = 0; count < items; count++) {
    const { ref, instance } = presented(state);
    const actions = [
      pick(ref, "A", ++at, instance),
      pick(ref, "B", ++at, instance),
      act("submit", ref, ++at, instance),
      next(++at),
    ];
    log.push(...actions);
    state = played(engine, state, ...actions).state;
  }
  return { log, state };
}

test("plans a test of 100 sections, and runs its outcome processing after a submission", async ({
  annotate,
  bench,
}) => {
  const engine = sectioned(SECTIONS, LISTED, SELECTED);
  const options = { seed: 1, at: 0 };
  const first = begun(engine, options).state;
  expect(first.plan.parts.flatMap((each) => each.children)).toHaveLength(SECTIONS);

  // Halfway through the session, so that the state holds the sessions of the items delivered, which a step reads.
  const done = (SECTIONS * SELECTED) / 2;
  const halfway = answered(engine, first, done).state;
  const { ref, instance } = presented(halfway);
  const drafted = played(engine, halfway, pick(ref, "B", halfway.at + 1, instance)).state;
  const submission = act("submit", ref, drafted.at + 1, instance);
  const submitted = engine.apply(drafted, submission);
  if (!submitted.ok) fail(`The submission was refused: ${submitted.refusal.code}.`);
  // One point for each item answered rightly, the one submitted included.
  expect(submitted.state.outcomes.get("TOTAL")).toEqual(single("float", done + 1));
  expect(submitted.events.map((event) => event.type)).toContain("outcome-processed");

  const planned = await bench("start", () => engine.start(options)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "start", planned, BUDGETS.planStart);
  const processed = await bench("submit with outcome processing", () => engine.apply(drafted, submission)).run(
    BENCH_OPTIONS,
  );
  await expectWithin(annotate, "submit with outcome processing", processed, BUDGETS.outcomeSubmit);
});

test("replays 1,000 actions from a stored state to the state that they gave", async ({ annotate, bench }) => {
  const engine = sectioned(10, REPLAYED_ITEMS / 10);
  const first = begun(engine).state;
  const { log, state: last } = answered(engine, first, REPLAYED_ITEMS);
  expect(log).toHaveLength(REPLAYED_ITEMS * ACTIONS_PER_ITEM);
  expect(last.status).toBe("ended");

  const stored = serializeState(first);
  const replay = (): DeliveryState => {
    let state = deserializeState(stored);
    for (const action of log) {
      const step = engine.apply(state, action);
      if (!step.ok) fail(`The action ${action.type} at ${action.at} was refused: ${step.refusal.code}.`);
      state = step.state;
    }
    return state;
  };
  // E3: the replay of the actions from the stored state gives the state that the session had.
  expect(serializeState(replay())).toBe(serializeState(last));

  const result = await bench("replay", replay).run(BENCH_OPTIONS);
  await expectWithin(annotate, "replay", result, BUDGETS.replay);
});

test("keeps the state of a session of 100 items small", async ({ annotate, bench }) => {
  const engine = sectioned(10, MEASURED_ITEMS / 10);
  const first = begun(engine).state;
  const last = answered(engine, first, MEASURED_ITEMS).state;
  const stored = serializeState(last);
  const bytes = new TextEncoder().encode(stored).length;
  const initial = new TextEncoder().encode(serializeState(first)).length;
  await annotate(
    `The state of ${MEASURED_ITEMS} items has ${initial} bytes at the start and ${bytes} bytes at the end.`,
  );
  expect(bytes, `The size in bytes of the state of ${MEASURED_ITEMS} items`).toBeLessThan(BUDGETS.stateBytes);

  const result = await bench("serialize and deserialize", () => deserializeState(serializeState(last))).run(
    BENCH_OPTIONS,
  );
  await expectWithin(annotate, "serialize and deserialize", result, BUDGETS.stateRoundTrip);
});
