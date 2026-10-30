import type { NavigationEntry } from "./candidate-view.js";
import { type Course, candidateOf, candidateTitle } from "./course.js";
import { expiriesOf } from "./deadlines.js";
import { type DeliveryState, findDelivered } from "./delivery-state.js";
import { partModel } from "./modes.js";
import { type ItemKey, type PlannedChild, sameKey } from "./plan.js";
import { type Placement, planIndex } from "./plan-index.js";

/** What the walk over the plan reads. */
interface Walk {
  readonly course: Course;
  readonly state: DeliveryState;
  /** Whether the test part moves forward only (INFO §2.8.2). */
  readonly linear: boolean;
}

function itemEntry(walk: Walk, key: ItemKey, depth: number): NavigationEntry | undefined {
  const { course, state, linear } = walk;
  const delivered = findDelivered(state, key);
  // A linear part lists only what the candidate has been presented: nothing else can be reached.
  if (linear && delivered === undefined) return undefined;
  const entry = course.items.get(key.ref);
  const placement = planIndex(state.plan).placement(key);
  if (entry === undefined || placement === undefined) return undefined;
  const current = state.current !== undefined && sameKey(state.current, key);
  const closed = expiriesOf(course.structure, state, placement).includes("closed");
  return {
    kind: "item",
    key,
    title: candidateTitle(candidateOf(entry, delivered?.variant)),
    depth,
    status: delivered?.session.status ?? "initial",
    current,
    reachable: !linear && !current && !closed,
  };
}

function walkChildren(walk: Walk, children: readonly PlannedChild[], depth: number): NavigationEntry[] {
  return children.flatMap((child) => {
    if (child.kind === "item") {
      const entry = itemEntry(walk, child.key, depth);
      return entry === undefined ? [] : [entry];
    }
    const section = walk.course.structure.section(child.identifier)?.model;
    const visible = section?.visible === true;
    const inside = walkChildren(walk, child.children, visible ? depth + 1 : depth);
    return section !== undefined && visible && inside.length > 0
      ? [{ kind: "section" as const, identifier: section.identifier, title: section.title, depth }, ...inside]
      : inside;
  });
}

/**
 * Returns the navigation map of the test part that holds the item presented (E19): the visible sections that hold a
 * listed item, and the item instances in the order of the plan. A nonlinear part lists every instance and marks those a
 * `move` reaches; a linear part lists those presented so far, none reachable.
 */
export function navigationOf(course: Course, state: DeliveryState, placement: Placement): NavigationEntry[] {
  const part = state.plan.parts.find((each) => each.identifier === placement.part);
  if (part === undefined) return [];
  const linear = partModel(course.structure, placement).navigationMode === "linear";
  return walkChildren({ course, state, linear }, part.children, 0);
}
