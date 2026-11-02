import { describe } from "../checks.js";
import type { SupportName, SupportSetting } from "../pnp/index.js";
import { adjustableSettings, fixedChange } from "./adjustable-settings.js";
import { findDelivered } from "./delivery-state.js";
import { suspendItem } from "./item-lifecycle.js";
import type { ItemKey } from "./plan.js";
import { type Refusal, refusal } from "./refusal.js";
import { deliveredOf, type StepContext, settle, store } from "./step-context.js";
import { present } from "./step-entry.js";
import { continueCat } from "./step-host.js";

/** Suspends the candidate session: the item presented is suspended, and time stops counting. */
export function suspend(step: StepContext, at: number): Refusal | undefined {
  const { current } = step.state;
  if (current !== undefined) {
    const item = deliveredOf(step, current);
    const refused = settle(step, item, suspendItem(item.session, at));
    if (refused !== undefined) return refused;
  }
  step.state = { ...step.state, status: "suspended" };
  step.events.push({ type: "suspended", at });
  return undefined;
}

/** Resumes a suspended candidate session: the item presented is presented again, and a wait for a CAT engine goes on. */
export function resume(step: StepContext, at: number): Refusal | undefined {
  if (step.state.status !== "suspended") return undefined;
  step.state = { ...step.state, status: "in-progress" };
  step.events.push({ type: "resumed", at });
  const { current } = step.state;
  const presented = current === undefined ? undefined : present(step, current, at);
  return presented ?? continueCat(step, at);
}

/** Turns a support that is an option on or off; one turned on counts for the item presented. */
export function toggle(step: StepContext, name: SupportName, active: boolean, at: number): Refusal | undefined {
  const support = step.state.supports.get(name);
  if (support?.state !== "option") {
    const why = support === undefined ? "is not offered" : `is ${support.state}`;
    return refusal("support-not-available", `The support ${name} ${why}, so the candidate cannot turn it on or off.`);
  }
  if (support.active === active) return undefined;
  step.state = { ...step.state, supports: new Map(step.state.supports).set(name, { ...support, active }) };
  step.events.push({ type: "support-changed", at, detail: `${name} ${active ? "on" : "off"}` });
  const { current } = step.state;
  if (!active || current === undefined) return undefined;
  const item = deliveredOf(step, current);
  if (!item.supports.includes(name)) store(step, { ...item, supports: [...item.supports, name] });
  return undefined;
}

/** Marks an item instance that was presented for review, or takes the mark away; marking a marked item changes nothing. */
export function mark(step: StepContext, key: ItemKey, marked: boolean): Refusal | undefined {
  const item = findDelivered(step.state, key);
  if (item === undefined) {
    const message = `The candidate was not presented the item instance ${describe(key.ref)} ${key.instance}.`;
    return refusal("unknown-item", message);
  }
  if ((item.marked === true) === marked) return undefined;
  const { marked: _, ...unmarked } = item;
  store(step, marked ? { ...item, marked } : unmarked);
  return undefined;
}

/**
 * Changes the settings of a support that is on to those the candidate prefers: only the settings of
 * `ADJUSTABLE_SETTINGS` may change, and settings equal to those in force change nothing.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/conf/ | QTI 3.0 Conformance and Certification, A-10b, A-30b, A-40d and A-40e}
 */
export function adjust(step: StepContext, settings: SupportSetting, at: number): Refusal | undefined {
  const { name } = settings;
  const support = step.state.supports.get(name);
  if (support?.active !== true) {
    const why = support === undefined ? "is not offered" : "is off";
    return refusal("support-not-available", `The support ${name} ${why}, so the candidate cannot change its settings.`);
  }
  const adjustable = adjustableSettings(name);
  if (adjustable === undefined) {
    return refusal("setting-not-adjustable", `The support ${name} has no settings that the candidate can change.`);
  }
  const fixed = fixedChange(support.settings, settings, adjustable);
  if (fixed !== undefined) {
    const allowed = adjustable.join(", ");
    return refusal("setting-not-adjustable", `The candidate can change ${allowed} of ${name}, and not ${fixed}.`);
  }
  if (fixedChange(support.settings, settings, []) === undefined) return undefined;
  step.state = { ...step.state, supports: new Map(step.state.supports).set(name, { ...support, settings }) };
  step.events.push({ type: "support-changed", at, detail: `${name} settings` });
  return undefined;
}
