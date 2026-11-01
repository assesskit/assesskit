import { checkArray, checkFinite, checkOptions, checkRecord, checkSeed, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import {
  isSupportName,
  type PersonalNeedsProfile,
  PNP_HAZARDS,
  resolveSupports,
  type SupportName,
  type SupportSetting,
  writePnp,
} from "../pnp/index.js";
import { givenContext } from "../processing/internal.js";
import { createRandom } from "../random.js";
import type { AssessmentResult, ResultContext } from "../results/index.js";
import { encodeBase64, type Value } from "../values/index.js";
import { type Action, checkAction } from "./action.js";
import type { CandidateView } from "./candidate-view.js";
import { buildCourse, type Course, type DeliveryDefinition, type EngineOptions } from "./course.js";
import { checkInstant } from "./datestamp.js";
import { type Deadline, deadlinesOf } from "./deadlines.js";
import {
  type CandidateNeeds,
  checkState,
  type DeliveryState,
  type SessionSupport,
  STATE_VERSION,
  type Step,
} from "./delivery-state.js";
import { type PendingWork, pendingWork } from "./pending-work.js";
import { planTest } from "./plan.js";
import { assembleResults } from "./results-assembly.js";
import { type ScorerView, scorerViewOf } from "./scorer-view.js";
import { SessionStep } from "./session-step.js";
import { additionalTestingTime } from "./time-limits.js";
import { candidateView } from "./view.js";

/** The options of `Engine.start`. */
export interface StartOptions {
  /** The seed of the generator of the session: selection, ordering, template values, shuffles. */
  readonly seed: number;
  /** The time the session starts, in epoch milliseconds. */
  readonly at: number;
  /**
   * The candidate's personal needs and preferences: supports, extra time, hazards, translation.
   *
   * @defaultValue none
   */
  readonly pnp?: PersonalNeedsProfile;
  /**
   * The supports that the program gives every candidate, as options the candidate turns on, unless the profile says
   * otherwise.
   *
   * @defaultValue none
   */
  readonly universalSupports?: readonly SupportName[];
  /**
   * The values of context variables, `QTI_CONTEXT` included, by identifier: each is given to the test and to every item
   * that declares it. A variable left out has its default value, else NULL.
   *
   * @defaultValue none
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  readonly context?: ReadonlyMap<string, Value | null>;
  /**
   * Who took the test, for the `context` of the results report: the `sourcedId` of the candidate and the sessions of
   * the delivery system.
   *
   * @defaultValue `{ sessionIdentifiers: [] }`
   * @see
   * {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
   */
  readonly resultContext?: ResultContext;
}

/**
 * The delivery engine of a test or an item: a pure reducer of states.
 *
 * @remarks
 * It reads no clock and does no I/O; each step takes the time it happened, and the host schedules the `time` actions of
 * the deadlines. One engine serves every session of its test.
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
   * Applies an action to a state: the maximum times that passed before it first, each at its time, then the action; a
   * refusal leaves the state as it was.
   *
   * @remarks
   * It never throws on a state of this engine: a processing failure is reported as a `processing-failed` event. The
   * host's `supply-scores` and `cat-response` are accepted in any state, also when the session is suspended or has
   * ended, as long as the request they answer exists.
   *
   * @throws `DataError` when the state or the action is not one, or the state started on another content version than
   * the engine's.
   */
  apply(state: DeliveryState, action: Action): Step;
  /**
   * Returns the deadlines of a state: the maximum and minimum times that run, as absolute times.
   *
   * @remarks
   * Time runs only while the session is in progress, so a suspended or ended session has none.
   *
   * @throws `DataError` when the state is not one of this engine.
   */
  deadlines(state: DeliveryState): readonly Deadline[];
  /**
   * Returns what the candidate sees of a state at the time `now`: the state after the maximum times that passed up to
   * `now` are applied, as a `time` action applies them, built field by field so that no answer key, processing or
   * hidden content reaches it.
   *
   * @remarks
   * A time before the latest step of the state counts as that step.
   *
   * @throws `DataError` when the state is not one of this engine, or `now` is not a finite number.
   */
  view(state: DeliveryState, now: number): CandidateView;
  /**
   * Returns what the engine waits on the host for: the scoring requests with no value yet, and the requests to CAT
   * engines.
   *
   * @remarks
   * The host answers the first with `supply-scores` actions and the second with `cat-response` actions, or has
   * `drainCat` answer them.
   *
   * @throws `DataError` when the state is not one of this engine.
   */
  pending(state: DeliveryState): PendingWork;
  /**
   * Returns what a scorer needs to rate the outcome of a scoring request, including the correct responses, so that it
   * belongs on the server.
   *
   * @throws `DataError` when the state is not one of this engine, or has no such request.
   */
  scorerView(state: DeliveryState, requestId: string): ScorerView;
  /**
   * Assembles the results report of a state: the context, the result of the test and one result for each item instance
   * presented, with the datestamps of the actions.
   *
   * @remarks
   * It is provisional while scoring requests are pending. A report has no single datestamp of its own: the result of
   * the test carries the time of the latest step.
   *
   * @throws `DataError` when the state is not one of this engine.
   */
  results(state: DeliveryState): AssessmentResult;
}

/**
 * Returns the profile as the Create Session request carries it: the document `writePnp` writes, as UTF-8 in base64. A
 * test without an adaptive section sends no request, so nothing is encoded for it.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
function personalNeedsOf(course: Course, profile: PersonalNeedsProfile | undefined): string | undefined {
  if (profile === undefined || course.catSections.size === 0) return undefined;
  return encodeBase64(new TextEncoder().encode(writePnp(profile)));
}

/**
 * Returns what the engine takes from a profile besides the supports.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
function needsOf(profile: PersonalNeedsProfile | undefined, personalNeeds: string | undefined): CandidateNeeds {
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
    ...(personalNeeds === undefined ? {} : { personalNeeds }),
  };
}

/**
 * Checks the context of the results and returns a copy of it.
 *
 * @throws `DataError` when it is not an object with an array of session identifiers and an optional `sourcedId`.
 */
function checkedResultContext(context: ResultContext): ResultContext {
  checkRecord(context, "The option resultContext must be an object with the array sessionIdentifiers");
  const { sourcedId, sessionIdentifiers } = context;
  if (sourcedId !== undefined) checkString(sourcedId, "The sourcedId of the option resultContext");
  checkArray(sessionIdentifiers, "The sessionIdentifiers of the option resultContext must be an array");
  return {
    ...(sourcedId === undefined ? {} : { sourcedId }),
    sessionIdentifiers: sessionIdentifiers.map((each) => {
      checkRecord(each, "A session identifier of the option resultContext must be an object");
      checkString(each.sourceId, "The sourceId of a session identifier of the option resultContext");
      checkString(each.identifier, "The identifier of a session identifier of the option resultContext");
      return { sourceId: each.sourceId, identifier: each.identifier };
    }),
  };
}

/**
 * Returns the supports of a session: those the profile names, with the state `resolveSupports` gives them, on from the
 * start when they are `active` or `assigned`; and the universal supports the profile does not name, as options.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
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
  for (const name of universal) {
    if (!supports.has(name)) supports.set(name, { state: "option", active: false, universal: true });
  }
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

/**
 * Checks a state, and that the content version of the engine, when it names one, is the one the state started on. A
 * state that names none passes, as it started before the option existed or on an engine that named none.
 *
 * @throws `DataError` when the state is not one, or another content version started it.
 */
function checkEngineState(course: Course, state: DeliveryState): void {
  checkState(state);
  const { contentVersion } = course;
  if (contentVersion === undefined || state.contentVersion === undefined || state.contentVersion === contentVersion) {
    return;
  }
  throw new DataError(
    `The state started on the content version ${describe(state.contentVersion)}, and this engine delivers the content version ${describe(contentVersion)}. Apply the state on the engine of its version.`,
  );
}

function start(course: Course, options: StartOptions): Step {
  checkOptions(options);
  const {
    seed,
    at,
    pnp,
    universalSupports = [],
    context = new Map<string, Value | null>(),
    resultContext = { sessionIdentifiers: [] },
  } = options;
  checkSeed(seed);
  checkInstant(at, "The option at");
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
    ...(course.contentVersion === undefined ? {} : { contentVersion: course.contentVersion }),
    status: "in-progress",
    at,
    random: random.state(),
    plan,
    items: [],
    outcomes: course.outcomes,
    context: new Map(context),
    clocks: [{ scope: "test", identifier: structure.test.model.identifier, spent: 0 }],
    supports: supportsOf(pnp, universalSupports),
    needs: needsOf(pnp, personalNeedsOf(course, pnp)),
    scoring: [],
    cat: [],
    report: checkedResultContext(resultContext),
  };
  const step = new SessionStep(course, state);
  const refused = step.begin(at);
  return refused === undefined ? step.done() : { ok: false, refusal: refused };
}

/**
 * Creates the delivery engine of a test, or of an item delivered alone for practice.
 *
 * @remarks
 * It first runs the static checks over everything a session can reach, as `validateTest` or `validateAsi` runs them
 * with the custom operators and the resolver of templates given, and refuses content with an error, so that no session
 * fails on it; then it resolves the section references and every item reference with its variants. An item delivered
 * alone is a test of one nonlinear test part with individual submission, whose item session control is
 * `standaloneSessionControl` of the control given.
 *
 * @param definition - What to deliver; see {@link DeliveryDefinition}.
 * @param options - See {@link EngineOptions}.
 * @returns The engine.
 * @throws `DataError` when an argument has the wrong type, the static checks find an error (the message lists them), or
 * a resolver returns a promise.
 * @throws `ReadError` from a resolver, when a reference cannot be resolved.
 */
export function createEngine(definition: DeliveryDefinition, options: EngineOptions = {}): Engine {
  const course = buildCourse(definition, options);
  return {
    start: (startOptions) => start(course, startOptions),
    apply: (state, action) => {
      checkEngineState(course, state);
      checkAction(action);
      const step = new SessionStep(course, state);
      const refused = step.apply(action);
      return refused === undefined ? step.done() : { ok: false, refusal: refused };
    },
    deadlines: (state) => {
      checkEngineState(course, state);
      return deadlinesOf(course, state);
    },
    view: (state, now) => {
      checkEngineState(course, state);
      checkFinite(now, "The time now");
      return candidateView(course, state, now);
    },
    pending: (state) => {
      checkEngineState(course, state);
      return pendingWork(course, state);
    },
    scorerView: (state, requestId) => {
      checkEngineState(course, state);
      checkString(requestId, "The request");
      return scorerViewOf(course, state, requestId);
    },
    results: (state) => {
      checkEngineState(course, state);
      return assembleResults(course, state);
    },
  };
}
