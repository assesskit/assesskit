import type { CandidateAction, CandidateView } from "@assesskit/runtime/delivery";
import type { Messages } from "../../messages/index.js";

/** What the candidate must confirm before the action (WCAG 3.3.4). */
export type Confirmation = "submit" | "end-part" | "end-test";

/** The group of the actions a button belongs to. */
type ActionGroup = "navigate" | "answer" | "session";

/** A button of the chrome: what it says, what it sends and whether it asks first. */
export interface PlannedAction {
  /** Names the button for the focus and for tests. */
  readonly id: string;
  /** The message that labels the button. */
  readonly label: keyof Messages;
  /** The action it sends. */
  readonly action: CandidateAction;
  /** What the candidate confirms first. Default: nothing. */
  readonly confirm?: Confirmation;
  /** Whether the button cannot be pressed. Default: `false`. */
  readonly disabled?: boolean;
  /** The group of the button. */
  readonly group: ActionGroup;
}

/** The buttons that act on the item presented, by the type of action that makes them. */
const ANSWER_ACTIONS = [
  ["submit", "actionSubmit"],
  ["skip", "actionSkip"],
  ["next-attempt", "actionNextAttempt"],
  ["review", "actionReview"],
  ["solution", "actionSolution"],
] as const satisfies readonly (readonly [CandidateAction["type"], keyof Messages])[];

/** The buttons that move: back in a nonlinear part, and on, which stops at the last item of a nonlinear part. */
function navigateActions(view: CandidateView, linear: boolean): PlannedAction[] {
  const items = view.navigation.filter((entry) => entry.kind === "item");
  const at = items.findIndex((entry) => entry.current);
  if (!view.actions.includes("move") || !(items.length > 1 || linear)) return [];
  const next: PlannedAction = {
    id: "next",
    label: "actionNext",
    action: { type: "move", to: "next" },
    disabled: !linear && at === items.length - 1,
    group: "navigate",
  };
  if (linear) return [next];
  const previous: PlannedAction = {
    id: "previous",
    label: "actionPrevious",
    action: { type: "move", to: "previous" },
    disabled: at <= 0,
    group: "navigate",
  };
  return [previous, next];
}

/** The buttons that submit, skip, repeat, review or show the solution of the item presented. */
function answerActions(view: CandidateView, linear: boolean): PlannedAction[] {
  const { current } = view;
  if (current === undefined) return [];
  return ANSWER_ACTIONS.filter(([type]) => view.actions.includes(type)).map(([type, label]) => ({
    id: type,
    label,
    action: { type, item: current.key },
    group: "answer",
    ...(type === "submit" && linear ? { confirm: "submit" as const } : {}),
  }));
}

/** The buttons that end a part or the test, or pause and resume it. */
function sessionActions(view: CandidateView): PlannedAction[] {
  const planned: PlannedAction[] = [];
  const has = (type: CandidateAction["type"]): boolean => view.actions.includes(type);
  if (has("end-part")) {
    planned.push({
      id: "end-part",
      label: "actionEndPart",
      action: { type: "end-part" },
      confirm: "end-part",
      group: "session",
    });
  }
  if (has("end-test")) {
    planned.push({
      id: "end-test",
      label: "actionEndTest",
      action: { type: "end-test" },
      confirm: "end-test",
      group: "session",
    });
  }
  if (has("suspend"))
    planned.push({ id: "suspend", label: "actionSuspend", action: { type: "suspend" }, group: "session" });
  if (has("resume"))
    planned.push({ id: "resume", label: "actionResume", action: { type: "resume" }, group: "session" });
  return planned;
}

/**
 * Plans the buttons of a view (T55): one for each type of action that `view.actions` lists and that a button can send. The
 * list is the engine's allowance, which the session host has already narrowed by its client-action policy, so a button
 * for `suspend` exists only where the host lets the candidate pause (F-M3). `set-responses` and `end-attempt` have no
 * button here: the interactions send them, and `comment` and `support` have controls of their own.
 *
 * Moving back is offered only in a nonlinear part, and moving on stops at the last item of a nonlinear part. Submitting in
 * a linear part, and ending a part or the test, ask the candidate to confirm (WCAG 3.3.4); in a nonlinear part the
 * candidate can review before submitting.
 */
export function planActions(view: CandidateView): readonly PlannedAction[] {
  const linear = view.part?.navigationMode === "linear";
  return [...navigateActions(view, linear), ...answerActions(view, linear), ...sessionActions(view)];
}

/**
 * Returns the sentences of the question that asks the candidate to confirm an action (WCAG 3.3.4): what the action does,
 * for a part that submits all its answers at its end that they go together (B27), and how many questions have an attempt
 * open and so are not submitted yet (T56).
 */
export function confirmationText(kind: Confirmation, view: CandidateView, messages: Messages): readonly string[] {
  if (kind === "submit") return [messages.confirmSubmit];
  const open = view.navigation.filter((entry) => entry.kind === "item" && entry.status === "interacting").length;
  return [
    kind === "end-part" ? messages.confirmEndPart : messages.confirmEndTest,
    ...(view.part?.submissionMode === "simultaneous" ? [messages.confirmSimultaneous] : []),
    ...(open > 0 ? [`${messages.confirmUnsubmitted}: ${open}`] : []),
  ];
}
