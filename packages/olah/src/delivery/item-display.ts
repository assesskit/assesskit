import { type AssessmentItem, descendantNodes, type Interaction, isModelNode, type ModelNode } from "../asi/index.js";
import { isShown, resolveContent } from "../content/index.js";
import { describeInteractions, type InteractionDescriptor, presentChoices } from "../interactions/index.js";
import { checkItem } from "../processing/variables.js";
import type { Value } from "../values/index.js";
import { isAdaptive, resetOutcomes } from "./attempt.js";
import { checkSession, type ItemSession } from "./item-session.js";
import { checkSessionControl, type EffectiveSessionControl } from "./session-control.js";

/** What decides the feedback that an item shows in the state of its session. */
export interface ItemFeedback {
  /**
   * The outcomes that decide which integrated feedback the body shows: those of the session when its feedback is
   * shown, else the values that response processing starts from, which show the body as at the start of an attempt
   * (INFO §7.19.3).
   */
  readonly outcomes: ReadonlyMap<string, Value | null>;
  /** Whether the item shows the modal feedback that the outcomes select (INFO §2.6). */
  readonly modal: boolean;
}

/** Whether the session shows the feedback of its outcomes, and whether the modal feedback with it. */
function feedbackShown(
  session: ItemSession,
  adaptive: boolean,
  control: EffectiveSessionControl,
): { readonly shown: boolean; readonly modal: boolean } {
  switch (session.status) {
    case "initial":
      return { shown: false, modal: false };
    case "interacting":
    case "suspended":
      // Between attempts the feedback is shown (INFO §7.19.1); during an attempt an adaptive item keeps the feedback of
      // its earlier attempts, and a non-adaptive item shows its body as at the start of the attempt (INFO §7.19.3).
      return session.attempting ? { shown: adaptive, modal: false } : { shown: true, modal: true };
    case "closed":
      return { shown: control.showFeedback, modal: control.showFeedback };
    case "review":
    case "solution": {
      // An adaptive item ignores show-feedback when review is allowed and shows its final outcomes (INFO §7.19.3, B95).
      const shown = control.showFeedback || (adaptive && control.allowReview);
      return { shown, modal: shown };
    }
  }
}

/** Returns the outcomes that decide the feedback the session shows, and whether modal feedback shows. */
function feedbackOf(session: ItemSession, item: AssessmentItem, control: EffectiveSessionControl): ItemFeedback {
  const { shown, modal } = feedbackShown(session, isAdaptive(item), control);
  return { outcomes: shown ? session.variables.outcomes : resetOutcomes(item, session.variables).outcomes, modal };
}

/**
 * Returns what decides the feedback that an item shows in the state of its session (INFO §2.5, §7.19.1–3, B16, B95):
 *
 * | State                         | Feedback shown                                                              |
 * | ----------------------------- | --------------------------------------------------------------------------- |
 * | `initial`                     | none                                                                        |
 * | an attempt open               | integrated feedback of the earlier attempts for an adaptive item; none else |
 * | between attempts              | all, modal included: an item with more attempts must show its feedback      |
 * | `closed`                      | all when `show-feedback` is true, else none                                 |
 * | `review`, `solution`          | all when `show-feedback` is true, or the item is adaptive and review is allowed; else none |
 *
 * Feedback that is not shown is decided by the values that response processing starts from, so that the body appears
 * as at the start of an attempt.
 *
 * @param session - The item session.
 * @param item - The item of the session.
 * @param control - The item session control in force.
 * @throws `DataError` when an argument has the wrong type.
 */
export function itemFeedback(
  session: ItemSession,
  item: AssessmentItem,
  control: EffectiveSessionControl,
): ItemFeedback {
  checkSession(session);
  checkItem(item);
  checkSessionControl(control);
  return feedbackOf(session, item, control);
}

const isInteraction = (node: ModelNode): node is Interaction => node.kind.endsWith("-interaction");

/**
 * Returns the interactions that the candidate sees in the state of the session: those of the body that feedback and
 * template content shown by {@link itemFeedback} hold (INFO §2.3.4), with the choices in the order of the session and
 * those that template variables hide left out (INFO §2.7.1, B14).
 */
export function presentedInteractions(
  session: ItemSession,
  item: AssessmentItem,
  control: EffectiveSessionControl,
): readonly InteractionDescriptor[] {
  if (item.body === undefined) return [];
  const { templates } = session.variables;
  const { outcomes } = feedbackOf(session, item, control);
  const shown = new Set(
    resolveContent(item.body.children, { outcomes, templates }, item, { view: "candidate" })
      .filter(isModelNode)
      .flatMap((node) => [node, ...descendantNodes(node)])
      .filter(isInteraction)
      .map((node) => node.responseIdentifier),
  );
  return describeInteractions(item)
    .filter((descriptor) => shown.has(descriptor.responseIdentifier))
    .map((descriptor) => {
      const orders = session.choiceOrders.get(descriptor.responseIdentifier);
      if (orders === undefined) return descriptor;
      const visible = new Set(
        descriptor.choices
          .filter(
            (choice) =>
              choice.templateIdentifier === undefined ||
              isShown(choice.showHide, choice.identifier, templates.get(choice.templateIdentifier) ?? null),
          )
          .map((choice) => choice.identifier),
      );
      return presentChoices(
        descriptor,
        orders.map((set) => set.filter((identifier) => visible.has(identifier))),
      );
    });
}

/**
 * Returns the responses that the item shows, by response identifier: the drafts while the session is open, the
 * submitted responses when it is closed or in review, and in the solution state the correct responses, NULL for a
 * variable that declares none (INFO §2.2.1, B58). The responses of the session do not change.
 *
 * @throws `DataError` when `session` is not an item session.
 */
export function itemResponses(session: ItemSession): ReadonlyMap<string, Value | null> {
  checkSession(session);
  const { drafts, variables } = session;
  switch (session.status) {
    case "closed":
    case "review":
      return new Map([...drafts.keys()].map((identifier) => [identifier, variables.responses.get(identifier) ?? null]));
    case "solution":
      return new Map(
        [...drafts.keys()].map((identifier) => [identifier, variables.correctResponses.get(identifier) ?? null]),
      );
    default:
      return drafts;
  }
}
