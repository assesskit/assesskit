import { checkArray, checkChoice, checkFinite, checkRecord, describe } from "../checks.js";
import type { PnpHazardTerm } from "../content/index.js";
import { DataError } from "../errors.js";
import type { SupportName, SupportSetting, SupportState, TestingTime } from "../pnp/index.js";
import type { RandomState } from "../random.js";
import type { Value } from "../values/index.js";
import type { DeliveryEvent } from "./events.js";
import type { ItemSession } from "./item-session.js";
import { DELIVERY_STATUSES } from "./names.js";
import { type ItemKey, sameKey, type TestPlan } from "./plan.js";
import type { Refusal } from "./refusal.js";

/** The version of the format of {@link DeliveryState}, which `deserializeState` reads. */
export const STATE_VERSION = 1;

/** Where a candidate session is: running, suspended (INFO §2.2.1) or ended. */
export type DeliveryStatus = "in-progress" | "suspended" | "ended";

/**
 * What a maximum time did when it passed (D9): `closed` the scope, because it does not allow late submission, or left
 * it open, `late`, so that later submissions are late.
 */
export type Expiry = "closed" | "late";

/** The expiries, for the checks. */
export const EXPIRIES: readonly Expiry[] = ["closed", "late"];

/** An item instance that the candidate was presented, with its session. */
export interface DeliveredItem {
  /** The item session. */
  readonly session: ItemSession;
  /** The manifest resource of the variant presented in place of the item; absent when the item itself is (B100). */
  readonly variant?: string;
  /** The supports that were on while the item was presented, in the order they first were (E28). */
  readonly supports: readonly SupportName[];
  /** When the latest attempt ended, in epoch milliseconds; absent before the first ends. */
  readonly submittedAt?: number;
  /** What the maximum time of the item did when it passed; absent before it passed. */
  readonly expired?: Expiry;
}

/** The time of the test, of a test part or of a section. */
export interface ScopeClock {
  /** The kind of the scope. */
  readonly scope: "test" | "part" | "section";
  /** The identifier of the test, test part or section. */
  readonly identifier: string;
  /**
   * The milliseconds the candidate spent in the scope up to the time of the state, navigation included and suspended
   * time excluded (INFO §2.8.5, G23). A section selected more than once has one clock.
   */
  readonly spent: number;
  /** What the maximum time of the scope did when it passed; absent before it passed. */
  readonly expired?: Expiry;
}

/** A support of the candidate session: what the profile, or the program, says about it, and whether it is on. */
export interface SessionSupport {
  /** The state that `resolveSupports` gives it; a universal support that the profile does not name is an `option`. */
  readonly state: SupportState;
  /** Whether the support is on. */
  readonly active: boolean;
  /**
   * The settings that the profile gives the support (BPIG §5.2); absent for a universal support that the profile does
   * not name, and for a custom support.
   */
  readonly settings?: SupportSetting;
}

/** What the engine takes from the candidate's PNP besides the supports (BPIG §5.2). */
export interface CandidateNeeds {
  /** The extra testing time, from `additionalTestingTime`; absent when the profile gives none. */
  readonly testingTime?: TestingTime;
  /** The hazards the candidate avoids, in the terms of the PNP (BPIG §5.2.5). */
  readonly avoidedHazards: readonly PnpHazardTerm[];
  /** The language of `item-translation`, a BCP 47 tag; absent when the profile asks for no translation. */
  readonly translation?: string;
}

/**
 * The state of a candidate session: plain data that holds no item content, so that it serializes as it is and the
 * engine of its test steps it (E2). Steps return a new state and never change the one they are given.
 */
export interface DeliveryState {
  /** The version of the format. */
  readonly version: 1;
  /** Whether the candidate session runs, is suspended, or has ended. */
  readonly status: DeliveryStatus;
  /** The time of the latest step, in epoch milliseconds: an action stamped earlier is refused (G27). */
  readonly at: number;
  /** The state of the generator after the latest draw, so that a resumed session draws as it would have (E3). */
  readonly random: RandomState;
  /** The sections and item instances of the session, which selection and ordering drew at the start. */
  readonly plan: TestPlan;
  /** The item instance presented; absent once the test has ended. */
  readonly current?: ItemKey;
  /** The item instances presented, in the order of their first presentation. */
  readonly items: readonly DeliveredItem[];
  /** The outcomes of the test, by identifier. */
  readonly outcomes: ReadonlyMap<string, Value | null>;
  /** The values that the host gave context variables at the start, `QTI_CONTEXT` included (B50). */
  readonly context: ReadonlyMap<string, Value | null>;
  /** The time of the test and of each test part and section entered, in the order of entry. */
  readonly clocks: readonly ScopeClock[];
  /** The supports that the profile names or the program gives every candidate, by name (E28). */
  readonly supports: ReadonlyMap<SupportName, SessionSupport>;
  /** What the engine takes from the candidate's PNP besides the supports. */
  readonly needs: CandidateNeeds;
}

/** What a step of a candidate session gives: the new state and what happened, or a refusal that leaves it as it was. */
export type Step =
  | {
      /** The step is accepted. */
      readonly ok: true;
      /** The state after the step. */
      readonly state: DeliveryState;
      /** What happened, in order. */
      readonly events: readonly DeliveryEvent[];
    }
  | {
      /** The step is refused. */
      readonly ok: false;
      /** Why. */
      readonly refusal: Refusal;
    };

/** Returns the item instance of a state with its session, `undefined` when it has not been presented. */
export function findDelivered(state: DeliveryState, key: ItemKey): DeliveredItem | undefined {
  return state.items.find((item) => sameKey(item.session.key, key));
}

/**
 * Checks a state shallowly: the fields that every step reads have their types.
 *
 * @throws `DataError` when it is not a state.
 */
export function checkState(state: DeliveryState): void {
  const input: unknown = state;
  checkRecord(input, "The state must be an object from Engine.start or deserializeState");
  if (input.version !== STATE_VERSION) {
    throw new DataError(`The state must have the version ${STATE_VERSION}, found ${describe(input.version)}.`);
  }
  checkChoice(state.status, "The status of the state", DELIVERY_STATUSES);
  checkFinite(state.at, "The at of the state");
  checkArray(state.random, "The random of the state must be an array of four integers");
  checkRecord(state.plan, "The plan of the state must be an object");
  checkArray(state.items, "The items of the state must be an array");
  checkArray(state.clocks, "The clocks of the state must be an array");
  for (const [field, value] of [
    ["outcomes", state.outcomes],
    ["context", state.context],
    ["supports", state.supports],
  ] as const) {
    if (!(value instanceof Map))
      throw new DataError(`The ${field} of the state must be a Map, found ${describe(value)}.`);
  }
  checkRecord(state.needs, "The needs of the state must be an object");
}
