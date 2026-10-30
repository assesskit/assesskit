import { type ItemKey, type PlannedChild, sameKey, type TestPlan } from "./plan.js";

/** One occurrence of a section in a plan. */
export interface SectionInstance {
  /** The identifier of the section. */
  readonly identifier: string;
  /** The occurrence, from 1. */
  readonly instance: number;
}

/** Where an item instance is in a plan. */
export interface Placement {
  /** The item instance. */
  readonly key: ItemKey;
  /** The position of the instance in the plan, from 0, in presentation order. */
  readonly order: number;
  /** The identifier of the test part. */
  readonly part: string;
  /** The sections that hold the instance, outermost first. */
  readonly sections: readonly SectionInstance[];
}

/** The item instances of a plan, each with its place. */
export interface PlanIndex {
  /** The item instances in presentation order. */
  readonly placements: readonly Placement[];
  /** Returns the place of an item instance, `undefined` when the plan does not have it. */
  placement(key: ItemKey): Placement | undefined;
  /** Returns the instances of an item reference in presentation order. */
  instances(ref: string): readonly Placement[];
}

/** The indexes of the plans of the sessions; a plan never changes, so its index is built once. */
const INDEXES = new WeakMap<TestPlan, PlanIndex>();

function place(
  children: readonly PlannedChild[],
  part: string,
  sections: readonly SectionInstance[],
  placements: Placement[],
): void {
  for (const child of children) {
    if (child.kind === "item") {
      placements.push({ key: child.key, order: placements.length, part, sections });
    } else {
      place(
        child.children,
        part,
        [...sections, { identifier: child.identifier, instance: child.instance }],
        placements,
      );
    }
  }
}

/** Returns the index of a plan. */
export function planIndex(plan: TestPlan): PlanIndex {
  const known = INDEXES.get(plan);
  if (known !== undefined) return known;
  const placements: Placement[] = [];
  for (const part of plan.parts) place(part.children, part.identifier, [], placements);
  const byRef = new Map<string, Placement[]>();
  for (const placement of placements)
    byRef.set(placement.key.ref, [...(byRef.get(placement.key.ref) ?? []), placement]);
  const index: PlanIndex = {
    placements,
    placement: (key) => byRef.get(key.ref)?.find((placement) => sameKey(placement.key, key)),
    instances: (ref) => byRef.get(ref) ?? [],
  };
  INDEXES.set(plan, index);
  return index;
}

/** Whether a placement lies in a section instance. */
export function liesIn(placement: Placement, section: SectionInstance): boolean {
  return placement.sections.some(
    (each) => each.identifier === section.identifier && each.instance === section.instance,
  );
}
