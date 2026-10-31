import type { AssessmentItem } from "../asi/index.js";
import { describe } from "../checks.js";
import { AssesskitError, DataError } from "../errors.js";
import type { SupportName } from "../pnp/index.js";
import { assign, describeType } from "../processing/assign.js";
import { evaluateTestExpression, type ProcessingContext, runOutcomeProcessing } from "../processing/index.js";
import { restoreRandom, type SeededRandom } from "../random.js";
import { normalizeValue, type Value } from "../values/index.js";
import type { Action, HostAction } from "./action.js";
import { MILLISECONDS_PER_SECOND } from "./attempt.js";
import { answerCat, type CatChange, leaveCat, startCat, submitDue } from "./cat-flow.js";
import { type CatSession, catTestOutcomes, findCat, partOfSection, sectionKeys, withCat } from "./cat-session.js";
import { type Course, type CourseItem, candidateOf, itemContextValues } from "./course.js";
import { expiriesOf, maximumAt, type RunningScope, runningScopes } from "./deadlines.js";
import {
  type DeliveredItem,
  type DeliveryState,
  type Expiry,
  findDelivered,
  type ScopeClock,
  type Step,
} from "./delivery-state.js";
import type { DeliveryEvent } from "./events.js";
import { applyItemAction, type ItemAction } from "./item-action.js";
import { closeItem, presentItem, startItemSession, suspendItem } from "./item-lifecycle.js";
import type { ItemSessionContext, ItemStep } from "./item-session.js";
import { partModel, submissionModeOf } from "./modes.js";
import {
  type Destination,
  destinationAfter,
  destinationAfterPart,
  destinationAfterSection,
  PART_END,
  previousItem,
  type RuleContext,
  startDestination,
  TEST_END,
} from "./navigation.js";
import { type ItemKey, sameKey } from "./plan.js";
import { liesIn, type Placement, planIndex } from "./plan-index.js";
import { type Refusal, refusal } from "./refusal.js";
import { dueRequests, fitScore, suppliedTestOutcomes } from "./scoring.js";
import { SessionScope } from "./session-scope.js";
import { chooseVariant } from "./variants.js";

/** The actions on an item that end its attempt, which a test part with simultaneous submission does at its end. */
const SUBMISSIONS: ReadonlySet<Action["type"]> = new Set(["submit", "skip", "end-attempt"]);

/** Returns the refusal of the first scope whose minimum time is not reached (INFO §2.8.5, §7.40). */
function minimumNotReached(scopes: readonly RunningScope[]): Refusal | undefined {
  const early = scopes.find(
    ({ limits, spent }) => limits.minTime !== undefined && spent < limits.minTime * MILLISECONDS_PER_SECOND,
  );
  if (early === undefined) return undefined;
  const name = early.scope === "part" ? "test part" : early.scope;
  return refusal(
    "min-time-not-reached",
    `The ${name} ${describe(early.identifier)} has a minimum time of ${early.limits.minTime} s, of which ${early.spent / MILLISECONDS_PER_SECOND} s are spent.`,
    "INFO §7.40",
  );
}

/**
 * Whether going from the item presented to a destination leaves a running scope: the test at its end; the test part and
 * its sections for another part; a section that the item of the same part does not lie in. The item itself is left
 * before the walk.
 */
function leaves(
  scope: RunningScope,
  here: Placement,
  destination: Destination,
  target: Pick<Placement, "part" | "sections"> | undefined,
): boolean {
  if (scope.scope === "test") return destination.to === "test-end";
  if (scope.scope === "item") return false;
  if (target === undefined || target.part !== here.part) return true;
  return scope.scope === "section" && !liesIn(target, scope);
}

/**
 * One step of a candidate session: it starts from a state, applies a start or an action, and gives the new state with
 * the events, or a refusal. It is the reducer of the engine, and the only place that changes a state; the state it
 * starts from is never changed.
 */
export class SessionStep {
  private readonly course: Course;
  private readonly random: SeededRandom;
  private readonly events: DeliveryEvent[] = [];
  private state: DeliveryState;
  /** Whether an attempt ended since outcome processing last ran. */
  private submitted = false;

  constructor(course: Course, state: DeliveryState) {
    this.course = course;
    this.state = state;
    this.random = restoreRandom(state.random);
  }

  /** Returns the step that the state reached and the events. */
  done(): Step {
    return { ok: true, state: { ...this.state, random: this.random.state() }, events: this.events };
  }

  /** Starts the session at its first item, or ends a test that has none (INFO §2.8). */
  begin(at: number): Refusal | undefined {
    const { structure } = this.course;
    const first = this.navigate(at, (rules) => startDestination(structure, this.state.plan, rules));
    const refused = first.to === "item" ? this.enter(first.key, at, false) : this.arrive(first, at);
    this.reconcile(at);
    return refused;
  }

  /**
   * Applies an action: first the maximum times that passed before it, each at its time (E7), then the action. The
   * refusals of a test that ended, of a time before the latest step (G27) and of a suspended session come first.
   */
  apply(action: Action): Refusal | undefined {
    const { at } = action;
    // The host answers scoring and CAT requests in any state, also after the test ended (E15, E18).
    const answer = action.type === "supply-scores" || action.type === "cat-response";
    if (this.ended() && !answer) return refusal("ended", "The test has ended.", "INFO §2.8");
    if (at < this.state.at) {
      const message = `The action at ${at} is earlier than the latest step of the session at ${this.state.at}.`;
      return refusal("clock-regression", message, "INFO §2.2.2.2");
    }
    if (this.state.status === "suspended" && action.type !== "resume" && !answer) {
      return refusal("suspended", "The candidate session is suspended; it goes on when it is resumed.", "INFO §2.2.1");
    }
    const expired = this.expireUntil(at);
    if (expired !== undefined) return expired;
    this.advance(at);
    if (this.ended() && !answer) {
      if (action.type !== "time")
        return refusal("time-over", "The test ended when a maximum time passed.", "INFO §7.40.3");
      this.reconcile(at);
      return undefined;
    }
    const refused = this.perform(action);
    if (refused === undefined) this.reconcile(at);
    return refused;
  }

  private ended(): boolean {
    return this.state.status === "ended";
  }

  private perform(action: Action): Refusal | undefined {
    const { at } = action;
    switch (action.type) {
      case "supply-scores":
        return this.supply(action);
      case "cat-response":
        return this.catResponse(action);
    }
    if (this.state.current === undefined) return this.idle(action);
    switch (action.type) {
      case "time":
        return undefined;
      case "move":
        return this.move(action.to, at);
      case "support":
        return this.toggle(action.name, action.active, at);
      case "end-part":
        return this.end(PART_END, at);
      case "end-test":
        return this.end(TEST_END, at);
      case "suspend":
        return this.suspend(at);
      case "resume":
        return this.resume(at);
      default:
        return this.act(action);
    }
  }

  private placement(key: ItemKey): Placement {
    const placement = planIndex(this.state.plan).placement(key);
    if (placement === undefined)
      throw new DataError(`The plan has no item instance ${describe(key.ref)} ${key.instance}.`);
    return placement;
  }

  /** Returns the place of the item presented. */
  private here(): Placement {
    const { current } = this.state;
    if (current === undefined) throw new DataError("The state presents no item, though its test has not ended.");
    return this.placement(current);
  }

  private entry(ref: string): CourseItem {
    const entry = this.course.items.get(ref);
    if (entry === undefined) throw new DataError(`The state names ${describe(ref)}, which the test does not have.`);
    return entry;
  }

  private delivered(key: ItemKey): DeliveredItem {
    const item = findDelivered(this.state, key);
    if (item === undefined)
      throw new DataError(`The item instance ${describe(key.ref)} ${key.instance} was not presented.`);
    return item;
  }

  private processing(): ProcessingContext {
    const { customOperators, resolveTemplate, limits } = this.course;
    return { random: this.random, customOperators, resolveTemplate, limits };
  }

  private itemContext(key: ItemKey): ItemSessionContext {
    const entry = this.entry(key.ref);
    const item = candidateOf(entry, findDelivered(this.state, key)?.variant).item;
    return { ...this.processing(), item, control: entry.control };
  }

  private rules(): RuleContext {
    return {
      outcomes: this.state.outcomes,
      scope: new SessionScope(this.course, this.state),
      context: this.processing(),
      catStarted: (section, instance) => findCat(this.state, section, instance) !== undefined,
    };
  }

  private submissionMode(placement: Placement): "individual" | "simultaneous" {
    return submissionModeOf(this.course.structure, placement);
  }

  private linear(placement: Placement): boolean {
    return partModel(this.course.structure, placement).navigationMode === "linear";
  }

  private clockOf(scope: ScopeClock["scope"], identifier: string): ScopeClock | undefined {
    return this.state.clocks.find((clock) => clock.scope === scope && clock.identifier === identifier);
  }

  /** The expiries of the scopes of an instance: its own, then those of its test, test part and sections. */
  private expiries(placement: Placement): (Expiry | undefined)[] {
    return expiriesOf(this.course.structure, this.state, placement);
  }

  private store(item: DeliveredItem): void {
    const { items } = this.state;
    const at = items.findIndex((each) => sameKey(each.session.key, item.session.key));
    this.state = { ...this.state, items: at < 0 ? [...items, item] : items.map((each, i) => (i === at ? item : each)) };
  }

  /**
   * Takes the result of a step of an item session: stores the session with its events, and notes an attempt that
   * ended, which is late after a maximum time that allows late submission passed (D9).
   */
  private settle(item: DeliveredItem, step: ItemStep): Refusal | undefined {
    if (!step.ok) return step.refusal;
    const { session, events } = step;
    this.events.push(...events);
    const ended = events.find((event) => event.type === "attempt-ended");
    this.store({ ...item, session, ...(ended === undefined ? {} : { submittedAt: ended.at }) });
    if (ended !== undefined) {
      this.submitted = true;
      if (this.expiries(this.placement(session.key)).includes("late")) {
        this.events.push({ type: "late-submission", at: ended.at, item: session.key });
      }
    }
    return undefined;
  }

  private failed(at: number, message: string, item?: ItemKey): void {
    const where = item === undefined ? { scope: this.course.structure.test.model.identifier } : { item };
    this.events.push({ type: "processing-failed", at, ...where, detail: message });
  }

  /**
   * Runs the outcome processing of the test once after the attempts that ended, the submission of an item in
   * individual mode or of a group in simultaneous mode, before the engine decides where to go (INFO §2.9, B37). The
   * outcomes start from their defaults; when processing fails, they keep them (E26).
   */
  private processOutcomes(at: number): void {
    if (!this.submitted) return;
    this.submitted = false;
    const { test } = this.course.structure;
    const kept = this.keptOutcomes();
    try {
      const outcomes = runOutcomeProcessing(
        test.model,
        kept,
        new SessionScope(this.course, this.state),
        this.processing(),
      );
      this.state = { ...this.state, outcomes };
      this.events.push({ type: "outcome-processed", at, scope: test.model.identifier });
    } catch (error) {
      if (!(error instanceof AssesskitError)) throw error;
      this.state = { ...this.state, outcomes: new Map([...this.course.outcomes, ...kept]) };
      this.failed(at, error.message);
    }
  }

  /**
   * Returns the values that outcome processing starts the external-scored outcomes of the test from: those a scorer
   * supplied, and those a CAT engine reported, which the reset of INFO §2.9 would otherwise erase (G24, E16, C4).
   */
  private keptOutcomes(): Map<string, Value | null> {
    return new Map<string, Value | null>([...catTestOutcomes(this.state), ...suppliedTestOutcomes(this.state)]);
  }

  /** Runs a walk of the plan; when an expression of a rule fails, the failure is reported and the test ends (E26). */
  private navigate(at: number, walk: (rules: RuleContext) => Destination): Destination {
    try {
      return walk(this.rules());
    } catch (error) {
      if (!(error instanceof AssesskitError)) throw error;
      this.failed(at, error.message);
      return TEST_END;
    }
  }

  /** Counts the time from the latest step to `at` in the test, the test part and the sections of the item presented. */
  private advance(at: number): void {
    const { state } = this;
    if (state.status !== "in-progress" || state.current === undefined) {
      this.state = { ...state, at };
      return;
    }
    const elapsed = at - state.at;
    const here = this.here();
    const runs = (clock: ScopeClock): boolean =>
      clock.scope === "test" ||
      (clock.scope === "part"
        ? clock.identifier === here.part
        : here.sections.some((section) => section.identifier === clock.identifier));
    this.state = {
      ...state,
      at,
      clocks: state.clocks.map((clock) => (runs(clock) ? { ...clock, spent: clock.spent + elapsed } : clock)),
    };
  }

  private clock(scope: "part" | "section", identifier: string): void {
    if (this.clockOf(scope, identifier) !== undefined) return;
    this.state = { ...this.state, clocks: [...this.state.clocks, { scope, identifier, spent: 0 }] };
  }

  /**
   * Makes an item instance the current one: the sections it lies in that the candidate was not in are entered, and the
   * item is presented.
   */
  private enter(key: ItemKey, at: number, moved = true): Refusal | undefined {
    const target = this.placement(key);
    const { current } = this.state;
    const previous = current === undefined ? undefined : this.placement(current);
    const kept = previous?.part === target.part ? previous.sections : [];
    this.clock("part", target.part);
    for (const section of target.sections) {
      if (kept.some((each) => each.identifier === section.identifier && each.instance === section.instance)) continue;
      this.clock("section", section.identifier);
      this.events.push({ type: "section-entered", at, scope: section.identifier });
    }
    if (moved) this.events.push({ type: "moved", at, item: key });
    this.state = { ...this.state, current: key };
    return this.present(key, at);
  }

  /** Presents an item instance, opening its session the first time, and records the supports that are on (E28). */
  private present(key: ItemKey, at: number): Refusal | undefined {
    if (findDelivered(this.state, key) === undefined) {
      const refused = this.open(key, at);
      if (refused !== undefined) return refused;
    }
    const item = this.delivered(key);
    const on = [...this.state.supports].filter(([, support]) => support.active).map(([name]) => name);
    const supports = [...item.supports, ...on.filter((name) => !item.supports.includes(name))];
    return this.settle({ ...item, supports }, presentItem(item.session, at, this.itemContext(key)));
  }

  /**
   * Opens the session of an item instance at its first presentation: chooses the item or a variant (B100), evaluates
   * the template defaults of the item reference in the test (B41), and starts the session with the context values (B50).
   */
  private open(key: ItemKey, at: number): Refusal | undefined {
    const entry = this.entry(key.ref);
    const { candidate, unavoidable } = chooseVariant(entry.candidates, this.state.needs);
    if (entry.candidates.length > 1) {
      this.events.push({ type: "variant-selected", at, item: key, detail: candidate.resource });
    }
    if (unavoidable.length > 0) {
      this.events.push({ type: "hazard-unavoidable", at, item: key, detail: unavoidable.join(" ") });
    }
    const context: ItemSessionContext = { ...this.processing(), item: candidate.item, control: entry.control };
    const step = startItemSession(key, at, context, {
      contextValues: itemContextValues(this.state.context, candidate.item),
      templateDefaults: this.templateDefaults(key, entry, candidate.item, at),
    });
    if (!step.ok) return step.refusal;
    this.events.push(...step.events);
    const variant = candidate === entry.candidates[0] ? {} : { variant: candidate.resource };
    this.store({ session: step.session, ...variant, supports: [] });
    return undefined;
  }

  /**
   * Evaluates the `qti-template-default`s of an item reference in the test as it is now (INFO §5.152, B41). A failure, or
   * a value that does not fit, is reported, and the declared default stays; a template variable that a variant does not
   * declare is left out.
   */
  private templateDefaults(
    key: ItemKey,
    entry: CourseItem,
    item: AssessmentItem,
    at: number,
  ): Map<string, Value | null> {
    const values = new Map<string, Value | null>();
    const { test } = this.course.structure;
    for (const { templateIdentifier, expression } of entry.node.model.templateDefaults) {
      const declaration = item.templateDeclarations.find((each) => each.identifier === templateIdentifier);
      if (declaration === undefined) continue;
      try {
        const scope = new SessionScope(this.course, this.state);
        const value = evaluateTestExpression(expression, test.model, this.state.outcomes, scope, this.processing());
        values.set(templateIdentifier, assign(value, declaration, templateIdentifier));
      } catch (error) {
        if (!(error instanceof AssesskitError)) throw error;
        this.failed(at, error.message, key);
      }
    }
    return values;
  }

  private act(action: ItemAction & { readonly at: number }): Refusal | undefined {
    const { item: key, at } = action;
    const placement = planIndex(this.state.plan).placement(key);
    if (placement === undefined) {
      return refusal(
        "unknown-item",
        `The test has no item instance ${describe(key.ref)} ${key.instance}.`,
        "INFO §2.8",
      );
    }
    if (this.expiries(placement).includes("closed")) return this.timeOver(key);
    const { current } = this.state;
    if (current === undefined || !sameKey(key, current)) {
      return refusal("not-current", "The action names an item that is not the one presented.", "INFO §2.2.1");
    }
    if (SUBMISSIONS.has(action.type) && this.submissionMode(placement) === "simultaneous") {
      const message = "The test part submits its items together at its end, so an item is not submitted alone.";
      return refusal("wrong-submission-mode", message, "INFO §2.8.2");
    }
    const item = this.delivered(key);
    const refused = this.settle(item, applyItemAction(item.session, action, this.itemContext(key)));
    if (refused !== undefined) return refused;
    this.processOutcomes(at);
    return undefined;
  }

  private timeOver(key: ItemKey): Refusal {
    const message = `The item instance ${describe(key.ref)} ${key.instance} was closed when a maximum time passed.`;
    return refusal("time-over", message, "INFO §7.40.3");
  }

  private move(to: "next" | "previous" | ItemKey, at: number): Refusal | undefined {
    const here = this.here();
    if (to === "next") return this.next(here, at);
    const linear = this.linear(here);
    if (to === "previous") {
      if (linear) return this.backward();
      const previous = previousItem(this.course.structure, this.state.plan, here.key);
      if (previous === undefined) {
        return refusal("unknown-item", "The test part has no item before the one presented.", "INFO §2.8.2");
      }
      return this.goTo(here, previous, at);
    }
    const target = planIndex(this.state.plan).placement(to);
    if (target === undefined) {
      return refusal("unknown-item", `The test has no item instance ${describe(to.ref)} ${to.instance}.`, "INFO §2.8");
    }
    if (target.part !== here.part) {
      const message = "The candidate moves within the test part presented; a test part is left at its end.";
      return refusal("not-current", message, "INFO §2.8.2");
    }
    if (sameKey(target.key, here.key)) return undefined;
    if (!linear) return this.goTo(here, target.key, at);
    if (target.order < here.order) return this.backward();
    const refused = this.next(here, at);
    if (refused !== undefined) return refused;
    const { current } = this.state;
    if (current !== undefined && sameKey(current, target.key)) return undefined;
    return refusal("not-current", "In a linear test part the candidate moves to the next item only.", "INFO §2.8.2");
  }

  private backward(): Refusal {
    return refusal("linear-backward", "The test part is linear, so the candidate moves forward only.", "INFO §2.8.2");
  }

  /** Moves within a nonlinear test part: the item presented is suspended, with its attempt open (INFO §2.2.1). */
  private goTo(here: Placement, key: ItemKey, at: number): Refusal | undefined {
    if (this.expiries(this.placement(key)).includes("closed")) return this.timeOver(key);
    const item = this.delivered(here.key);
    const refused = this.settle(item, suspendItem(item.session, at));
    return refused ?? this.enter(key, at);
  }

  /**
   * Leaves the item presented for what follows it (B26, B28, B29): the minimum time of the item must be reached; the item
   * is left; the walk decides where to go, and the minimum times of the sections, part and test that this leaves must
   * be reached. In an adaptive section the candidate waits where the next item depends on the CAT engine (E18, C4): it is
   * refused `awaiting-cat` while a request waits, and when leaving makes the engine send one, the move goes on when the
   * answer has come.
   */
  private next(here: Placement, at: number): Refusal | undefined {
    const running = runningScopes(this.course, this.state);
    const early = minimumNotReached(running.filter((scope) => scope.scope === "item"));
    if (early !== undefined) return early;
    if (this.waitsForCat(here)) {
      return refusal(
        "awaiting-cat",
        "The adaptive section waits for the CAT engine to send the next items.",
        "CAT §3.4, §2.4",
      );
    }
    const refused = this.leave(here, at);
    if (refused !== undefined) return refused;
    this.processOutcomes(at);
    this.requestCat(at);
    const { structure } = this.course;
    const destination = this.navigate(at, (rules) =>
      destinationAfter(structure, this.state.plan, here.key, here.key.ref, rules),
    );
    const left = running.filter((scope) => leaves(scope, here, destination, this.targetOf(destination)));
    const tooEarly = minimumNotReached(left);
    if (tooEarly !== undefined) return tooEarly;
    this.leaveSectionOf(here, destination, at);
    if (this.waitsForCat(here)) {
      this.markMoving(here);
      return undefined;
    }
    return this.go(destination, at);
  }

  /**
   * Ends the CAT session of the section that holds the placement when the candidate goes to a destination outside it and
   * the session waits for no answer: the results not yet reported are sent and the session ends (C4, C5). A session that
   * waits for an answer may still send more items, so it is left as it is.
   */
  private leaveSectionOf(here: Placement, destination: Destination, at: number): void {
    const session = this.catOf(here);
    if (session === undefined || session.status !== "running" || session.request !== undefined) return;
    if (this.staysIn(destination, session)) return;
    this.leaveCat(at, (each) => each.section === session.section && each.instance === session.instance);
  }

  /** Returns the place that a destination is in: the part and the sections that hold it; `undefined` when it is none. */
  private targetOf(destination: Destination): Pick<Placement, "part" | "sections"> | undefined {
    if (destination.to === "item") return this.placement(destination.key);
    if (destination.to !== "adaptive") return undefined;
    const part = partOfSection(this.state.plan, destination.section, destination.instance);
    if (part === undefined) throw new DataError(`The plan has no section ${describe(destination.section)}.`);
    return { part, sections: [{ identifier: destination.section, instance: destination.instance }] };
  }

  /** The CAT session of the adaptive section that holds the placement, `undefined` when none does. */
  private catOf(placement: Placement): CatSession | undefined {
    for (const section of placement.sections) {
      const session = findCat(this.state, section.identifier, section.instance);
      if (session !== undefined) return session;
    }
    return undefined;
  }

  /** Whether the destination lies in the adaptive section of a session. */
  private staysIn(destination: Destination, session: CatSession): boolean {
    const target = this.targetOf(destination);
    if (target === undefined) return false;
    return target.sections.some((each) => each.identifier === session.section && each.instance === session.instance);
  }

  /**
   * Whether the adaptive section of the placement waits for the CAT engine, so that the candidate cannot go on: a request
   * waits and the next item of the section has not been presented, or there is none (E18).
   */
  private waitsForCat(here: Placement): boolean {
    const session = this.catOf(here);
    if (session?.request === undefined) return false;
    const keys = sectionKeys(this.state.plan, session.section, session.instance);
    const next = keys[keys.findIndex((key) => sameKey(key, here.key)) + 1];
    return next === undefined || findDelivered(this.state, next) === undefined;
  }

  /** Notes that the candidate asked to move on while the session of the placement waits (E18). */
  private markMoving(here: Placement): void {
    const session = this.catOf(here);
    if (session !== undefined) this.state = withCat(this.state, { ...session, moving: true });
  }

  /** Applies a step of the CAT flow to the state. */
  private applyCat(change: CatChange): Refusal | undefined {
    if (!change.ok) return change.refusal;
    this.state = change.state;
    this.events.push(...change.events);
    if (change.outcomes) this.submitted = true;
    return undefined;
  }

  /** Makes the Submit Results requests that the policy of C4 calls for. */
  private requestCat(at: number): void {
    this.applyCat(submitDue(this.state, at));
  }

  /** Ends the CAT sessions that the candidate leaves: the sessions for which `leaves` is true (C4, C5). */
  private leaveCat(at: number, leaves: (session: CatSession) => boolean): void {
    this.applyCat(leaveCat(this.state, at, leaves));
  }

  /**
   * Leaves the item presented. In a linear test part with individual submission the candidate cannot come back, so an
   * open attempt is submitted, with the checks of skipping and validity, and the session closes (INFO §2.8.2, §7.19.6–7,
   * B88); otherwise the session is suspended with its attempt open.
   */
  private leave(here: Placement, at: number): Refusal | undefined {
    const item = this.delivered(here.key);
    if (!this.linear(here) || this.submissionMode(here) !== "individual") {
      return this.settle(item, suspendItem(item.session, at));
    }
    const context = this.itemContext(here.key);
    if (item.session.attempting) {
      const submit = applyItemAction(item.session, { type: "submit", item: here.key, at }, context);
      const refused = this.settle(item, submit);
      if (refused !== undefined) return refused;
    }
    const left = this.delivered(here.key);
    return this.settle(left, closeItem(left.session, at, context));
  }

  /**
   * Returns the test part the candidate is in: that of the item presented, else that of the adaptive section whose first
   * stage is awaited.
   */
  private currentPart(): string {
    if (this.state.current !== undefined) return this.here().part;
    const waiting = this.state.cat.find((session) => session.moving === true);
    const part = waiting === undefined ? undefined : partOfSection(this.state.plan, waiting.section, waiting.instance);
    if (part === undefined) throw new DataError("The state presents no item, though its test has not ended.");
    return part;
  }

  /** Goes where a walk leads: to an item or an adaptive section, ending the test part when it is in another, or to the end of the part or test. */
  private go(destination: Destination, at: number): Refusal | undefined {
    const part = this.currentPart();
    if (destination.to === "item" || destination.to === "adaptive") {
      if (this.targetOf(destination)?.part === part) {
        this.leaveSectionsFor(destination, at);
        return this.arrive(destination, at);
      }
      return this.endPart(at) ?? this.arrive(destination, at);
    }
    const refused = this.endPart(at);
    if (refused !== undefined) return refused;
    if (destination.to === "test-end") return this.endTest(at);
    const { structure } = this.course;
    const next = this.navigate(at, (rules) => destinationAfterPart(structure, this.state.plan, part, rules));
    return this.arrive(next, at);
  }

  /** Goes to an item, starts an adaptive section, or ends the test. */
  private arrive(destination: Destination, at: number): Refusal | undefined {
    switch (destination.to) {
      case "item":
        return this.enter(destination.key, at);
      case "adaptive":
        return this.startAdaptive(destination.section, destination.instance, at);
      default:
        return this.endTest(at);
    }
  }

  /** Ends the sessions of the adaptive sections that hold the item presented and not the destination (C4). */
  private leaveSectionsFor(destination: Destination, at: number): void {
    const { current } = this.state;
    if (current === undefined) return;
    const here = this.placement(current);
    this.leaveCat(at, (session) => {
      const holds = here.sections.some(
        (each) => each.identifier === session.section && each.instance === session.instance,
      );
      return holds && !this.staysIn(destination, session);
    });
  }

  /**
   * Starts the CAT session of an adaptive section the candidate enters (C3, E18): the candidate has no item to see until
   * the engine sends the first stage, so the session presents none.
   */
  private startAdaptive(section: string, instance: number, at: number): undefined {
    this.applyCat(startCat(this.state, section, instance, at));
    const { current: _left, ...state } = this.state;
    this.state = state;
    return undefined;
  }

  /**
   * Ends the test part of the item presented (INFO §2.8.2): every session of the part closes, so an open attempt ends
   * with its drafts, which in simultaneous mode submits the group; outcome processing follows. The CAT sessions of the
   * part end, with the results of the attempts that just closed (C4, C5).
   */
  private endPart(at: number): Refusal | undefined {
    const part = this.currentPart();
    for (const item of this.state.items) {
      if (this.placement(item.session.key).part !== part) continue;
      const refused = this.settle(item, closeItem(item.session, at, this.itemContext(item.session.key)));
      if (refused !== undefined) return refused;
    }
    this.processOutcomes(at);
    this.leaveCat(at, (session) => partOfSection(this.state.plan, session.section, session.instance) === part);
    this.events.push({ type: "part-ended", at, scope: part });
    return undefined;
  }

  private endTest(at: number): undefined {
    this.leaveCat(at, () => true);
    const { current: _left, ...state } = this.state;
    this.state = { ...state, status: "ended" };
    this.events.push({ type: "test-ended", at, scope: this.course.structure.test.model.identifier });
    return undefined;
  }

  /** Ends the test part or the test at the candidate's request, when the minimum times it leaves are reached. */
  private end(destination: Destination, at: number): Refusal | undefined {
    const leaving = runningScopes(this.course, this.state).filter(
      (scope) => scope.scope !== "test" || destination.to === "test-end",
    );
    return minimumNotReached(leaving) ?? this.go(destination, at);
  }

  /** Applies the maximum times that passed up to `at`, earliest first, each at its own time (E7, D9). */
  private expireUntil(at: number): Refusal | undefined {
    for (let due = this.due(at); due !== undefined; due = this.due(at)) {
      this.advance(due.at);
      const refused = this.expire(due.scope, due.at);
      if (refused !== undefined) return refused;
      this.reconcile(due.at);
    }
    return undefined;
  }

  /** Returns the running scope whose maximum time passed first, up to `at`, with that time. */
  private due(at: number): { readonly scope: RunningScope; readonly at: number } | undefined {
    let due: { readonly scope: RunningScope; readonly at: number } | undefined;
    for (const scope of runningScopes(this.course, this.state)) {
      const deadline = scope.expired === undefined ? maximumAt(scope, this.state.at) : undefined;
      if (deadline !== undefined && deadline <= at && (due === undefined || deadline < due.at)) {
        due = { scope, at: Math.max(deadline, this.state.at) };
      }
    }
    return due;
  }

  /**
   * Applies a maximum time that passed (D9). With late submission the scope stays open and the step reports
   * `time-limit-passed`. Without, the step reports `time-out`, and the scope closes.
   */
  private expire(scope: RunningScope, at: number): Refusal | undefined {
    const late = scope.limits.allowLateSubmission;
    this.mark(scope, late ? "late" : "closed", at);
    if (late) return undefined;
    switch (scope.scope) {
      case "test":
        return this.go(TEST_END, at);
      case "part":
        return this.go(PART_END, at);
      default:
        return this.close(scope, at);
    }
  }

  /** Records what a maximum time did, and reports it. */
  private mark(scope: RunningScope, expiry: Expiry, at: number): void {
    const type = expiry === "late" ? "time-limit-passed" : "time-out";
    if (scope.scope === "item") {
      const { key } = this.here();
      this.store({ ...this.delivered(key), expired: expiry });
      this.events.push({ type, at, item: key });
      return;
    }
    const clocks = this.state.clocks.map((clock) =>
      clock.scope === scope.scope && clock.identifier === scope.identifier ? { ...clock, expired: expiry } : clock,
    );
    this.state = { ...this.state, clocks };
    this.events.push({ type, at, scope: scope.identifier });
  }

  /**
   * Closes the item presented, or a section that holds it, at its maximum time: the open attempts end with the drafts
   * received before it, and the candidate goes on as after leaving the scope.
   */
  private close(scope: RunningScope, at: number): Refusal | undefined {
    const here = this.here();
    for (const item of this.state.items) {
      const placement = this.placement(item.session.key);
      const inside = scope.scope === "item" ? sameKey(placement.key, here.key) : liesIn(placement, scope);
      if (!inside) continue;
      const refused = this.settle(item, closeItem(item.session, at, this.itemContext(item.session.key)));
      if (refused !== undefined) return refused;
    }
    this.processOutcomes(at);
    const { structure } = this.course;
    const destination = this.navigate(at, (rules) =>
      destinationAfter(structure, this.state.plan, here.key, scope.identifier, rules),
    );
    return this.go(destination, at);
  }

  private suspend(at: number): Refusal | undefined {
    const { current } = this.state;
    if (current !== undefined) {
      const item = this.delivered(current);
      const refused = this.settle(item, suspendItem(item.session, at));
      if (refused !== undefined) return refused;
    }
    this.state = { ...this.state, status: "suspended" };
    this.events.push({ type: "suspended", at });
    return undefined;
  }

  private resume(at: number): Refusal | undefined {
    if (this.state.status !== "suspended") return undefined;
    this.state = { ...this.state, status: "in-progress" };
    this.events.push({ type: "resumed", at });
    const { current } = this.state;
    const presented = current === undefined ? undefined : this.present(current, at);
    return presented ?? this.continueCat(at);
  }

  /** Turns a support that is an option on or off (BPIG §5.3, E28); one turned on counts for the item presented. */
  private toggle(name: SupportName, active: boolean, at: number): Refusal | undefined {
    const support = this.state.supports.get(name);
    if (support?.state !== "option") {
      const why = support === undefined ? "is not offered" : `is ${support.state}`;
      return refusal(
        "support-not-available",
        `The support ${name} ${why}, so the candidate cannot turn it on or off.`,
        "BPIG §5.3",
      );
    }
    if (support.active === active) return undefined;
    this.state = { ...this.state, supports: new Map(this.state.supports).set(name, { ...support, active }) };
    this.events.push({ type: "support-changed", at, detail: `${name} ${active ? "on" : "off"}` });
    const { current } = this.state;
    if (!active || current === undefined) return undefined;
    const item = this.delivered(current);
    if (!item.supports.includes(name)) this.store({ ...item, supports: [...item.supports, name] });
    return undefined;
  }

  /**
   * Applies an action of the candidate while no item is presented, because the first stage of an adaptive section is
   * awaited (E18): time passes without effect, a support can be turned on or off, the session can be suspended and resumed,
   * and the part or the test can be ended. Anything else waits for the CAT engine.
   */
  private idle(action: Action): Refusal | undefined {
    const { at } = action;
    switch (action.type) {
      case "time":
        return undefined;
      case "support":
        return this.toggle(action.name, action.active, at);
      case "suspend":
        return this.suspend(at);
      case "resume":
        return this.resume(at);
      case "end-part":
        return this.end(PART_END, at);
      case "end-test":
        return this.end(TEST_END, at);
      default:
        return refusal(
          "awaiting-cat",
          "The adaptive section waits for the CAT engine to send its first items.",
          "CAT §3.3",
        );
    }
  }

  /**
   * Makes the scoring requests that are due (E13): item outcomes whose session is over, and test outcomes whose covers are
   * over or whose test has ended. The CAT requests that the submissions call for are made with them (C4).
   */
  private reconcile(at: number): void {
    this.requestCat(at);
    const due = dueRequests(this.course, this.state, at);
    if (due.length === 0) return;
    this.state = { ...this.state, scoring: [...this.state.scoring, ...due] };
    const test = this.course.structure.test.model.identifier;
    for (const request of due) {
      const where = request.item === undefined ? { scope: test } : { item: request.item };
      this.events.push({ type: "scoring-requested", at, ...where, detail: request.id });
    }
  }

  /**
   * Takes the value that the host supplied for a scoring request (E15): it must fit the declaration; a second supply
   * replaces the first. An item outcome is set in the session without running response processing again (G25); the
   * outcome processing of the test runs again, with the supplied values as the starting values of the external-scored
   * outcomes (G24, E16).
   */
  private supply(action: HostAction & { readonly type: "supply-scores"; readonly at: number }): Refusal | undefined {
    const { at } = action;
    const request = this.state.scoring.find(({ id }) => id === action.request);
    if (request === undefined) {
      return refusal("unknown-request", `The state has no scoring request ${describe(action.request)}.`, "RR §2.7.7");
    }
    const value = fitScore(request, action.value === null ? null : normalizeValue(action.value));
    if (value === undefined) {
      return refusal(
        "score-type-mismatch",
        `The outcome ${request.outcome} is ${describeType(request.declaration)}, found ${describe(action.value)}.`,
        "RR §2.7.7",
      );
    }
    const replaced = request.supplied !== undefined;
    const supplied = { ...request, supplied: { value, at, scorer: action.scorer } };
    this.state = { ...this.state, scoring: this.state.scoring.map((each) => (each === request ? supplied : each)) };
    const where =
      request.item === undefined ? { scope: this.course.structure.test.model.identifier } : { item: request.item };
    this.events.push({ type: replaced ? "scores-replaced" : "scores-applied", at, ...where, detail: request.id });
    const delivered = request.item === undefined ? undefined : findDelivered(this.state, request.item);
    if (delivered !== undefined) {
      const { variables } = delivered.session;
      const outcomes = new Map(variables.outcomes).set(request.outcome, value);
      this.store({ ...delivered, session: { ...delivered.session, variables: { ...variables, outcomes } } });
    }
    this.submitted = true;
    this.processOutcomes(at);
    return undefined;
  }

  /** Takes the answer of the CAT engine to a request (E18); a candidate who waited for it moves on. */
  private catResponse(
    action: HostAction & { readonly type: "cat-response"; readonly at: number },
  ): Refusal | undefined {
    const { at } = action;
    const refused = this.applyCat(answerCat(this.course, this.state, action.request, action.response, at));
    if (refused !== undefined) return refused;
    this.processOutcomes(at);
    return this.continueCat(at);
  }

  /**
   * Moves a candidate on who waited for the CAT engine, once nothing is awaited (E18): to the first item of the stage
   * when none was presented, else where the walk leads from the item left. A candidate who is suspended moves on at
   * resuming.
   */
  private continueCat(at: number): Refusal | undefined {
    const session = this.state.cat.find((each) => each.moving === true && each.request === undefined);
    if (session === undefined || this.state.status !== "in-progress") return undefined;
    const { current } = this.state;
    const first = session.status === "running" ? session.stage[0] : undefined;
    let refused: Refusal | undefined;
    if (current === undefined && first !== undefined) {
      refused = this.enter(first, at);
    } else if (current === undefined) {
      const { structure } = this.course;
      const destination = this.navigate(at, (rules) =>
        destinationAfterSection(structure, this.state.plan, session.section, session.instance, rules),
      );
      refused = this.go(destination, at);
    } else {
      const here = this.placement(current);
      const { structure } = this.course;
      const destination = this.navigate(at, (rules) =>
        destinationAfter(structure, this.state.plan, current, current.ref, rules),
      );
      this.leaveSectionOf(here, destination, at);
      if (this.waitsForCat(here)) return undefined;
      refused = this.go(destination, at);
    }
    const still = findCat(this.state, session.section, session.instance);
    if (still !== undefined && still.moving === true) {
      const { moving: _moved, ...rest } = still;
      this.state = withCat(this.state, rest);
    }
    return refused;
  }
}
