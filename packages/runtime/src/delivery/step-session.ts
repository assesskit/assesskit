import type { SupportName } from "../pnp/index.js";
import { suspendItem } from "./item-lifecycle.js";
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
