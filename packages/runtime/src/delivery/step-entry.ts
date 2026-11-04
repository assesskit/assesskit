import type { AssessmentItem } from "../asi/index.js";
import { AssesskitError } from "../errors.js";
import { assign, evaluateTestExpression } from "../processing/internal.js";
import type { Value } from "../values/index.js";
import { type CourseItem, itemContextValues } from "./course.js";
import { findDelivered } from "./delivery-state.js";
import { presentItem, startItemSession } from "./item-lifecycle.js";
import type { ItemSessionContext } from "./item-session.js";
import type { ItemKey } from "./plan.js";
import type { Refusal } from "./refusal.js";
import { SessionScope } from "./session-scope.js";
import {
  courseItem,
  deliveredOf,
  failed,
  itemContextOf,
  placementOf,
  processingOf,
  type StepContext,
  settle,
  store,
} from "./step-context.js";
import { chooseVariant } from "./variants.js";

/** Starts the clock of a test part or section the candidate enters, unless it runs already. */
function startClock(step: StepContext, scope: "part" | "section", identifier: string): void {
  const { clocks } = step.state;
  if (clocks.some((clock) => clock.scope === scope && clock.identifier === identifier)) return;
  step.state = { ...step.state, clocks: [...clocks, { scope, identifier, spent: 0 }] };
}

/**
 * Evaluates the `qti-template-default`s of an item reference in the test as it is now. A failure, or a value that
 * does not fit, is reported, and the declared default stays; a template variable that a variant does not declare is
 * left out.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-template-default}
 */
function templateDefaults(
  step: StepContext,
  key: ItemKey,
  entry: CourseItem,
  item: AssessmentItem,
  at: number,
): Map<string, Value | null> {
  const values = new Map<string, Value | null>();
  const { test } = step.course.structure;
  for (const { templateIdentifier, expression } of entry.node.model.templateDefaults) {
    const declaration = item.templateDeclarations.find((each) => each.identifier === templateIdentifier);
    if (declaration === undefined) continue;
    try {
      const scope = new SessionScope(step.course, step.state);
      const value = evaluateTestExpression(expression, test.model, step.state.outcomes, scope, processingOf(step));
      values.set(templateIdentifier, assign(value, declaration, templateIdentifier));
    } catch (error) {
      if (!(error instanceof AssesskitError)) throw error;
      failed(step, at, error.message, key);
    }
  }
  return values;
}

/**
 * Opens the session of an item instance at its first presentation: chooses the item or a variant, evaluates the
 * template defaults of the item reference in the test, and starts the session with the context values.
 */
function open(step: StepContext, key: ItemKey, at: number): Refusal | undefined {
  const entry = courseItem(step, key.ref);
  const { candidate, unavoidable } = chooseVariant(entry.candidates, step.state.needs);
  if (entry.candidates.length > 1) {
    step.events.push({ type: "variant-selected", at, item: key, detail: candidate.resource });
  }
  if (unavoidable.length > 0) {
    step.events.push({ type: "hazard-unavoidable", at, item: key, detail: unavoidable.join(" ") });
  }
  const context: ItemSessionContext = { ...processingOf(step), item: candidate.item, control: entry.control };
  const started = startItemSession(key, at, context, {
    contextValues: itemContextValues(step.state.context, candidate.item),
    templateDefaults: templateDefaults(step, key, entry, candidate.item, at),
  });
  if (!started.ok) return started.refusal;
  for (const event of started.events) step.events.push(event);
  const variant = candidate === entry.candidates[0] ? {} : { variant: candidate.resource };
  store(step, { session: started.session, ...variant, supports: [] });
  return undefined;
}

/** Presents an item instance, opening its session the first time, and records the supports that are on. */
export function present(step: StepContext, key: ItemKey, at: number): Refusal | undefined {
  if (findDelivered(step.state, key) === undefined) {
    const refused = open(step, key, at);
    if (refused !== undefined) return refused;
  }
  const item = deliveredOf(step, key);
  const on = [...step.state.supports].filter(([, support]) => support.active).map(([name]) => name);
  const supports = [...item.supports, ...on.filter((name) => !item.supports.includes(name))];
  return settle(step, { ...item, supports }, presentItem(item.session, at, itemContextOf(step, key)));
}

/**
 * Makes an item instance the current one: the sections it lies in that the candidate was not in are entered, and the
 * item is presented.
 */
export function enter(step: StepContext, key: ItemKey, at: number, moved = true): Refusal | undefined {
  const target = placementOf(step, key);
  const { current } = step.state;
  const previous = current === undefined ? undefined : placementOf(step, current);
  const kept = previous?.part === target.part ? previous.sections : [];
  startClock(step, "part", target.part);
  for (const section of target.sections) {
    if (kept.some((each) => each.identifier === section.identifier && each.instance === section.instance)) continue;
    startClock(step, "section", section.identifier);
    step.events.push({ type: "section-entered", at, scope: section.identifier });
  }
  if (moved) step.events.push({ type: "moved", at, item: key });
  step.state = { ...step.state, current: key };
  return present(step, key, at);
}
