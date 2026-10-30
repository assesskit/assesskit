import type { AssessmentItem, TestPart } from "../asi/index.js";
import { describe } from "../checks.js";
import { DataError, OlahError } from "../errors.js";
import type { SupportName } from "../pnp/index.js";
import { assign } from "../processing/assign.js";
import { evaluateTestExpression, type ProcessingContext, runOutcomeProcessing } from "../processing/index.js";
import { restoreRandom, type SeededRandom } from "../random.js";
import type { Value } from "../values/index.js";
import type { Action } from "./action.js";
import { MILLISECONDS_PER_SECOND } from "./attempt.js";
import { type Course, type CourseItem, candidateOf, itemContextValues } from "./course.js";
import { maximumAt, type RunningScope, runningScopes } from "./deadlines.js";
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
import {
  type Destination,
  destinationAfter,
  itemAfterPart,
  nextItem,
  PART_END,
  previousItem,
  type RuleContext,
  TEST_END,
} from "./navigation.js";
import { type ItemKey, sameKey } from "./plan.js";
import { liesIn, type Placement, planIndex } from "./plan-index.js";
import { type Refusal, refusal } from "./refusal.js";
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
  target: Placement | undefined,
): boolean {
  if (scope.scope === "test") return destination.to === "test-end";
  if (scope.scope === "item") return false;
  if (target === undefined || target.part !== here.part) return true;
  return scope.scope === "section" && !liesIn(target, scope);
}

/** Returns the destination that an item instance, or no instance, is. */
function destinationOf(key: ItemKey | undefined): Destination {
  return key === undefined ? TEST_END : { to: "item", key };
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
    const first = this.navigate(at, (rules) => destinationOf(nextItem(structure, this.state.plan, undefined, rules)));
    return first.to === "item" ? this.enter(first.key, at, false) : this.endTest(at);
  }

  /**
   * Applies an action: first the maximum times that passed before it, each at its time (E7), then the action. The
   * refusals of a test that ended, of a time before the latest step (G27) and of a suspended session come first.
   */
  apply(action: Action): Refusal | undefined {
    const { at } = action;
    if (this.ended()) return refusal("ended", "The test has ended.", "INFO §2.8");
    if (at < this.state.at) {
      const message = `The action at ${at} is earlier than the latest step of the session at ${this.state.at}.`;
      return refusal("clock-regression", message, "INFO §2.2.2.2");
    }
    if (this.state.status === "suspended" && action.type !== "resume") {
      return refusal("suspended", "The candidate session is suspended; it goes on when it is resumed.", "INFO §2.2.1");
    }
    const expired = this.expireUntil(at);
    if (expired !== undefined) return expired;
    this.advance(at);
    if (this.ended()) {
      if (action.type === "time") return undefined;
      return refusal("time-over", "The test ended when a maximum time passed.", "INFO §7.40.3");
    }
    return this.perform(action);
  }

  private ended(): boolean {
    return this.state.status === "ended";
  }

  private perform(action: Action): Refusal | undefined {
    const { at } = action;
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
    };
  }

  private partOf(placement: Placement): TestPart {
    const part = this.course.structure.part(placement.part);
    if (part === undefined)
      throw new DataError(`The plan names ${describe(placement.part)}, which the test does not have.`);
    return part.model;
  }

  private submissionMode(placement: Placement): "individual" | "simultaneous" {
    const { structure } = this.course;
    // CAT §2.4: the items of an adaptive section are processed one by one, in a part of either mode (B27).
    const adaptive = placement.sections.some(
      (section) => structure.section(section.identifier)?.model.adaptiveSelection !== undefined,
    );
    return adaptive ? "individual" : this.partOf(placement).submissionMode;
  }

  private linear(placement: Placement): boolean {
    return this.partOf(placement).navigationMode === "linear";
  }

  private clockOf(scope: ScopeClock["scope"], identifier: string): ScopeClock | undefined {
    return this.state.clocks.find((clock) => clock.scope === scope && clock.identifier === identifier);
  }

  /** The expiries of the scopes of an instance: its own, then those of its test part and sections. */
  private expiries(placement: Placement): (Expiry | undefined)[] {
    return [
      findDelivered(this.state, placement.key)?.expired,
      this.clockOf("test", this.course.structure.test.model.identifier)?.expired,
      this.clockOf("part", placement.part)?.expired,
      ...placement.sections.map((section) => this.clockOf("section", section.identifier)?.expired),
    ];
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
    try {
      const outcomes = runOutcomeProcessing(
        test.model,
        new Map(),
        new SessionScope(this.course, this.state),
        this.processing(),
      );
      this.state = { ...this.state, outcomes };
      this.events.push({ type: "outcome-processed", at, scope: test.model.identifier });
    } catch (error) {
      if (!(error instanceof OlahError)) throw error;
      this.state = { ...this.state, outcomes: this.course.outcomes };
      this.failed(at, error.message);
    }
  }

  /** Runs a walk of the plan; when an expression of a rule fails, the failure is reported and the test ends (E26). */
  private navigate(at: number, walk: (rules: RuleContext) => Destination): Destination {
    try {
      return walk(this.rules());
    } catch (error) {
      if (!(error instanceof OlahError)) throw error;
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
        if (!(error instanceof OlahError)) throw error;
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
   * be reached.
   */
  private next(here: Placement, at: number): Refusal | undefined {
    const running = runningScopes(this.course, this.state);
    const early = minimumNotReached(running.filter((scope) => scope.scope === "item"));
    if (early !== undefined) return early;
    const refused = this.leave(here, at);
    if (refused !== undefined) return refused;
    this.processOutcomes(at);
    const { structure } = this.course;
    const destination = this.navigate(at, (rules) =>
      destinationAfter(structure, this.state.plan, here.key, here.key.ref, rules),
    );
    const target = destination.to === "item" ? this.placement(destination.key) : undefined;
    const left = running.filter((scope) => leaves(scope, here, destination, target));
    return minimumNotReached(left) ?? this.go(destination, at);
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

  /** Goes where a walk leads: to an item, ending the test part when the item is in another, or to the end of the part or test. */
  private go(destination: Destination, at: number): Refusal | undefined {
    const { part } = this.here();
    if (destination.to === "item") {
      if (this.placement(destination.key).part === part) return this.enter(destination.key, at);
      return this.endPart(at) ?? this.enter(destination.key, at);
    }
    const refused = this.endPart(at);
    if (refused !== undefined) return refused;
    if (destination.to === "test-end") return this.endTest(at);
    const { structure } = this.course;
    const next = this.navigate(at, (rules) => destinationOf(itemAfterPart(structure, this.state.plan, part, rules)));
    return next.to === "item" ? this.enter(next.key, at) : this.endTest(at);
  }

  /**
   * Ends the test part of the item presented (INFO §2.8.2): every session of the part closes, so an open attempt ends
   * with its drafts, which in simultaneous mode submits the group; outcome processing follows.
   */
  private endPart(at: number): Refusal | undefined {
    const { part } = this.here();
    for (const item of this.state.items) {
      if (this.placement(item.session.key).part !== part) continue;
      const refused = this.settle(item, closeItem(item.session, at, this.itemContext(item.session.key)));
      if (refused !== undefined) return refused;
    }
    this.processOutcomes(at);
    this.events.push({ type: "part-ended", at, scope: part });
    return undefined;
  }

  private endTest(at: number): undefined {
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
    const item = this.delivered(this.here().key);
    const refused = this.settle(item, suspendItem(item.session, at));
    if (refused !== undefined) return refused;
    this.state = { ...this.state, status: "suspended" };
    this.events.push({ type: "suspended", at });
    return undefined;
  }

  private resume(at: number): Refusal | undefined {
    if (this.state.status !== "suspended") return undefined;
    this.state = { ...this.state, status: "in-progress" };
    this.events.push({ type: "resumed", at });
    return this.present(this.here().key, at);
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
    if (!active) return undefined;
    const item = this.delivered(this.here().key);
    if (!item.supports.includes(name)) this.store({ ...item, supports: [...item.supports, name] });
    return undefined;
  }
}
