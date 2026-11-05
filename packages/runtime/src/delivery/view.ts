import type { AssessmentItem, BodyNode, TestFeedback } from "../asi/index.js";
import { describe } from "../checks.js";
import { resolveContent, selectTestFeedback, selectTestRubricBlocks } from "../content/index.js";
import { DataError } from "../errors.js";
import type { CandidateView, SupportView, TimerView } from "./candidate-view.js";
import { partOfSection } from "./cat-session.js";
import type { Course } from "./course.js";
import { candidateOf } from "./course.js";
import { expiriesOf, maximumAt, minimumAt, runningScopes } from "./deadlines.js";
import { type DeliveryState, findDelivered } from "./delivery-state.js";
import { partModel, submissionModeOf } from "./modes.js";
import { type Placement, planIndex, type SectionInstance } from "./plan-index.js";
import { applyStep } from "./session-step.js";
import { allowedActions, type ItemRules, reviewActions } from "./view-actions.js";
import { candidateItem, packagePath } from "./view-item.js";
import { navigationOf, reviewNavigationOf } from "./view-navigation.js";

/** What resolution reads of an item for the content of a test: it declares no template variables. */
const NO_TEMPLATES: Pick<AssessmentItem, "templateDeclarations"> = { templateDeclarations: [] };

/**
 * Returns the state as it is at `now` for the candidate: the maximum times that passed are applied, each at its time,
 * as a `time` action would apply them. A suspended or ended session, and a time before the latest step, stay as they
 * are.
 */
function settled(course: Course, state: DeliveryState, now: number): DeliveryState {
  const step = applyStep(course, state, { type: "time", at: Math.max(now, state.at) });
  return step.ok ? step.state : state;
}

/**
 * Adds to the view of an ended session what a review shows: the items presented in every part, the actions `review` and
 * `solution`, and the item that is being reviewed, with its part, once there is one.
 */
function reviewing(course: Course, state: DeliveryState, ended: CandidateView): CandidateView {
  const reviewed = {
    ...ended,
    navigation: reviewNavigationOf(course, state),
    actions: reviewActions(course, state),
  };
  const { current } = state;
  if (current === undefined) return reviewed;
  const placement = planIndex(state.plan).placement(current);
  const delivered = findDelivered(state, current);
  const entry = course.items.get(current.ref);
  if (placement === undefined || delivered === undefined || entry === undefined) {
    throw new DataError(`The state does not present the item instance ${describe(current.ref)} ${current.instance}.`);
  }
  return {
    ...reviewed,
    part: {
      identifier: placement.part,
      navigationMode: partModel(course.structure, placement).navigationMode,
      submissionMode: submissionModeOf(course.structure, placement),
    },
    current: candidateItem(state, delivered, entry),
  };
}

/** Where the candidate is: the part and sections, and the placement of the item presented when there is one. */
interface Whereabouts {
  readonly part: string;
  readonly sections: readonly SectionInstance[];
  readonly placement?: Placement;
}

/**
 * Returns where the candidate is: at the item presented, else in the adaptive section whose first stage is awaited.
 *
 * @throws `DataError` when the state presents no item of its plan and awaits no section.
 */
function whereabouts(state: DeliveryState): Whereabouts {
  if (state.current !== undefined) {
    const placement = planIndex(state.plan).placement(state.current);
    if (placement === undefined) {
      throw new DataError("The state presents no item of its plan, though its test has not ended.");
    }
    return { part: placement.part, sections: placement.sections, placement };
  }
  const waiting = state.cat.find((session) => session.moving === true);
  const part = waiting === undefined ? undefined : partOfSection(state.plan, waiting.section, waiting.instance);
  if (waiting === undefined || part === undefined) {
    throw new DataError("The state presents no item of its plan, though its test has not ended.");
  }
  return { part, sections: [{ identifier: waiting.section, instance: waiting.instance }] };
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

/** Returns the time limits that run in a state that has been settled at its time. */
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
 * Builds the view of a state at `now`: the candidate view of the state after the maximum times that passed.
 *
 * @remarks
 * | Status        | The view …                                                                                                  |
 * | ------------- | ----------------------------------------------------------------------------------------------------------- |
 * | `in-progress` | has the item presented, the navigation map, the rubric, the `during` test feedback, the timers, the actions |
 * | `suspended`   | has no content, and `resume` as the only action                                                             |
 * | `ended`       | has the `atEnd` test feedback of the test and of the test parts the candidate entered, and no action        |
 *
 * With `reviewAfterEnd`, an `ended` view also lists the items presented in every part, offers `review` and `solution`
 * where an item allows them, and has the item being reviewed as `current`.
 */
export function candidateView(course: Course, original: DeliveryState, now: number): CandidateView {
  const state = settled(course, original, now);
  const { structure } = course;
  const test = structure.test.model;
  const base = {
    status: state.status,
    test: {
      identifier: test.identifier,
      title: test.title,
      stylesheets: [...new Set(test.stylesheets.map(({ href }) => packagePath(structure.test.base, href)))],
    },
    supports: supportViews(state),
  };
  if (state.status === "ended") {
    const entered = structure.test.parts.filter((part) =>
      state.clocks.some((clock) => clock.scope === "part" && clock.identifier === part.model.identifier),
    );
    const feedback = [test, ...entered.map((part) => part.model)].flatMap((holder) =>
      selectTestFeedback(holder.testFeedback, state.outcomes, "atEnd"),
    );
    const ended = {
      ...base,
      navigation: [],
      rubric: [],
      testFeedback: testContent(state, feedbackContent(feedback)),
      timers: [],
      actions: allowedActions(state, undefined),
    };
    return course.reviewAfterEnd ? reviewing(course, state, ended) : ended;
  }
  const where = whereabouts(state);
  const { placement } = where;
  const part = structure.part(where.part)?.model;
  const partView = {
    identifier: where.part,
    navigationMode: partModel(structure, where).navigationMode,
    // The items of an adaptive section are submitted one by one in either mode of the part.
    submissionMode: placement === undefined ? ("individual" as const) : submissionModeOf(structure, placement),
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
  const sections = where.sections.flatMap((each) => structure.section(each.identifier)?.model ?? []);
  const rubric = selectTestRubricBlocks(
    { test, ...(part === undefined ? {} : { part }), sections },
    "candidate",
  ).flatMap((block) => block.contentBody.children);
  const during = [test, ...(part === undefined ? [] : [part])].flatMap((holder) =>
    selectTestFeedback(holder.testFeedback, state.outcomes, "during"),
  );
  // No item is presented while the first stage of an adaptive section is awaited: the candidate sees the test part.
  if (placement === undefined) {
    return {
      ...base,
      part: partView,
      navigation: navigationOf(course, state, where),
      rubric: testContent(state, rubric),
      testFeedback: testContent(state, feedbackContent(during)),
      timers: timersOf(course, state),
      actions: allowedActions(state, undefined),
    };
  }
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
