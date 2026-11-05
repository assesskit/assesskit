import type { AssessmentSection } from "../asi/index.js";
import type { ItemStage } from "../cat/index.js";
import type { Value } from "../values/index.js";
import { attemptsOf } from "./attempt.js";
import { type DeliveredItem, type DeliveryState, findDelivered } from "./delivery-state.js";
import { type ItemKey, type PlannedChild, type PlannedSection, sameKey, type TestPlan } from "./plan.js";
import { planIndex } from "./plan-index.js";

/** Where the CAT engine of an adaptive section is: the prefix of its URL and the identifier it gave the section. */
export interface CatSectionRef {
  /** The URL prefix of the engine, as `qti-adaptive-engine-ref` gives it. */
  readonly prefix: string;
  /** The identifier that Create Section returned for the section. */
  readonly sectionIdentifier: string;
}

/**
 * The request of a CAT session that waits for the host's answer: Create Session when the candidate enters the section,
 * Submit Results with the item instances to report, End Session when the candidate leaves before the engine ended the
 * session.
 */
export type CatWait =
  | {
      /** Create Session. */
      readonly kind: "create-session";
    }
  | {
      /** Submit Results. */
      readonly kind: "submit-results";
      /** The item instances whose results the request carries. */
      readonly items: readonly ItemKey[];
    }
  | {
      /** End Session. */
      readonly kind: "end-session";
    };

/**
 * An outcome that a CAT engine reported and the engine accepted.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export interface CatOutcome {
  /** The item instance of an item outcome; absent for a test outcome. */
  readonly item?: ItemKey;
  /** The identifier: the declared outcome that the report maps to, else the name the engine used. */
  readonly identifier: string;
  /** The value; an outcome with NULL carries nothing and is not kept. */
  readonly value: Value;
  /** Whether a declaration with `external-scored="externalMachine"` takes the value. */
  readonly declared: boolean;
  /** The `variable-identifier-ref` the engine reported; absent when it gave none. */
  readonly variableIdentifierRef?: string;
}

/** An item instance of an adaptive section with the number of attempts of it that a request reported. */
export interface ReportedItem {
  /** The item instance. */
  readonly key: ItemKey;
  /** The attempts that had ended when the request was made. */
  readonly attempts: number;
}

/** The statuses of a CAT session, for the checks. */
export const CAT_STATUSES = ["running", "leaving", "ended"] as const;

/** Where a CAT session is: running, ended by the candidate leaving, or ended. */
export type CatStatus = (typeof CAT_STATUSES)[number];

/** The candidate session of one adaptive section. */
export interface CatSession {
  /** The identifier of the adaptive section. */
  readonly section: string;
  /** The occurrence of the section in the plan, from 1. */
  readonly instance: number;
  /** `running` while the candidate is in the section, `leaving` when the candidate left before the engine ended the session. */
  readonly status: CatStatus;
  /** The number of requests made so far; the identifier of the request that waits ends with it. */
  readonly requests: number;
  /** The request that waits for the host's answer; absent when none does. */
  readonly request?: CatWait;
  /** The identifier of the session, from Create Session; absent before it answers. */
  readonly sessionIdentifier?: string;
  /** The state the engine handed over, which the next Submit Results returns; absent when it sent none. */
  readonly sessionState?: string;
  /** The item instances of the current stage that the plan holds, in order. */
  readonly stage: readonly ItemKey[];
  /** The items of the stage that the candidate submits before the engine sends the results. */
  readonly stageLength: number;
  /** The item instances reported so far, each with the attempts reported. */
  readonly reported: readonly ReportedItem[];
  /** The outcomes the engine reported. */
  readonly outcomes: readonly CatOutcome[];
  /** Whether the candidate asked to move on while the session waited; the move goes on when it has answered. */
  readonly moving?: true;
}

/** The identifier of the request that a session waits for. */
export function catRequestId(session: CatSession): string {
  return `cat:${session.section}:${session.instance}:${session.requests}`;
}

/** Returns the session of an adaptive section instance, `undefined` when the candidate has not entered it. */
export function findCat(state: DeliveryState, section: string, instance: number): CatSession | undefined {
  return state.cat.find((each) => each.section === section && each.instance === instance);
}

/** Returns a session of the state replaced by another of the same section. */
export function withCat(state: DeliveryState, session: CatSession): DeliveryState {
  const at = state.cat.findIndex((each) => each.section === session.section && each.instance === session.instance);
  return { ...state, cat: at < 0 ? [...state.cat, session] : state.cat.map((each, i) => (i === at ? session : each)) };
}

/** Returns a session that waits for Create Session: the candidate has entered its section. */
export function startedCat(section: string, instance: number): CatSession {
  return {
    section,
    instance,
    status: "running",
    requests: 1,
    request: { kind: "create-session" },
    stage: [],
    stageLength: 0,
    reported: [],
    outcomes: [],
    moving: true,
  };
}

/** Returns a session that has made a request: the count goes up and the request waits. */
export function requested(session: CatSession, request: CatWait): CatSession {
  return { ...session, requests: session.requests + 1, request };
}

/** Returns a session whose request has been answered. */
export function answered(session: CatSession): CatSession {
  const { request: _answered, ...rest } = session;
  return rest;
}

/** The number of attempts of an item instance that have ended: those started, except one that is still open. */
export function endedAttempts(delivered: DeliveredItem): number {
  return Math.max(0, attemptsOf(delivered.session.variables) - (delivered.session.attempting ? 1 : 0));
}

/** The adaptive section instance of the plan, with its items, in presentation order. */
function plannedSection(plan: TestPlan, section: string, instance: number): PlannedSection | undefined {
  const find = (children: readonly PlannedChild[]): PlannedSection | undefined => {
    for (const child of children) {
      if (child.kind !== "section") continue;
      if (child.identifier === section && child.instance === instance) return child;
      const inner = find(child.children);
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  for (const part of plan.parts) {
    const found = find(part.children);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Returns the identifier of the test part that holds an instance of a section. */
export function partOfSection(plan: TestPlan, section: string, instance: number): string | undefined {
  return plan.parts.find((part) => plannedSection({ parts: [part] }, section, instance) !== undefined)?.identifier;
}

/** Returns the item instances that an adaptive section holds in the plan, in order. */
export function sectionKeys(plan: TestPlan, section: string, instance: number): readonly ItemKey[] {
  return (plannedSection(plan, section, instance)?.children ?? []).flatMap((child) =>
    child.kind === "item" ? [child.key] : [],
  );
}

/** Returns the plan with the children of one section instance replaced. */
function withChildren(
  plan: TestPlan,
  section: string,
  instance: number,
  change: (children: readonly PlannedChild[]) => readonly PlannedChild[],
): TestPlan {
  const map = (children: readonly PlannedChild[]): PlannedChild[] =>
    children.map((child): PlannedChild => {
      if (child.kind !== "section") return child;
      if (child.identifier === section && child.instance === instance) {
        return { ...child, children: change(child.children) };
      }
      return { ...child, children: map(child.children) };
    });
  return { parts: plan.parts.map((part) => ({ ...part, children: map(part.children) as PlannedSection[] })) };
}

/**
 * Returns the plan with the items of a stage added at the end of the section: each identifier an instance of the item
 * reference, numbered after the instances the plan holds, so that an item the engine calls again is instanced as with
 * replacement.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export function appendedStage(
  plan: TestPlan,
  section: string,
  instance: number,
  refs: readonly string[],
): { readonly plan: TestPlan; readonly keys: readonly ItemKey[] } {
  const counts = new Map<string, number>();
  const keys = refs.map((ref): ItemKey => {
    const next = (counts.get(ref) ?? planIndex(plan).instances(ref).length) + 1;
    counts.set(ref, next);
    return { ref, instance: next };
  });
  const added: PlannedChild[] = keys.map((key) => ({ kind: "item", key }));
  return { plan: withChildren(plan, section, instance, (children) => [...children, ...added]), keys };
}

/**
 * Returns the plan without the item instances of a section that the candidate has not been presented.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export function withoutUnpresented(
  plan: TestPlan,
  section: string,
  instance: number,
  presented: (key: ItemKey) => boolean,
): TestPlan {
  return withChildren(plan, section, instance, (children) =>
    children.filter((child) => child.kind !== "item" || presented(child.key)),
  );
}

/** The number of sections and items a plan holds, which `maxPlanNodes` limits. */
export function planSize(plan: TestPlan): number {
  const size = (children: readonly PlannedChild[]): number =>
    children.reduce((total, child) => total + 1 + (child.kind === "section" ? size(child.children) : 0), 0);
  return plan.parts.reduce((total, part) => total + size(part.children), 0);
}

/**
 * The item references that an adaptive section lists: the pool of its engine.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export function poolOf(section: AssessmentSection): ReadonlySet<string> {
  return new Set(section.children.flatMap((child) => (child.kind === "assessment-item-ref" ? [child.identifier] : [])));
}

/**
 * The number of items of a stage that the candidate submits before the engine sends the results.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export function stageLengthOf(stage: ItemStage, items: number): number {
  const hint = stage.stageLength ?? 0;
  return hint > 0 ? Math.min(hint, items) : items;
}

/**
 * Returns the item instances of the section whose results the engine has not reported: presented, with an attempt that
 * ended after the last report of them.
 *
 * @remarks
 * A session in a nonlinear part reports an item again when a further attempt ended.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export function unreported(state: DeliveryState, session: CatSession): ItemKey[] {
  const keys: ItemKey[] = [];
  for (const key of sectionKeys(state.plan, session.section, session.instance)) {
    const delivered = findDelivered(state, key);
    if (delivered === undefined) continue;
    const before = session.reported.find((each) => sameKey(each.key, key))?.attempts ?? 0;
    if (endedAttempts(delivered) > before) keys.push(key);
  }
  return keys;
}

/** Returns the reports of a session updated with the attempts that a request carries. */
export function withReported(state: DeliveryState, session: CatSession, keys: readonly ItemKey[]): CatSession {
  const reported = session.reported.filter((each) => !keys.some((key) => sameKey(key, each.key)));
  const added = keys.flatMap((key): ReportedItem[] => {
    const delivered = findDelivered(state, key);
    return delivered === undefined ? [] : [{ key, attempts: endedAttempts(delivered) }];
  });
  return { ...session, reported: [...reported, ...added] };
}

/**
 * Whether the candidate has submitted the first `stageLength` items of the stage, so that the engine sends the results:
 * each of them has an attempt that ended.
 */
export function stageSubmitted(state: DeliveryState, session: CatSession): boolean {
  if (session.stage.length === 0) return false;
  return session.stage.slice(0, session.stageLength).every((key) => {
    const delivered = findDelivered(state, key);
    return delivered !== undefined && endedAttempts(delivered) > 0;
  });
}
