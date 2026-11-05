import { checkString, describe } from "../checks.js";
import { checkOptionNames } from "../checks-internal.js";
import { AssesskitError, DataError } from "../errors.js";
import { describeInteractions } from "../interactions/index.js";
import { drawOrders, startingResponse } from "../interactions/internal.js";
import { createItemVariables, describeType, type ItemVariables, runTemplateProcessing } from "../processing/index.js";
import { fitValue } from "../processing/internal.js";
import { normalizeValue, type Value } from "../values/index.js";
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
   * The values of context variables, `QTI_CONTEXT` included, which are set before any processing. A context variable
   * left out has its default value, else NULL.
   *
   * @defaultValue none
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  readonly contextValues?: ReadonlyMap<string, Value | null>;
  /**
   * The default values that the test gives template variables in place of their declared ones, by identifier: the
   * values of the `qti-template-default`s of the item reference.
   *
   * @defaultValue none
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-template-default}
   */
  readonly templateDefaults?: ReadonlyMap<string, Value | null>;
}

const START_ITEM_SESSION_OPTIONS = ["contextValues", "templateDefaults"] as const;

/**
 * Returns the variables with the default values of template variables replaced, before template processing starts from
 * them.
 *
 * @throws `DataError` when a value names no template variable of the item, or does not fit its declaration.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function withTemplateDefaults(
  variables: ItemVariables,
  given: ReadonlyMap<string, Value | null>,
  item: ItemSessionContext["item"],
): ItemVariables {
  if (!(given instanceof Map)) {
    throw new DataError(
      `The option templateDefaults must be a Map from identifier to value, found ${describe(given)}.`,
    );
  }
  if (given.size === 0) return variables;
  const defaults = new Map(variables.defaults);
  const templates = new Map(variables.templates);
  for (const [identifier, value] of given) {
    checkString(identifier, "An identifier of the option templateDefaults");
    const declaration = item.templateDeclarations.find((each) => each.identifier === identifier);
    if (declaration === undefined) {
      throw new DataError(
        `The option templateDefaults gives ${describe(identifier)}, which the item declares no template variable for.`,
      );
    }
    const checked = value === null ? null : normalizeValue(value);
    const fitted = checked === null ? null : fitValue(checked, declaration);
    if (fitted === undefined) {
      throw new DataError(
        `The template variable ${identifier} is ${describeType(declaration)}, found ${describe(value)}.`,
      );
    }
    defaults.set(identifier, fitted);
    templates.set(identifier, fitted);
  }
  return { ...variables, defaults, templates };
}

/**
 * Starts the session of an item instance, in the state `initial`.
 *
 * @remarks
 * The variables start as `createItemVariables` gives them, with the context values set and the template defaults of the
 * test in place of the declared ones, and template processing runs once, so that the session records the template
 * values of its clone. When template processing fails, the template variables keep their default values and the step
 * reports `processing-failed`.
 *
 * @param key - The item instance: the identifier of its item reference and its instance; for an item delivered alone,
 * such as `{ ref: item.identifier, instance: 1 }`.
 * @param at - The time, in epoch milliseconds.
 * @param context - The item, its control, and the source of the draws of template processing.
 * @param options - See {@link StartItemSessionOptions}.
 * @returns An accepted step.
 * @throws `DataError` when an argument has the wrong type, or a context value or template default names no variable of
 * the item or does not fit its declaration.
 * @throws `ProcessingError` when a declared value is not in the lexical form of its base type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
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
  checkOptionNames(options, START_ITEM_SESSION_OPTIONS);
  const { contextValues = new Map<string, Value | null>(), templateDefaults = new Map<string, Value | null>() } =
    options;
  const { item } = context;
  const variables = withTemplateDefaults(createItemVariables(item, { context: contextValues }), templateDefaults, item);
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
    if (!(error instanceof AssesskitError)) throw error;
    return applied(session, [itemEvent(session, "processing-failed", at, error.message)]);
  }
}

/**
 * Draws the order of the choices of each interaction, in document order. An order interaction whose response starts
 * from a default value keeps the order of the document, because the default gives the order.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function drawChoiceOrders(session: ItemSession, context: ItemSessionContext): ItemSession["choiceOrders"] {
  const orders = new Map<string, readonly (readonly string[])[]>();
  for (const descriptor of describeInteractions(context.item)) {
    const { responseIdentifier } = descriptor;
    const preset =
      descriptor.kind === "order-interaction" &&
      startingResponse(descriptor, session.variables.defaults.get(responseIdentifier) ?? null) !== null;
    const sets = drawOrders(preset ? { ...descriptor, shuffle: false } : descriptor, context.random);
    if (sets.length > 0) orders.set(responseIdentifier, sets);
  }
  return orders;
}

/**
 * Presents the item to the candidate.
 *
 * @remarks
 * The first presentation draws the order of the choices and starts the first attempt: `numAttempts` becomes 1, the
 * response variables take their default values, and `completionStatus` becomes `unknown`. A suspended session resumes.
 * Either way the session is `interacting`, its time runs, and the step reports `presented`. A session that is
 * interacting or closed stays as it is.
 *
 * @param session - The item session.
 * @param at - The time, in epoch milliseconds.
 * @param context - The item, its control, and the source of the draws of shuffling.
 * @returns The step, or a refusal `clock-regression` when `at` is earlier than the latest change of the session.
 * @throws `DataError` when an argument has the wrong type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
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
 * Suspends an interacting session, as when the candidate moves to another item or the candidate session is suspended:
 * its time stops and `duration` shows the time spent.
 *
 * @remarks
 * An open attempt stays open with its drafts. A session in another state stays as it is.
 *
 * @param session - The item session.
 * @param at - The time, in epoch milliseconds.
 * @returns The step, or a refusal `clock-regression` when `at` is earlier than the latest change of the session.
 * @throws `DataError` when an argument has the wrong type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
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
 * Closes the session, as at the end of a test part or when a time limit ends it.
 *
 * @remarks
 * An open attempt ends with the drafts as its responses, without the checks of skipping and validity, and response
 * processing runs. A session that was never presented closes without an attempt, so its response variables stay NULL.
 * The time of the session stops. A closed session stays as it is.
 *
 * @param session - The item session.
 * @param at - The time, in epoch milliseconds.
 * @param context - The item, its control, and the processing.
 * @returns The step, or a refusal `clock-regression` when `at` is earlier than the latest change of the session.
 * @throws `DataError` when an argument has the wrong type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
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
