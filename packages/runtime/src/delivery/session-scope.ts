import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import {
  createItemVariables,
  DURATION,
  type ItemSessionFilter,
  type ItemSessionView,
  type ItemVariables,
  QTI_CONTEXT,
  type TestScope,
} from "../processing/index.js";
import { fitValue } from "../processing/internal.js";
import { single, type Value } from "../values/index.js";
import { MILLISECONDS_PER_SECOND } from "./attempt.js";
import { type Course, type CourseItem, candidateOf, itemContextValues } from "./course.js";
import { type DeliveryState, findDelivered, type ScopeClock } from "./delivery-state.js";
import type { ItemKey } from "./plan.js";
import { type PlanIndex, planIndex } from "./plan-index.js";
import { ancestry, type ItemRefNode } from "./structure.js";

/**
 * Returns the time a clock shows as the value of a `duration` variable: seconds, truncated to the millisecond.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function durationOf(clocks: readonly ScopeClock[], scope: ScopeClock["scope"], identifier: string): Value {
  const spent = clocks.find((clock) => clock.scope === scope && clock.identifier === identifier)?.spent ?? 0;
  return single("duration", Math.floor(spent) / MILLISECONDS_PER_SECOND);
}

/**
 * Whether an item reference is in the subset that a filter keeps.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function keeps(node: ItemRefNode, filter: ItemSessionFilter): boolean {
  const { sectionIdentifier, includeCategories, excludeCategories } = filter;
  const categories = node.model.category ?? [];
  if (
    sectionIdentifier !== undefined &&
    !ancestry(node).some((outer) => outer.kind === "section" && outer.model.identifier === sectionIdentifier)
  ) {
    return false;
  }
  if (includeCategories !== undefined && !includeCategories.some((category) => categories.includes(category))) {
    return false;
  }
  return !(excludeCategories ?? []).some((category) => categories.includes(category));
}

/**
 * What the expressions of a test read in a session: the item sessions of the instances of the plan, and the variables
 * of the test that are not outcomes.
 *
 * @remarks
 * An instance not yet presented reads as a session in the state `initial` before template processing, so that it counts
 * as selected and nothing else.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export class SessionScope implements TestScope {
  private readonly course: Course;
  private readonly state: DeliveryState;
  private readonly index: PlanIndex;
  private readonly initial = new Map<string, ItemVariables>();

  constructor(course: Course, state: DeliveryState) {
    this.course = course;
    this.state = state;
    this.index = planIndex(state.plan);
  }

  /** Returns the instances of the plan that the filter keeps, in presentation order. */
  *itemSessions(filter: ItemSessionFilter): Iterable<ItemSessionView> {
    for (const { key } of this.index.placements) {
      const entry = this.entry(key.ref);
      if (keeps(entry.node, filter)) yield this.view(key, entry);
    }
  }

  /**
   * Returns the instance that `ITEM.VAR` or `ITEM.n.VAR` names. Without `n`, the instance whose attempt ended last, so
   * the last submitted instance in simultaneous mode and also in individual mode; before any ended, the last instance
   * of the plan.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
   */
  itemSession(identifier: string, instance: number | undefined): ItemSessionView | undefined {
    const instances = this.index.instances(identifier);
    if (instance !== undefined) {
      const found = instances.find((placement) => placement.key.instance === instance);
      return found === undefined ? undefined : this.view(found.key, this.entry(identifier));
    }
    let chosen = instances.at(-1);
    let latest = Number.NEGATIVE_INFINITY;
    for (const placement of instances) {
      const submittedAt = findDelivered(this.state, placement.key)?.submittedAt;
      if (submittedAt !== undefined && submittedAt >= latest) {
        latest = submittedAt;
        chosen = placement;
      }
    }
    return chosen === undefined ? undefined : this.view(chosen.key, this.entry(identifier));
  }

  /**
   * Returns a variable of the test that is not an outcome: `duration` of the test and `PART.duration` or
   * `SECTION.duration`, a context variable of the test or `QTI_CONTEXT` as the host gave it, else its default, and NULL
   * for a variable of an item reference with no such instance in the plan.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  variable(identifier: string): Value | null | undefined {
    const [prefix = "", ...rest] = identifier.split(".");
    const duration =
      identifier === DURATION
        ? this.duration(undefined)
        : rest.length === 1 && rest[0] === DURATION
          ? this.duration(prefix)
          : undefined;
    if (duration !== undefined) return duration;
    const context = this.contextValue(identifier);
    if (context !== undefined) return context;
    const prefixed = (rest.length === 1 || rest.length === 2) && this.course.structure.itemRef(prefix) !== undefined;
    return prefixed ? null : undefined;
  }

  /**
   * Returns the value of `QTI_CONTEXT` or of a context variable of the test: as the host gave it, else its default;
   * `undefined` when the test declares no such variable.
   */
  private contextValue(identifier: string): Value | null | undefined {
    if (identifier === QTI_CONTEXT) return this.state.context.get(QTI_CONTEXT) ?? null;
    const declaration = this.course.structure.test.model.contextDeclarations.find(
      (each) => each.identifier === identifier,
    );
    if (declaration === undefined) return undefined;
    const given = this.state.context.get(identifier);
    if (given === undefined) return this.course.contexts.get(identifier) ?? null;
    // The values given were checked against every declaration at the start, so each fits.
    return given === null ? null : (fitValue(given, declaration) ?? null);
  }

  /**
   * Returns the duration of the test, or of the test part or section with the identifier; `undefined` when there is no
   * such part or section.
   */
  private duration(identifier: string | undefined): Value | undefined {
    const { structure } = this.course;
    const { clocks } = this.state;
    if (identifier === undefined) return durationOf(clocks, "test", structure.test.model.identifier);
    if (structure.part(identifier) !== undefined) return durationOf(clocks, "part", identifier);
    if (structure.section(identifier) !== undefined) return durationOf(clocks, "section", identifier);
    return undefined;
  }

  private entry(ref: string): CourseItem {
    const entry = this.course.items.get(ref);
    if (entry === undefined) throw new DataError(`The plan names ${describe(ref)}, which the test does not have.`);
    return entry;
  }

  private view(key: ItemKey, entry: CourseItem): ItemSessionView {
    const ref = entry.node.model;
    const delivered = findDelivered(this.state, key);
    if (delivered !== undefined) {
      return { ref, item: candidateOf(entry, delivered.variant).item, variables: delivered.session.variables };
    }
    const [own] = entry.candidates;
    let variables = this.initial.get(key.ref);
    if (variables === undefined) {
      variables = createItemVariables(own.item, { context: itemContextValues(this.state.context, own.item) });
      this.initial.set(key.ref, variables);
    }
    return { ref, item: own.item, variables };
  }
}
