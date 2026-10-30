import type { AssessmentItem } from "../asi/index.js";
import type { CandidateAction } from "./action.js";
import { endAttemptInteractions } from "./attempt.js";
import { CANDIDATE_ACTION_TYPES } from "./candidate-actions.js";
import type { DeliveredItem, DeliveryState } from "./delivery-state.js";
import type { EffectiveSessionControl } from "./session-control.js";

/** What decides the actions the candidate may take on the item presented. */
export interface ItemRules {
  /** The delivered item instance. */
  readonly delivered: DeliveredItem;
  /** The item it presents. */
  readonly item: AssessmentItem;
  /** The item session control in force. */
  readonly control: EffectiveSessionControl;
  /** How the test part submits the item (B27). */
  readonly submission: "individual" | "simultaneous";
  /** Whether a maximum time closed the item or a scope that holds it (D9). */
  readonly closedByTime: boolean;
}

/** The types of the actions that respond to an open item session: it takes responses, and ends an attempt in individual mode. */
function respondingTypes({ delivered, item, control, submission }: ItemRules): CandidateAction["type"][] {
  const endAttempts = endAttemptInteractions(item);
  const setsResponses = item.responseDeclarations.some(({ identifier }) => !endAttempts.has(identifier));
  const types: CandidateAction["type"][] = ["set-responses"];
  if (submission === "individual") {
    types.push("submit");
    // A skip submits NULL responses, which an item without responses of the candidate cannot refuse (INFO §7.19.6).
    if (control.allowSkipping || !setsResponses) types.push("skip");
    if (endAttempts.size > 0) types.push("end-attempt");
  }
  if (!delivered.session.attempting) types.push("next-attempt");
  return types;
}

/**
 * Returns the types of the actions on the item presented that its session allows. A type that the data of an action can
 * still make refused, such as a `submit` without a response under `allow-skipping="false"`, is listed.
 */
function itemTypes(rules: ItemRules): CandidateAction["type"][] {
  if (rules.closedByTime) return [];
  const { control } = rules;
  const types: CandidateAction["type"][] =
    rules.delivered.session.status === "interacting"
      ? respondingTypes(rules)
      : [...(control.allowReview ? ["review" as const] : []), ...(control.showSolution ? ["solution" as const] : [])];
  return control.allowComment ? [...types, "comment"] : types;
}

/**
 * Returns the types of the actions of the candidate that the state allows, in the order of `CANDIDATE_ACTION_TYPES`
 * (E19): a suspended session allows `resume` only, an ended one nothing; a running one allows the actions on the item
 * presented that its session allows, `move`, `end-part`, `end-test`, `suspend`, and `support` when a support is an
 * option. The rules are those of `Engine.apply`, which refuses every type left out.
 */
export function allowedActions(state: DeliveryState, rules: ItemRules | undefined): readonly CandidateAction["type"][] {
  if (state.status === "ended") return [];
  if (state.status === "suspended") return ["resume"];
  const allowed = new Set<CandidateAction["type"]>(["move", "end-part", "end-test", "suspend"]);
  if ([...state.supports.values()].some((support) => support.state === "option")) allowed.add("support");
  for (const type of rules === undefined ? [] : itemTypes(rules)) allowed.add(type);
  return CANDIDATE_ACTION_TYPES.filter((type) => allowed.has(type));
}
