import { checkOptions } from "../checks.js";
import { OlahError } from "../errors.js";
import { describeInteractions, initialResponse, shuffleChoices } from "../interactions/index.js";
import { createItemVariables, runTemplateProcessing } from "../processing/index.js";
import type { Value } from "../values/index.js";
import { endAttempt, itemEvent, startAttempt, timed } from "./attempt.js";
import {
  applied,
  checkSession,
  checkSessionContext,
  checkTime,
  type ItemSession,
  type ItemSessionContext,
  type ItemStep,
  regression,
} from "./item-session.js";
import { checkKey, type ItemKey } from "./plan.js";

/** The options of {@link startItemSession}. */
export interface StartItemSessionOptions {
  /**
   * The values of context variables, `QTI_CONTEXT` included, which are set before any processing (INFO §2.2.2.1). A
   * context variable left out has its default value, else NULL. Default: none.
   */
  readonly contextValues?: ReadonlyMap<string, Value | null>;
}

/**
 * Starts the session of an item instance, in the state `initial` (INFO §2.2.1). The variables start as
 * `createItemVariables` gives them, with the context values set (B6, B7, T21), and template processing runs once, so
 * that the session records the template values of its clone (INFO §2.7, B11, B59). When template processing fails, the
 * template variables keep their default values and the step reports `processing-failed` (E26).
 *
 * @param key - The item instance: the identifier of its item reference and its instance; for an item delivered alone,
 * such as `{ ref: item.identifier, instance: 1 }`.
 * @param at - The time, in epoch milliseconds.
 * @param context - The item, its control, and the source of the draws of template processing.
 * @param options - See {@link StartItemSessionOptions}.
 * @returns An accepted step.
 * @throws `DataError` when an argument has the wrong type, or a context value does not fit its declaration.
 * @throws `ProcessingError` when a declared value is not in the lexical form of its base type.
 */
export function startItemSession(
  key: ItemKey,
  at: number,
  context: ItemSessionContext,
  options: StartItemSessionOptions = {},
): ItemStep {
  checkKey(key);
  checkTime(at);
  checkSessionContext(context);
  checkOptions(options);
  const { contextValues = new Map<string, Value | null>() } = options;
  const { item } = context;
  const variables = createItemVariables(item, { context: contextValues });
  const session: ItemSession = {
    key: { ref: key.ref, instance: key.instance },
    status: "initial",
    attempting: false,
    countedAttempts: 0,
    variables,
    drafts: new Map(item.responseDeclarations.map(({ identifier }) => [identifier, null])),
    processingFailed: false,
    choiceOrders: new Map(),
    pciStates: new Map(),
    spent: 0,
    since: null,
    updatedAt: at,
  };
  try {
    return applied({ ...session, variables: runTemplateProcessing(item, variables, context) });
  } catch (error) {
    if (!(error instanceof OlahError)) throw error;
    return applied(session, [itemEvent(session, "processing-failed", at, error.message)]);
  }
}

/**
 * Draws the order of the choices of each interaction (INFO §5.30.1, B57), in document order. An order interaction whose
 * response starts from a default value keeps the order of the document, because the default gives the order (INFO
 * §2.4.1.2, B54).
 */
function drawChoiceOrders(session: ItemSession, context: ItemSessionContext): ItemSession["choiceOrders"] {
  const orders = new Map<string, readonly (readonly string[])[]>();
  for (const descriptor of describeInteractions(context.item)) {
    const { responseIdentifier } = descriptor;
    const preset =
      descriptor.kind === "order-interaction" &&
      initialResponse(descriptor, session.variables.defaults.get(responseIdentifier) ?? null) !== null;
    const sets = shuffleChoices(preset ? { ...descriptor, shuffle: false } : descriptor, context.random);
    if (sets.length > 0) orders.set(responseIdentifier, sets);
  }
  return orders;
}

/**
 * Presents the item to the candidate (INFO §2.2.1). The first presentation draws the order of the choices and starts the
 * first attempt: `numAttempts` becomes 1, the response variables take their default values, and `completionStatus`
 * becomes `unknown` (B3, B5, B6). A suspended session resumes. Either way the session is `interacting`, its time runs
 * (B4), and the step reports `presented`. A session that is interacting or closed stays as it is.
 *
 * @param at - The time, in epoch milliseconds.
 * @param context - The item, its control, and the source of the draws of shuffling.
 * @returns The step, or a refusal `clock-regression` when `at` is earlier than the latest change of the session.
 * @throws `DataError` when an argument has the wrong type.
 */
export function presentItem(session: ItemSession, at: number, context: ItemSessionContext): ItemStep {
  checkSession(session);
  checkTime(at);
  checkSessionContext(context);
  const refused = regression(session, at);
  if (refused !== undefined) return refused;
  switch (session.status) {
    case "initial": {
      const started = startAttempt({ ...session, choiceOrders: drawChoiceOrders(session, context) }, context.item);
      const presented: ItemSession = { ...started, status: "interacting", since: at, updatedAt: at };
      return applied(presented, [itemEvent(presented, "presented", at)]);
    }
    case "suspended": {
      const resumed: ItemSession = { ...session, status: "interacting", since: at, updatedAt: at };
      return applied(resumed, [itemEvent(resumed, "presented", at)]);
    }
    default:
      return applied(session);
  }
}

/**
 * Suspends an interacting session, as when the candidate moves to another item or the candidate session is suspended
 * (INFO §2.2.1): its time stops and `duration` shows the time spent (B4). An open attempt stays open with its drafts.
 * A session in another state stays as it is.
 *
 * @param at - The time, in epoch milliseconds.
 * @returns The step, or a refusal `clock-regression` when `at` is earlier than the latest change of the session.
 * @throws `DataError` when an argument has the wrong type.
 */
export function suspendItem(session: ItemSession, at: number): ItemStep {
  checkSession(session);
  checkTime(at);
  const refused = regression(session, at);
  if (refused !== undefined) return refused;
  if (session.status !== "interacting") return applied(session);
  return applied({ ...timed(session, at), status: "suspended", since: null });
}

/**
 * Closes the session, as at the end of a test part or when a time limit ends it (INFO §2.2.1, §2.5). An open attempt
 * ends with the drafts as its responses, without the checks of skipping and validity, and response processing runs. A
 * session that was never presented closes without an attempt, so its response variables stay NULL (B6). The time of
 * the session stops. A closed session stays as it is.
 *
 * @param at - The time, in epoch milliseconds.
 * @param context - The item, its control, and the processing.
 * @returns The step, or a refusal `clock-regression` when `at` is earlier than the latest change of the session.
 * @throws `DataError` when an argument has the wrong type.
 */
export function closeItem(session: ItemSession, at: number, context: ItemSessionContext): ItemStep {
  checkSession(session);
  checkTime(at);
  checkSessionContext(context);
  const refused = regression(session, at);
  if (refused !== undefined) return refused;
  switch (session.status) {
    case "initial":
      return applied({ ...session, status: "closed", updatedAt: at });
    case "interacting":
    case "suspended": {
      if (!session.attempting) return applied({ ...timed(session, at), status: "closed", since: null });
      const ended = endAttempt(session, at, { by: "close" }, context);
      return applied(ended.session, ended.events);
    }
    default:
      return applied(session);
  }
}
