import { describe } from "../checks.js";
import type { Action } from "./action.js";
import { findDelivered } from "./delivery-state.js";
import { applyItemAction, type ItemAction } from "./item-action.js";
import { type ItemKey, sameKey } from "./plan.js";
import { planIndex } from "./plan-index.js";
import { type Refusal, refusal } from "./refusal.js";
import { itemContextOf, type StepContext, store } from "./step-context.js";

/** Whether an action asks to review an item or to see its solution. */
export function isReview(
  action: Action,
): action is Action & { readonly type: "review" | "solution"; readonly item: ItemKey } {
  return action.type === "review" || action.type === "solution";
}

/**
 * Applies `review` or `solution` to an item of a test that ended: the item session shows its responses, or the correct
 * responses, as the item session control allows, and the item becomes the one presented.
 *
 * @remarks
 * Nothing that `results()` reports changes. No clock runs and no outcome processing runs, and the time of the state and
 * the `updatedAt` of the item session stay as they were, because the results report the datestamps that they hold; the
 * time of the action is that of the event. The session of the item decides the rest, as in a running session: `review`
 * and `solution` are refused unless the control allows them.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function reviewEnded(step: StepContext, action: ItemAction & { readonly at: number }): Refusal | undefined {
  const { item: key, at } = action;
  if (planIndex(step.state.plan).placement(key) === undefined) {
    return refusal("unknown-item", `The test has no item instance ${describe(key.ref)} ${key.instance}.`);
  }
  const delivered = findDelivered(step.state, key);
  if (delivered === undefined) {
    const message = `The item instance ${describe(key.ref)} ${key.instance} was not presented, so it cannot be reviewed.`;
    return refusal("not-current", message);
  }
  const revisited = applyItemAction(delivered.session, action, itemContextOf(step, key));
  if (!revisited.ok) return revisited.refusal;
  store(step, { ...delivered, session: { ...revisited.session, updatedAt: delivered.session.updatedAt } });
  const { current } = step.state;
  if (current === undefined || !sameKey(current, key)) {
    step.events.push({ type: "moved", at, item: key });
    step.state = { ...step.state, current: key };
  }
  return undefined;
}
