import { checkArray, checkFinite, checkOptions, checkRecord, checkSeed, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import {
  isSupportName,
  type PersonalNeedsProfile,
  PNP_HAZARDS,
  resolveSupports,
  type SupportName,
  type SupportSetting,
} from "../pnp/index.js";
import { givenContext } from "../processing/variables.js";
import { createRandom } from "../random.js";
import type { Value } from "../values/index.js";
import { type Action, checkAction } from "./action.js";
import type { CandidateView } from "./candidate-view.js";
import { buildCourse, type Course, type DeliveryDefinition, type EngineOptions } from "./course.js";
import { type Deadline, deadlinesOf } from "./deadlines.js";
import {
  type CandidateNeeds,
  checkState,
  type DeliveryState,
  type SessionSupport,
  STATE_VERSION,
  type Step,
} from "./delivery-state.js";
import { planTest } from "./plan.js";
import { SessionStep } from "./session-step.js";
import { additionalTestingTime } from "./time-limits.js";
import { candidateView } from "./view.js";

/** The options of `Engine.start`. */
export interface StartOptions {
  /** The seed of the generator of the session: selection, ordering, template values, shuffles (E3). */
  readonly seed: number;
  /** The time the session starts, in epoch milliseconds. */
  readonly at: number;
  /** The candidate's personal needs and preferences: supports, extra time, hazards, translation. Default: none. */
  readonly pnp?: PersonalNeedsProfile;
  /**
   * The supports that the program gives every candidate, as options the candidate turns on, unless the profile says
   * otherwise. Default: none.
   */
  readonly universalSupports?: readonly SupportName[];
  /**
   * The values of context variables, `QTI_CONTEXT` included, by identifier: each is given to the test and to every item
   * that declares it (INFO §2.2.2.1, B50). A variable left out has its default value, else NULL. Default: none.
   */
  readonly context?: ReadonlyMap<string, Value | null>;
}

/**
 * The delivery engine of a test or an item (E1): a pure reducer of states. It reads no clock and does no I/O; each step
 * takes the time it happened, and the host schedules the `time` actions of the deadlines. One engine serves every session
 * of its test.
 */
export interface Engine {
  /**
   * Starts a session: plans it from the seed, and presents the first item, or ends a test that has none.
   *
   * @throws `DataError` when an option has the wrong type, or a context value names no context variable of the test or
   * its items or does not fit one.
   * @throws `SecurityError` when the plan would hold more sections and items than `maxPlanNodes` allows.
   */
  start(options: StartOptions): Step;
  /**
   * Applies an action to a state (E1, E4, E7): the maximum times that passed before it first, each at its time, then
   * the action; a refusal leaves the state as it was. It never throws on a state of this engine: a processing failure
   * is reported as a `processing-failed` event (E26).
   *
   * @throws `DataError` when the state or the action is not one.
   */
  apply(state: DeliveryState, action: Action): Step;
  /**
   * Returns the deadlines of a state (E6): the maximum and minimum times that run, as absolute times. Time runs only
   * while the session is in progress, so a suspended or ended session has none.
   *
   * @throws `DataError` when the state is not one of this engine.
   */
  deadlines(state: DeliveryState): readonly Deadline[];
  /**
   * Returns what the candidate sees of a state at the time `now` (E19–E21): the state after the maximum times that passed
   * up to `now` are applied, as a `time` action applies them, built field by field so that no answer key, processing or
   * hidden content reaches it. A time before the latest step of the state counts as that step.
   *
   * @throws `DataError` when the state is not one of this engine, or `now` is not a finite number.
   */
  view(state: DeliveryState, now: number): CandidateView;
}

/** Returns what the engine takes from a profile besides the supports (BPIG §5.2.4–5). */
function needsOf(profile: PersonalNeedsProfile | undefined): CandidateNeeds {
  if (profile === undefined) return { avoidedHazards: [] };
  const testingTime = additionalTestingTime(profile);
  const hazards = profile.supports.get("hazard-avoidance");
  const avoided = hazards?.name === "hazard-avoidance" ? hazards.hazards : [];
  const avoidedHazards = PNP_HAZARDS.filter((term) => avoided.includes(term));
  const translation = profile.supports.get("item-translation");
  const translated =
    translation?.name === "item-translation" && resolveSupports(profile).get("item-translation") !== "prohibited";
  return {
    ...(testingTime === undefined ? {} : { testingTime }),
    avoidedHazards,
    ...(translated ? { translation: translation.language } : {}),
  };
}

/**
 * Returns the supports of a session (BPIG §5.3): those the profile names, with the state `resolveSupports` gives them,
 * on from the start when they are `active` or `assigned`; and the universal supports the profile does not name, as
 * options.
 */
function supportsOf(
  profile: PersonalNeedsProfile | undefined,
  universal: readonly SupportName[],
): Map<SupportName, SessionSupport> {
  const supports = new Map<SupportName, SessionSupport>();
  const settings = new Map<string, SupportSetting>(profile?.supports);
  for (const [name, state] of profile === undefined ? [] : resolveSupports(profile)) {
    const given = settings.get(name);
    supports.set(name, {
      state,
      active: state === "active" || state === "assigned",
      ...(given === undefined ? {} : { settings: given }),
    });
  }
  for (const name of universal) if (!supports.has(name)) supports.set(name, { state: "option", active: false });
  return supports;
}

/**
 * Checks the context values against every declaration of their variables, in the test and in its items.
 *
 * @throws `DataError` when a value names no context variable or does not fit one of its declarations.
 */
function checkContextValues(course: Course, values: ReadonlyMap<string, Value | null>): void {
  if (!(values instanceof Map)) {
    throw new DataError(`The option context must be a Map from identifier to value, found ${describe(values)}.`);
  }
  for (const [identifier, value] of values) {
    checkString(identifier, "An identifier of the option context");
    const types = course.contextTypes.get(identifier);
    if (types === undefined) {
      throw new DataError(
        `The option context gives ${describe(identifier)}, which neither the test nor its items declare as a context variable.`,
      );
    }
    for (const type of types) givenContext(identifier, value, type);
  }
}

function start(course: Course, options: StartOptions): Step {
  checkOptions(options);
  const { seed, at, pnp, universalSupports = [], context = new Map<string, Value | null>() } = options;
  checkSeed(seed);
  checkFinite(at, "The option at");
  if (pnp !== undefined) checkRecord(pnp, "The option pnp must be an object of the model of a PNP");
  checkArray(universalSupports, "The option universalSupports must be an array of support names");
  for (const name of universalSupports) {
    if (!isSupportName(name))
      throw new DataError(`A universal support must be a support name, found ${describe(name)}.`);
  }
  checkContextValues(course, context);
  const random = createRandom(seed);
  const { structure, limits } = course;
  const plan = planTest(structure, { random, limits });
  const state: DeliveryState = {
    version: STATE_VERSION,
    status: "in-progress",
    at,
    random: random.state(),
    plan,
    items: [],
    outcomes: course.outcomes,
    context: new Map(context),
    clocks: [{ scope: "test", identifier: structure.test.model.identifier, spent: 0 }],
    supports: supportsOf(pnp, universalSupports),
    needs: needsOf(pnp),
  };
  const step = new SessionStep(course, state);
  const refused = step.begin(at);
  return refused === undefined ? step.done() : { ok: false, refusal: refused };
}

/**
 * Creates the delivery engine of a test, or of an item delivered alone for practice (E12). It first runs the static
 * checks over everything a session can reach, as `validateTest` or `validateAsi` runs them with the custom operators
 * and the resolver of templates given, and refuses content with an error, so that no session fails on it (E26); then it
 * resolves the section references and every item reference with its variants. An item delivered alone is a test of
 * one nonlinear test part with individual submission, whose item session control is `standaloneSessionControl` of
 * the control given.
 *
 * @param definition - What to deliver; see {@link DeliveryDefinition}.
 * @param options - See {@link EngineOptions}.
 * @throws `DataError` when an argument has the wrong type, or the static checks find an error; the message lists them.
 * @throws `ReadError` from a resolver, when a reference cannot be resolved.
 */
export function createEngine(definition: DeliveryDefinition, options: EngineOptions = {}): Engine {
  const course = buildCourse(definition, options);
  return {
    start: (startOptions) => start(course, startOptions),
    apply: (state, action) => {
      checkState(state);
      checkAction(action);
      const step = new SessionStep(course, state);
      const refused = step.apply(action);
      return refused === undefined ? step.done() : { ok: false, refusal: refused };
    },
    deadlines: (state) => {
      checkState(state);
      return deadlinesOf(course, state);
    },
    view: (state, now) => {
      checkState(state);
      checkFinite(now, "The time now");
      return candidateView(course, state, now);
    },
  };
}
