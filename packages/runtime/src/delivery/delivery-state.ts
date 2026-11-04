import { checkArray, checkChoice, checkRecord, checkString, describe } from "../checks.js";
import { checkFinite } from "../checks-internal.js";
import { DataError } from "../errors.js";
import type { PnpHazard, SupportName, SupportSetting, SupportState, TestingTime } from "../pnp/index.js";
import type { RandomState } from "../random.js";
import type { ResultContext } from "../results/index.js";
import type { Value } from "../values/index.js";
import type { CatSession } from "./cat-session.js";
import type { DeliveryEvent } from "./events.js";
import type { ItemSession } from "./item-session.js";
import { DELIVERY_STATUSES } from "./names.js";
import { type ItemKey, sameKey, type TestPlan } from "./plan.js";
import type { Refusal } from "./refusal.js";
import type { ScoringRequest } from "./scoring.js";

/**
 * The version of the format of {@link DeliveryState}, which `deserializeState` reads.
 *
 * @remarks
 * A 1.x release reads the state of every earlier 1.x release. The version changes only when a field changes meaning; a
 * new optional field leaves it, and a state without the field means the behavior before the field. A state of a later
 * version is refused.
 */
export const STATE_VERSION = 1;

/**
 * Where a candidate session is: running, suspended or ended.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export type DeliveryStatus = "in-progress" | "suspended" | "ended";

/**
 * What a maximum time did when it passed: `closed` the scope, because it does not allow late submission, or left it
 * open, `late`, so that later submissions are late.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export type Expiry = "closed" | "late";

/** The expiries, for the checks. */
export const EXPIRIES: readonly Expiry[] = ["closed", "late"];

/** An item instance that the candidate was presented, with its session. */
export interface DeliveredItem {
  /** The item session. */
  readonly session: ItemSession;
  /** The manifest resource of the variant presented in place of the item; absent when the item itself is. */
  readonly variant?: string;
  /** The supports that were on while the item was presented, in the order they first were. */
  readonly supports: readonly SupportName[];
  /** When the latest attempt ended, in epoch milliseconds; absent before the first ends. */
  readonly submittedAt?: number;
  /** What the maximum time of the item did when it passed; absent before it passed. */
  readonly expired?: Expiry;
  /** Whether the candidate marked the item for review; absent when it is not marked. */
  readonly marked?: true;
}

/** The time of the test, of a test part or of a section. */
export interface ScopeClock {
  /** The kind of the scope. */
  readonly scope: "test" | "part" | "section";
  /** The identifier of the test, test part or section. */
  readonly identifier: string;
  /**
   * The milliseconds the candidate spent in the scope up to the time of the state, navigation included and suspended
   * time excluded. A section selected more than once has one clock.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
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
   * The settings that the profile gives the support, as the candidate changed them with `support-settings`; absent for a
   * universal support that neither the profile nor the candidate set, and for a custom support.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
   */
  readonly settings?: SupportSetting;
  /** Whether the program gives the support to every candidate and the profile does not name it; absent otherwise. */
  readonly universal?: true;
}

/**
 * What the engine takes from the candidate's PNP besides the supports.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
export interface CandidateNeeds {
  /** The extra testing time, from `additionalTestingTime`; absent when the profile gives none. */
  readonly testingTime?: TestingTime;
  /** The hazards the candidate avoids, in the terms of the PNP. */
  readonly avoidedHazards: readonly PnpHazard[];
  /** The language of `item-translation`, a BCP 47 tag; absent when the profile asks for no translation. */
  readonly translation?: string;
  /**
   * The profile as `writePnp` writes it, in UTF-8 and base64, for the Create Session request of an adaptive section;
   * absent when the test has no adaptive section or the session starts without a profile.
   *
   * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
   */
  readonly personalNeeds?: string;
}

/**
 * The state of a candidate session: plain data that holds no item content, so that it serializes as it is and the
 * engine of its test steps it.
 *
 * @remarks
 * Steps return a new state and never change the one they are given.
 */
export interface DeliveryState {
  /** The version of the format. */
  readonly version: 1;
  /**
   * The version of the content that the session started on, as `EngineOptions.contentVersion` names it; absent when the
   * engine named none.
   */
  readonly contentVersion?: string;
  /** Whether the candidate session runs, is suspended, or has ended. */
  readonly status: DeliveryStatus;
  /** The time of the latest step, in epoch milliseconds: an action stamped earlier is refused. */
  readonly at: number;
  /** The state of the generator after the latest draw, so that a resumed session draws as it would have. */
  readonly random: RandomState;
  /** The sections and item instances of the session, which selection and ordering drew at the start. */
  readonly plan: TestPlan;
  /** The item instance presented; absent once the test has ended. */
  readonly current?: ItemKey;
  /** The item instances presented, in the order of their first presentation. */
  readonly items: readonly DeliveredItem[];
  /** The outcomes of the test, by identifier. */
  readonly outcomes: ReadonlyMap<string, Value | null>;
  /** The values that the host gave context variables at the start, `QTI_CONTEXT` included. */
  readonly context: ReadonlyMap<string, Value | null>;
  /** The time of the test and of each test part and section entered, in the order of entry. */
  readonly clocks: readonly ScopeClock[];
  /** The supports that the profile names or the program gives every candidate, by name. */
  readonly supports: ReadonlyMap<SupportName, SessionSupport>;
  /** What the engine takes from the candidate's PNP besides the supports. */
  readonly needs: CandidateNeeds;
  /** The scoring requests made so far, in the order they were made; a request stays after its value is supplied. */
  readonly scoring: readonly ScoringRequest[];
  /** The CAT sessions of the adaptive sections the candidate has entered, in the order of entry. */
  readonly cat: readonly CatSession[];
  /** Who took the test, for the `context` of the results: the host's, with the sessions that CAT engines add. */
  readonly report: ResultContext;
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
 * Returns a function that finds item instances of a state as {@link findDelivered} does, for a step that looks up many
 * of them: it reads the items once, where `findDelivered` reads them for each lookup.
 */
export function deliveredLookup(state: DeliveryState): (key: ItemKey) => DeliveredItem | undefined {
  // Most references have one instance, so the first of each is kept apart and only the others need a list.
  const first = new Map<string, DeliveredItem>();
  const others = new Map<string, DeliveredItem[]>();
  for (const item of state.items) {
    const { ref } = item.session.key;
    if (!first.has(ref)) first.set(ref, item);
    else {
      const known = others.get(ref);
      if (known === undefined) others.set(ref, [item]);
      else known.push(item);
    }
  }
  return (key) => {
    const head = first.get(key.ref);
    if (head === undefined || sameKey(head.session.key, key)) return head;
    return others.get(key.ref)?.find((item) => sameKey(item.session.key, key));
  };
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
  if (state.contentVersion !== undefined) checkString(state.contentVersion, "The contentVersion of the state");
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
  checkArray(state.scoring, "The scoring of the state must be an array");
  checkArray(state.cat, "The cat of the state must be an array");
  checkRecord(state.report, "The report of the state must be an object");
}
