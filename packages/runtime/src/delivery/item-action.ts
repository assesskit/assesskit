import type { AssessmentItem, ResponseDeclaration } from "../asi/index.js";
import { checkChoice, checkRecord, checkString, describe, isRecord } from "../checks.js";
import { describeInteractions, validateResponse } from "../interactions/index.js";
import { describeType } from "../processing/index.js";
import { fitValue } from "../processing/internal.js";
import { matchValues, normalizeValue, type Value } from "../values/index.js";
import { type Ending, endAttempt, endAttemptInteractions, itemEvent, startAttempt } from "./attempt.js";
import { checkResponseMaps } from "./candidate-actions.js";
import { presentedInteractions } from "./item-display.js";
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
import { checkKey, type ItemKey, sameKey } from "./plan.js";
import { refuse } from "./refusal.js";

/**
 * An action of the candidate on an item:
 *
 * | Type            | The candidate …                                                                     |
 * | --------------- | ----------------------------------------------------------------------------------- |
 * | `set-responses` | enters responses, the drafts, and the opaque states of portable custom interactions |
 * | `submit`        | ends the attempt with the drafts as responses                                       |
 * | `skip`          | ends the attempt without a response: every response variable is NULL                |
 * | `end-attempt`   | ends the attempt with the end attempt interaction bound to `interaction`            |
 * | `next-attempt`  | starts the next attempt after the feedback of the last one                          |
 * | `review`        | reviews the closed item                                                             |
 * | `solution`      | sees the solution of the closed item                                                |
 * | `comment`       | comments on the item                                                                |
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export type ItemAction =
  | {
      /** Enters responses. */
      readonly type: "set-responses";
      /** The item instance. */
      readonly item: ItemKey;
      /** The responses by response identifier, NULL as `null`. */
      readonly responses: ReadonlyMap<string, Value | null>;
      /**
       * The opaque state of each portable custom interaction, by response identifier.
       *
       * @defaultValue none
       */
      readonly pciStates?: ReadonlyMap<string, string>;
    }
  | {
      /** Submits, skips, starts the next attempt, reviews or asks for the solution. */
      readonly type: "submit" | "skip" | "next-attempt" | "review" | "solution";
      /** The item instance. */
      readonly item: ItemKey;
    }
  | {
      /** Ends the attempt with an end attempt interaction. */
      readonly type: "end-attempt";
      /** The item instance. */
      readonly item: ItemKey;
      /** The response identifier of the end attempt interaction. */
      readonly interaction: string;
    }
  | {
      /** Comments on the item. */
      readonly type: "comment";
      /** The item instance. */
      readonly item: ItemKey;
      /** The comment, which replaces an earlier one. */
      readonly text: string;
    };

/** The types of the actions on an item. */
export const ITEM_ACTION_TYPES: readonly ItemAction["type"][] = [
  "set-responses",
  "submit",
  "skip",
  "end-attempt",
  "next-attempt",
  "review",
  "solution",
  "comment",
];

/** The actions that change or submit responses, which a closed session refuses. */
const RESPONDING: ReadonlySet<ItemAction["type"]> = new Set(["set-responses", "submit", "skip", "end-attempt"]);

/**
 * The base types whose values are integers, which the runtime holds as safe integers.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
const INTEGER_BASE_TYPES: ReadonlySet<unknown> = new Set(["integer", "point"]);

/**
 * Whether a primitive of a base type, before it is checked, is or holds an integer beyond the safe integers.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
function isUnsafe(baseType: unknown, primitive: unknown): boolean {
  return (
    INTEGER_BASE_TYPES.has(baseType) &&
    [primitive].flat().some((part) => Number.isInteger(part) && !Number.isSafeInteger(part))
  );
}

/**
 * Whether a value, before it is checked, holds an integer beyond the safe integers.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
function holdsUnsafeInteger(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.fields instanceof Map) {
    return [...value.fields.values()].some((field) => isRecord(field) && isUnsafe(field.baseType, field.value));
  }
  if (Array.isArray(value.values)) return value.values.some((entry) => isUnsafe(value.baseType, entry));
  return isUnsafe(value.baseType, value.value);
}

/**
 * Checks the fields of an action on an item that its type has.
 *
 * @throws `DataError` when it is not such an action.
 */
export function checkItemAction(action: unknown): asserts action is ItemAction & { readonly at: number } {
  checkRecord(action, "The action must be an object with a type, an item and a time");
  checkChoice(action.type, "The type of the action", ITEM_ACTION_TYPES);
  checkKey(action.item);
  checkTime(action.at);
  if (action.type === "set-responses") checkResponseMaps(action);
  if (action.type === "end-attempt") checkString(action.interaction, "The interaction of end-attempt");
  if (action.type === "comment") checkString(action.text, "The text of comment");
}

/** Returns the session with an attempt open: the candidate starts the next attempt by acting on the item. */
function open(session: ItemSession, item: AssessmentItem): ItemSession {
  return session.attempting ? session : startAttempt(session, item);
}

/** Ends the attempt and returns the step. */
function ended(session: ItemSession, at: number, ending: Ending, context: ItemSessionContext): ItemStep {
  const step = endAttempt(session, at, ending, context);
  return applied(step.session, step.events);
}

/** The response variables that the candidate sets: those declared, except the variables of end attempt interactions. */
function candidateResponses(item: AssessmentItem): ReadonlyMap<string, ResponseDeclaration> {
  const endAttempts = endAttemptInteractions(item);
  return new Map(
    item.responseDeclarations
      .filter(({ identifier }) => !endAttempts.has(identifier))
      .map((declaration) => [declaration.identifier, declaration]),
  );
}

/**
 * Checks the responses of `set-responses` against the declarations. Returns them as the variables hold them, or the
 * refusal of the first that does not fit.
 */
function acceptResponses(
  responses: ReadonlyMap<string, Value | null>,
  item: AssessmentItem,
): Map<string, Value | null> | ItemStep {
  const declarations = candidateResponses(item);
  const accepted = new Map<string, Value | null>();
  for (const [identifier, given] of responses) {
    checkString(identifier, "A response identifier of set-responses");
    const declaration = declarations.get(identifier);
    if (declaration === undefined) {
      return refuse(
        "invalid-response",
        `The item has no response variable ${describe(identifier)} that the candidate sets.`,
      );
    }
    if (holdsUnsafeInteger(given)) {
      return refuse(
        "value-out-of-range",
        `The response ${describe(identifier)} holds an integer outside the safe integers.`,
      );
    }
    if (given === null) {
      accepted.set(identifier, null);
      continue;
    }
    const value = normalizeValue(given);
    const fitted = fitValue(value, declaration);
    if (fitted === undefined) {
      return refuse(
        "invalid-response",
        `The response variable ${identifier} is ${describeType(declaration)}, found ${describeType(value)}.`,
      );
    }
    accepted.set(identifier, fitted);
  }
  return accepted;
}

/** Checks the PCI states of `set-responses`: each belongs to a portable custom interaction of the item. */
function acceptPciStates(states: ReadonlyMap<string, string>, item: AssessmentItem): ItemStep | undefined {
  const portable = new Set(
    describeInteractions(item)
      .filter((descriptor) => descriptor.kind === "portable-custom-interaction")
      .map((descriptor) => descriptor.responseIdentifier),
  );
  for (const [identifier, state] of states) {
    checkString(identifier, "A response identifier of the pciStates of set-responses");
    checkString(state, `The PCI state of ${describe(identifier)}`);
    if (!portable.has(identifier)) {
      return refuse(
        "invalid-response",
        `The item has no portable custom interaction bound to ${describe(identifier)}.`,
      );
    }
  }
  return undefined;
}

function setResponses(
  session: ItemSession,
  action: Extract<ItemAction, { type: "set-responses" }> & { readonly at: number },
  context: ItemSessionContext,
): ItemStep {
  const { item } = context;
  const responses = acceptResponses(action.responses, item);
  if (!(responses instanceof Map)) return responses;
  const { pciStates = new Map<string, string>() } = action;
  const refused = acceptPciStates(pciStates, item);
  if (refused !== undefined) return refused;
  const opened = open(session, item);
  const next: ItemSession = {
    ...opened,
    drafts: new Map([...opened.drafts, ...responses]),
    pciStates: new Map([...opened.pciStates, ...pciStates]),
    updatedAt: action.at,
  };
  return applied(next, [itemEvent(next, "responses-set", action.at)]);
}

/**
 * Whether drafts submitted would skip the item: every response the candidate sets is NULL or its default value. An item
 * without such responses cannot be skipped.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function isSkip(
  drafts: ReadonlyMap<string, Value | null>,
  defaults: ReadonlyMap<string, Value | null>,
  item: AssessmentItem,
): boolean {
  const identifiers = [...candidateResponses(item).keys()];
  return (
    identifiers.length > 0 &&
    identifiers.every((identifier) => {
      const draft = drafts.get(identifier) ?? null;
      const preset = defaults.get(identifier) ?? null;
      return draft === null || (preset !== null && matchValues(draft, preset));
    })
  );
}

const SKIPPING_NOT_ALLOWED = refuse(
  "skipping-not-allowed",
  "The item does not allow skipping: a response other than the default value must be given before it is submitted.",
);

/**
 * Returns the response identifiers of the visible interactions whose drafts are not valid.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function invalidResponses(session: ItemSession, context: ItemSessionContext): readonly string[] {
  return presentedInteractions(session, context.item, context.control)
    .filter(
      (descriptor) =>
        descriptor.kind !== "end-attempt-interaction" &&
        validateResponse(descriptor, session.drafts.get(descriptor.responseIdentifier) ?? null).reasons.length > 0,
    )
    .map((descriptor) => descriptor.responseIdentifier);
}

function submit(session: ItemSession, at: number, context: ItemSessionContext): ItemStep {
  const opened = open(session, context.item);
  if (!context.control.allowSkipping && isSkip(opened.drafts, opened.variables.defaults, context.item)) {
    return SKIPPING_NOT_ALLOWED;
  }
  if (context.control.validateResponses) {
    const invalid = invalidResponses(opened, context);
    if (invalid.length > 0) {
      return refuse(
        "invalid-response",
        `The responses ${invalid.map((identifier) => describe(identifier)).join(", ")} are not valid, and the item session control validates responses.`,
      );
    }
  }
  return ended(opened, at, { by: "submit" }, context);
}

function skip(session: ItemSession, at: number, context: ItemSessionContext): ItemStep {
  const { item } = context;
  // A skip submits NULL responses, so it skips any item that has responses the candidate sets.
  if (!context.control.allowSkipping && candidateResponses(item).size > 0) return SKIPPING_NOT_ALLOWED;
  const opened = open(session, item);
  const drafts = new Map([...opened.drafts.keys()].map((identifier) => [identifier, null]));
  return ended({ ...opened, drafts }, at, { by: "skip" }, context);
}

function endWith(session: ItemSession, at: number, interaction: string, context: ItemSessionContext): ItemStep {
  if (!endAttemptInteractions(context.item).has(interaction)) {
    return refuse("invalid-response", `The item has no end attempt interaction bound to ${describe(interaction)}.`);
  }
  return ended(open(session, context.item), at, { by: "end-attempt", interaction }, context);
}

/**
 * Enters the review or solution state of a closed session, when the control allows it.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function revisit(session: ItemSession, at: number, to: "review" | "solution", allowed: boolean): ItemStep {
  const reason = to === "review" ? "review-not-allowed" : "solution-not-allowed";
  if (session.status === "interacting") {
    return refuse(reason, `The item shows its ${to} only after its session closed.`);
  }
  if (!allowed) return refuse(reason, `The item session control does not allow the ${to} of the item.`);
  return applied({ ...session, status: to, updatedAt: at });
}

/**
 * Applies an action of the candidate to an item session.
 *
 * @remarks
 * Responses go to the drafts; an attempt ends with `submit`, `skip` or `end-attempt`, and its response processing runs.
 * An action on a session between attempts starts the next attempt first, which `next-attempt` does alone;
 * `next-attempt` during an attempt changes nothing.
 *
 * | Rule                                                                                                                              | Refusal                                                  |
 * | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
 * | the action names another item instance                                                                                            | `unknown-item`                                           |
 * | the action is earlier than the session's latest change                                                                            | `clock-regression`                                       |
 * | the item has not been presented                                                                                                   | `not-current`                                            |
 * | the session is suspended                                                                                                          | `suspended`                                              |
 * | responses of a closed session                                                                                                     | `item-closed`; `next-attempt` gives `attempts-exhausted` |
 * | a variable the candidate does not set, a value of another type, or no such end attempt interaction or PCI                         | `invalid-response`                                       |
 * | an integer outside the safe integers                                                                                              | `value-out-of-range`                                     |
 * | `submit` or `skip` with only NULL or default responses under `allow-skipping="false"`; an item without responses is never skipped | `skipping-not-allowed`                                   |
 * | `submit` with a visible interaction's response invalid under `validate-responses="true"`                                          | `invalid-response`                                       |
 * | `review` before the session closed, or without `allow-review`                                                                     | `review-not-allowed`                                     |
 * | `solution` before the session closed, or without `show-solution`                                                                  | `solution-not-allowed`                                   |
 * | `comment` without `allow-comment`                                                                                                 | `comment-not-allowed`                                    |
 *
 * `end-attempt` is a request of the candidate that ends the attempt at once, typically for a hint: its response is not
 * a skip, and validity is not checked. The checks of skipping and validity apply to submissions in an individual test
 * part, which is the only place where the candidate submits an item.
 *
 * @param session - The item session.
 * @param action - The action, with its time in epoch milliseconds.
 * @param context - The item, its control, and the processing.
 * @returns The new session and its events, or a refusal; the session given does not change.
 * @throws `DataError` when an argument has the wrong type, or a response is not a value.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function applyItemAction(
  session: ItemSession,
  action: ItemAction & { readonly at: number },
  context: ItemSessionContext,
): ItemStep {
  checkSession(session);
  checkItemAction(action);
  checkSessionContext(context);
  const { at } = action;
  if (!sameKey(action.item, session.key)) {
    return refuse(
      "unknown-item",
      `The action names the item instance ${describe(action.item.ref)} ${action.item.instance}, not the instance ${describe(session.key.ref)} ${session.key.instance} of the session.`,
    );
  }
  const refused = regression(session, at);
  if (refused !== undefined) return refused;
  if (session.status === "initial") {
    return refuse("not-current", "The item has not been presented to the candidate.");
  }
  if (session.status === "suspended") {
    return refuse("suspended", "The item session is suspended; it resumes when the item is presented.");
  }
  const over = session.status !== "interacting";
  if (over && action.type === "next-attempt") {
    return refuse("attempts-exhausted", "The item session allows no further attempt.");
  }
  if (over && RESPONDING.has(action.type)) {
    return refuse("item-closed", "The item session is closed, so its responses are fixed.");
  }
  const { control, item } = context;
  switch (action.type) {
    case "set-responses":
      return setResponses(session, action, context);
    case "submit":
      return submit(session, at, context);
    case "skip":
      return skip(session, at, context);
    case "end-attempt":
      return endWith(session, at, action.interaction, context);
    case "next-attempt":
      return session.attempting ? applied(session) : applied({ ...startAttempt(session, item), updatedAt: at });
    case "review":
      return revisit(session, at, "review", control.allowReview);
    case "solution":
      return revisit(session, at, "solution", control.showSolution);
    case "comment":
      if (!control.allowComment) {
        return refuse("comment-not-allowed", "The item session control does not allow comments.");
      }
      return applied({ ...session, comment: action.text, updatedAt: at });
  }
}
