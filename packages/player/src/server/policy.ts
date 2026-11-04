import { checkArray, checkChoice, describe } from "@assesskit/runtime/checks";
import type { DeliveryState } from "@assesskit/runtime/delivery";
import type { CandidateAction } from "@assesskit/runtime/delivery/wire";
import { DataError } from "@assesskit/runtime/errors";

/** The type of an action of the candidate. */
export type CandidateActionType = CandidateAction["type"];

/** Every type of action of the candidate, in the order of the runtime's view. */
export const CANDIDATE_ACTION_TYPES = [
  "set-responses",
  "submit",
  "end-attempt",
  "next-attempt",
  "skip",
  "review",
  "solution",
  "comment",
  "mark",
  "move",
  "support",
  "support-settings",
  "end-part",
  "end-test",
  "suspend",
  "resume",
] as const satisfies readonly CandidateActionType[];

/**
 * The actions a client of an exam may send: all but `suspend` and `resume`. The runtime counts suspended time nowhere, so a
 * candidate who could suspend would stop the clock; breaks are the proctor's, through `SessionHost.proctor`.
 */
export const EXAM_CLIENT_ACTIONS: readonly CandidateActionType[] = CANDIDATE_ACTION_TYPES.filter(
  (type) => type !== "suspend" && type !== "resume",
);

/**
 * Returns the actions a client of a session may send: those of the policy, and `suspend` and `resume` for a candidate whose
 * profile has breaks, the support `environment` with `breaks` on.
 *
 * @remarks
 * Such a candidate may pause the assessment to take a break and return to it without losing a response or time: a suspended
 * session keeps every response, and its clocks stop.
 *
 * @param policy - The actions of the policy of the host.
 * @param state - The state of the session.
 * @returns The actions.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/conf/ | QTI 3.0 Conformance and Certification, A-11}
 */
export function withBreaks(
  policy: ReadonlySet<CandidateActionType>,
  state: DeliveryState,
): ReadonlySet<CandidateActionType> {
  const environment = state.supports.get("environment");
  const settings = environment?.active === true ? environment.settings : undefined;
  if (settings?.name !== "environment" || settings.breaks !== true) return policy;
  return new Set<CandidateActionType>([...policy, "suspend", "resume"]);
}

/**
 * Checks a list of the types of actions a client may send.
 *
 * @throws `DataError` when it is not an array of types of actions of the candidate.
 */
export function readClientActions(actions: unknown): ReadonlySet<CandidateActionType> {
  checkArray(actions, "The option clientActions must be an array");
  const types: CandidateActionType[] = [];
  for (const type of actions) {
    checkChoice(type, "A type of the option clientActions", CANDIDATE_ACTION_TYPES);
    types.push(type);
  }
  return new Set(types);
}

/**
 * Checks that the policy allows a client to send an action.
 *
 * @throws `DataError` when it does not.
 */
export function checkClientAction(policy: ReadonlySet<CandidateActionType>, type: CandidateActionType): void {
  if (policy.has(type)) return;
  throw new DataError(
    `A client may not send the action ${describe(type)} in this session; the actions it may send are ${[...policy].map((allowed) => JSON.stringify(allowed)).join(", ")}.`,
  );
}
