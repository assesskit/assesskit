import type { AssessmentItem, BodyNode, TestFeedback } from "../asi/index.js";
import { describe } from "../checks.js";
import { resolveContent, testRubricBlocks, visibleTestFeedback } from "../content/index.js";
import { DataError } from "../errors.js";
import type { CandidateView, SupportView, TimerView } from "./candidate-view.js";
import type { Course } from "./course.js";
import { candidateOf } from "./course.js";
import { expiriesOf, maximumAt, minimumAt, runningScopes } from "./deadlines.js";
import { type DeliveryState, findDelivered } from "./delivery-state.js";
import { partModel, submissionModeOf } from "./modes.js";
import { planIndex } from "./plan-index.js";
import { SessionStep } from "./session-step.js";
import { allowedActions, type ItemRules } from "./view-actions.js";
import { candidateItem } from "./view-item.js";
import { navigationOf } from "./view-navigation.js";

/** What resolution reads of an item for the content of a test: it declares no template variables. */
const NO_TEMPLATES: Pick<AssessmentItem, "templateDeclarations"> = { templateDeclarations: [] };

/**
 * Returns the state as it is at `now` for the candidate: the maximum times that passed are applied, each at its time
 * (E7), as a `time` action would apply them. A suspended or ended session, and a time before the latest step, stay as
 * they are.
 */
function settled(course: Course, state: DeliveryState, now: number): DeliveryState {
  const step = new SessionStep(course, state);
  const refused = step.apply({ type: "time", at: Math.max(now, state.at) });
  const done = step.done();
  return refused === undefined && done.ok ? done.state : state;
}

/** Returns the supports as the candidate sees them; the settings of a prohibited support stay out. */
function supportViews(state: DeliveryState): SupportView[] {
  return [...state.supports].map(([name, support]) => ({
    name,
    state: support.state,
    active: support.active,
    ...(support.settings === undefined || support.state === "prohibited" ? {} : { settings: support.settings }),
  }));
}

/** Returns the time limits that run in a state that has been settled at its time (E6, E7). */
function timersOf(course: Course, state: DeliveryState): TimerView[] {
  return runningScopes(course, state).flatMap((scope): TimerView[] => {
    const maximum = scope.expired === "closed" ? undefined : maximumAt(scope, state.at);
    const minimum = minimumAt(scope, state.at);
    if (maximum === undefined && minimum === undefined) return [];
    return [
      {
        scope: scope.scope,
        identifier: scope.identifier,
        ...(maximum === undefined ? {} : { remaining: Math.max(0, maximum - state.at) }),
        ...(minimum === undefined ? {} : { minimumRemaining: minimum - state.at }),
        late: scope.expired === "late",
      },
    ];
  });
}

/** Returns the content of the shown test feedback and rubric as the candidate sees it. */
function testContent(state: DeliveryState, nodes: readonly BodyNode[]): readonly BodyNode[] {
  return resolveContent(nodes, { outcomes: state.outcomes, templates: new Map() }, NO_TEMPLATES, {
    view: "candidate",
  });
}

const feedbackContent = (feedback: readonly TestFeedback[]): BodyNode[] =>
  feedback.flatMap((each) => each.contentBody?.children ?? []);

/**
 * Builds the view of a state at `now` (E19): the candidate view of the state after the maximum times that passed.
 *
 * | Status        | The view …                                                                                           |
 * | ------------- | ---------------------------------------------------------------------------------------------------- |
 * | `in-progress` | has the item presented, the navigation map, the rubric, the `during` test feedback, the timers, the actions |
 * | `suspended`   | has no content, and `resume` as the only action                                                      |
 * | `ended`       | has the `atEnd` test feedback of the test and of the test parts the candidate entered, and no action |
 */
export function candidateView(course: Course, original: DeliveryState, now: number): CandidateView {
  const state = settled(course, original, now);
  const { structure } = course;
  const test = structure.test.model;
  const base = {
    status: state.status,
    test: { identifier: test.identifier, title: test.title },
    supports: supportViews(state),
  };
  if (state.status === "ended") {
    const entered = structure.test.parts.filter((part) =>
      state.clocks.some((clock) => clock.scope === "part" && clock.identifier === part.model.identifier),
    );
    const feedback = [test, ...entered.map((part) => part.model)].flatMap((holder) =>
      visibleTestFeedback(holder.testFeedback, state.outcomes, "atEnd"),
    );
    return {
      ...base,
      navigation: [],
      rubric: [],
      testFeedback: testContent(state, feedbackContent(feedback)),
      timers: [],
      actions: allowedActions(state, undefined),
    };
  }
  const placement = state.current === undefined ? undefined : planIndex(state.plan).placement(state.current);
  if (placement === undefined)
    throw new DataError("The state presents no item of its plan, though its test has not ended.");
  const part = structure.part(placement.part)?.model;
  const partView = {
    identifier: placement.part,
    navigationMode: partModel(structure, placement).navigationMode,
    submissionMode: submissionModeOf(structure, placement),
  };
  if (state.status === "suspended") {
    return {
      ...base,
      part: partView,
      navigation: [],
      rubric: [],
      testFeedback: [],
      timers: [],
      actions: allowedActions(state, undefined),
    };
  }
  const sections = placement.sections.flatMap((each) => structure.section(each.identifier)?.model ?? []);
  const rubric = testRubricBlocks({ test, ...(part === undefined ? {} : { part }), sections }, "candidate").flatMap(
    (block) => block.contentBody.children,
  );
  const during = [test, ...(part === undefined ? [] : [part])].flatMap((holder) =>
    visibleTestFeedback(holder.testFeedback, state.outcomes, "during"),
  );
  const delivered = findDelivered(state, placement.key);
  const entry = course.items.get(placement.key.ref);
  if (delivered === undefined || entry === undefined) {
    throw new DataError(
      `The state does not present the item instance ${describe(placement.key.ref)} ${placement.key.instance}.`,
    );
  }
  const rules: ItemRules = {
    delivered,
    item: candidateOf(entry, delivered.variant).item,
    control: entry.control,
    submission: partView.submissionMode,
    closedByTime: expiriesOf(structure, state, placement).includes("closed"),
  };
  return {
    ...base,
    part: partView,
    navigation: navigationOf(course, state, placement),
    current: candidateItem(state, delivered, entry),
    rubric: testContent(state, rubric),
    testFeedback: testContent(state, feedbackContent(during)),
    timers: timersOf(course, state),
    actions: allowedActions(state, rules),
  };
}
