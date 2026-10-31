import type { AssessmentItem } from "../asi/index.js";
import { checkBoolean, checkChoice, checkFinite, checkNonNegativeInteger, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { checkContext } from "../processing/context.js";
import type { ItemVariables, ProcessingContext } from "../processing/index.js";
import { checkItem, checkVariables } from "../processing/variables.js";
import type { Value } from "../values/index.js";
import type { DeliveryEvent } from "./events.js";
import { checkKey, type ItemKey } from "./item-key.js";
import { ITEM_SESSION_STATUSES } from "./names.js";
import { type Refusal, refuse } from "./refusal.js";
import { checkSessionControl, type EffectiveSessionControl } from "./session-control.js";

/**
 * The state of an item session in its lifecycle (INFO §2.2.1):
 *
 * | State         | The item …                                                                                          |
 * | ------------- | --------------------------------------------------------------------------------------------------- |
 * | `initial`     | will be delivered and has not been presented                                                        |
 * | `interacting` | is presented: the candidate responds in an attempt, or sees the feedback of the attempt that ended  |
 * | `suspended`   | was presented and its candidate session ended, as when the candidate moved to another item         |
 * | `closed`      | allows no further attempt; its responses are fixed                                                  |
 * | `review`      | is presented again after it closed, with its responses fixed                                        |
 * | `solution`    | is presented after it closed, with the correct responses in place of the candidate's                |
 */
export type ItemSessionStatus = "initial" | "interacting" | "suspended" | "closed" | "review" | "solution";

/**
 * The state of one item instance for one candidate: its variables, its drafts, its attempts and where it is in its
 * lifecycle. It is plain data that holds no item content, so the item comes with every call.
 */
export interface ItemSession {
  /** The item instance. */
  readonly key: ItemKey;
  /** Where the session is in its lifecycle. */
  readonly status: ItemSessionStatus;
  /** Whether an attempt is open: from its start until it ends and its responses go to response processing. */
  readonly attempting: boolean;
  /**
   * The attempts that count toward `max-attempts`: every attempt that ended, except those that an end attempt
   * interaction with `count-attempt="false"` ended (D8).
   */
  readonly countedAttempts: number;
  /**
   * The variables: the submitted responses with `numAttempts` and `duration`, the outcomes with `completionStatus`, and
   * the template and context variables. Processing and the test read these, never the drafts (B96).
   */
  readonly variables: ItemVariables;
  /** The responses as the candidate last entered them, for every declared response variable, NULL as `null`. */
  readonly drafts: ReadonlyMap<string, Value | null>;
  /**
   * Whether the response processing of the latest submission failed, so that its outcomes stay as response processing
   * found them (E26).
   */
  readonly processingFailed: boolean;
  /**
   * The order in which each interaction with choices presents them, by response identifier: one list of identifiers for
   * each set of choices, drawn at the first presentation (INFO §5.30.1) and kept for the session.
   */
  readonly choiceOrders: ReadonlyMap<string, readonly (readonly string[])[]>;
  /** The latest state of each portable custom interaction, by response identifier, opaque to the engine (E29). */
  readonly pciStates: ReadonlyMap<string, string>;
  /** The candidate's comment on the item (INFO §7.19.5); absent when none was given. */
  readonly comment?: string;
  /** The milliseconds the candidate spent in the item before the current candidate session (INFO §2.2.2.2). */
  readonly spent: number;
  /** When the current candidate session began, in epoch milliseconds; `null` while the session is not interacting. */
  readonly since: number | null;
  /** The time of the latest change, in epoch milliseconds; an action stamped earlier is refused. */
  readonly updatedAt: number;
}

/** What the rules of an item session read besides its state: the item, its item session control and the processing. */
export interface ItemSessionContext extends ProcessingContext {
  /** The item, as `readAsi` reads it, with its includes resolved. */
  readonly item: AssessmentItem;
  /**
   * The item session control in force: {@link sessionControl} of the item reference in a test, or
   * {@link standaloneSessionControl} for an item delivered alone.
   */
  readonly control: EffectiveSessionControl;
}

/** What a step of an item session gives: the new session and what happened, or a refusal that leaves it as it was. */
export type ItemStep =
  | {
      /** The step is accepted. */
      readonly ok: true;
      /** The session after the step. */
      readonly session: ItemSession;
      /** What happened, in order. */
      readonly events: readonly DeliveryEvent[];
    }
  | {
      /** The step is refused. */
      readonly ok: false;
      /** Why. */
      readonly refusal: Refusal;
    };

/** Returns an accepted step. */
export function applied(session: ItemSession, events: readonly DeliveryEvent[] = []): ItemStep {
  return { ok: true, session, events };
}

/**
 * Checks a time.
 *
 * @throws `DataError` when it is not a finite number.
 */
export function checkTime(at: unknown): asserts at is number {
  checkFinite(at, "The time");
}

/** Returns the refusal of a step stamped before the latest change of the session, `undefined` when it is not. */
export function regression(session: ItemSession, at: number): ItemStep | undefined {
  if (at >= session.updatedAt) return undefined;
  return refuse(
    "clock-regression",
    `The step at ${at} is earlier than the latest change of the item session at ${session.updatedAt}.`,
    "INFO §2.2.2.2",
  );
}

function checkMap(value: unknown, label: string): void {
  if (!(value instanceof Map)) throw new DataError(`${label} must be a Map, found ${describe(value)}.`);
}

/**
 * Checks an item session shallowly: the fields that the transitions read have their types.
 *
 * @throws `DataError` when it is not an item session.
 */
export function checkSession(session: ItemSession): void {
  const input: unknown = session;
  checkRecord(input, "The item session must be an object from startItemSession");
  checkKey(session.key);
  checkChoice(session.status, "The status of the item session", ITEM_SESSION_STATUSES);
  checkBoolean(session.attempting, "The attempting of the item session");
  checkNonNegativeInteger(session.countedAttempts, "The countedAttempts of the item session");
  checkVariables(session.variables);
  checkMap(session.drafts, "The drafts of the item session");
  checkBoolean(session.processingFailed, "The processingFailed of the item session");
  checkMap(session.choiceOrders, "The choiceOrders of the item session");
  checkMap(session.pciStates, "The pciStates of the item session");
  checkFinite(session.spent, "The spent of the item session");
  if (session.since !== null) checkFinite(session.since, "The since of the item session");
  checkFinite(session.updatedAt, "The updatedAt of the item session");
}

/**
 * Checks the context of an item session: the item shallowly, the control and the processing context.
 *
 * @throws `DataError` when it is not a context.
 */
export function checkSessionContext(context: ItemSessionContext): void {
  const input: unknown = context;
  checkRecord(input, "The context of the item session must be an object with an item, a control and a random");
  checkItem(context.item);
  checkSessionControl(context.control);
  checkContext(context);
}
