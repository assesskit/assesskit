import {
  checkArray,
  checkFunction,
  checkOptions,
  checkPositiveInteger,
  checkRecord,
  checkString,
  describe,
} from "../checks.js";
import { DataError, SecurityError } from "../errors.js";
import { type Random, shuffle } from "../random.js";
import { selectChildren } from "./selection.js";
import type { ContentNode, ItemRefNode, SectionNode, TestStructure } from "./structure.js";

/**
 * One occurrence of an item reference in a session: the identifier of the item reference and the instance, counted
 * from 1 in the order of the plan. Selection with replacement makes several instances of one reference (INFO
 * §2.11.1.2, E11).
 */
export interface ItemKey {
  /** The identifier of the item reference. */
  readonly ref: string;
  /** The position of this occurrence among the occurrences of the reference in the plan, from 1. */
  readonly instance: number;
}

/** An item instance in the plan. */
export interface PlannedItem {
  /** Tells an item from a section. */
  readonly kind: "item";
  /** The item instance. */
  readonly key: ItemKey;
}

/** A section in the plan, with the children that selection and ordering left in it. */
export interface PlannedSection {
  /** Tells a section from an item. */
  readonly kind: "section";
  /** The identifier of the section. */
  readonly identifier: string;
  /** The position of this occurrence among the occurrences of the section in the plan, from 1. */
  readonly instance: number;
  /** The selected children in presentation order; an adaptive section has none until its stages are appended. */
  readonly children: readonly PlannedChild[];
}

/** A child of a section in the plan. */
export type PlannedChild = PlannedItem | PlannedSection;

/** A test part in the plan. */
export interface PlannedPart {
  /** Tells a part from the other nodes of the plan. */
  readonly kind: "part";
  /** The identifier of the test part. */
  readonly identifier: string;
  /** The sections of the part in document order. */
  readonly children: readonly PlannedSection[];
}

/**
 * What one session presents: the test parts in document order, each with the sections, and in them the items that
 * selection chose in the order that ordering gave. It holds identifiers and numbers only, so that it serializes as it
 * is and rebuilds the same session from the same structure.
 */
export interface TestPlan {
  /** The test parts in document order. */
  readonly parts: readonly PlannedPart[];
}

/** The limits of {@link planTest}. */
export interface PlanLimits {
  /** The most sections and items a plan may hold, so that a selection with replacement cannot exhaust memory. */
  readonly maxPlanNodes: number;
}

/** The default limits of {@link planTest}. */
export const DEFAULT_PLAN_LIMITS: PlanLimits = { maxPlanNodes: 10_000 };

/** The options of {@link planTest}. */
export interface PlanOptions {
  /** The source of the draws of selection and ordering, such as `createRandom(seed)`. */
  readonly random: Random;
  /** Limits that replace those of {@link DEFAULT_PLAN_LIMITS}; a limit left out keeps its default. Default: none. */
  readonly limits?: Partial<PlanLimits>;
}

/** A selected item reference before the instances are counted. */
interface ItemDraft {
  readonly kind: "item";
  readonly node: ItemRefNode;
}

/** A selected section before the instances are counted, with what selection and ordering left of its children. */
interface SectionDraft {
  readonly kind: "section";
  readonly node: SectionNode;
  readonly children: readonly Draft[];
}

type Draft = ItemDraft | SectionDraft;

/** What drafting draws from and spends. */
interface Drafting {
  readonly random: Random;
  /** The limit, for the message of the error. */
  readonly maxPlanNodes: number;
  /** The number of nodes the plan may still take. */
  remaining: number;
}

/** Whether ordering keeps a draft where it is: its item reference or section is `fixed` (INFO §4.2.3). */
function isFixed(entry: Draft): boolean {
  return entry.node.model.fixed === true;
}

function overLimit(drafting: Drafting): SecurityError {
  return new SecurityError(
    `The plan would hold more than the ${drafting.maxPlanNodes} sections and items that the limit maxPlanNodes allows.`,
    "maxPlanNodes",
    drafting.maxPlanNodes,
  );
}

function spend(drafting: Drafting): void {
  if (drafting.remaining < 1) throw overLimit(drafting);
  drafting.remaining -= 1;
}

/** Returns the drafts with the children of the sections that ordering mixes in put in their places (INFO §4.2.6–7). */
function mixIn(drafts: readonly Draft[]): Draft[] {
  return drafts.flatMap((entry) =>
    entry.kind === "section" && entry.node.dissolved ? mixIn(entry.children) : [entry],
  );
}

/**
 * Selects and orders the children of a section. The selection draws first, then each selected child section drafts its
 * own children, and the ordering draws last. An adaptive section keeps no children: its stages are appended as the CAT
 * engine chooses them (B66).
 */
function draftChildren(section: SectionNode, drafting: Drafting): Draft[] {
  if (section.model.adaptiveSelection !== undefined) return [];
  // A selection with replacement can ask for any number of copies, so it is checked before it draws.
  if ((section.model.selection?.select ?? 0) > drafting.remaining) throw overLimit(drafting);
  const drafts = selectChildren(section, drafting.random).map((child) => draftChild(child, drafting));
  return section.model.ordering?.shuffle === true ? shuffle(mixIn(drafts), isFixed, drafting.random) : drafts;
}

function draftSection(node: SectionNode, drafting: Drafting): SectionDraft {
  spend(drafting);
  return { kind: "section", node, children: draftChildren(node, drafting) };
}

function draftChild(node: ContentNode, drafting: Drafting): Draft {
  if (node.kind === "section") return draftSection(node, drafting);
  spend(drafting);
  return { kind: "item", node };
}

/** Counts the next occurrence of an identifier. */
function occurrence(identifier: string, occurrences: Map<string, number>): number {
  const instance = (occurrences.get(identifier) ?? 0) + 1;
  occurrences.set(identifier, instance);
  return instance;
}

/** Numbers the instances in presentation order, a section before the children it holds. */
function planSection(entry: SectionDraft, occurrences: Map<string, number>): PlannedSection {
  const { identifier } = entry.node.model;
  const instance = occurrence(identifier, occurrences);
  return {
    kind: "section",
    identifier,
    instance,
    children: entry.children.map((child) => planChild(child, occurrences)),
  };
}

function planChild(entry: Draft, occurrences: Map<string, number>): PlannedChild {
  if (entry.kind === "section") return planSection(entry, occurrences);
  const { identifier } = entry.node.model;
  return { kind: "item", key: { ref: identifier, instance: occurrence(identifier, occurrences) } };
}

/**
 * Plans a session: selects the children of every section, orders them, and numbers the instances (B21–B24, E11).
 *
 * - The test parts and the sections of a part keep document order; only the children of a section are selected and
 *   ordered, by `qti-selection` and `qti-ordering`.
 * - The draws come from `options.random` in a fixed order: depth first in document order, each section drawing its
 *   selection (G8), then its selected sections, then its ordering. Ordering shuffles by Fisher–Yates from the last
 *   index, so `fixed` children keep their places; an invisible section that is not kept together first gives its
 *   children to the list that is shuffled (B24). Equal draws give equal plans, and no draw is taken when a section
 *   selects all its children without shuffling.
 * - The instances of a reference, and of a section, are counted in presentation order across the whole test.
 *
 * @param structure - The test, from {@link resolveStructure}.
 * @param options - See {@link PlanOptions}.
 * @throws `DataError` when an argument has the wrong type, or a selection asks for fewer children than are required,
 * more than exist without replacement, or any from a section with none.
 * @throws `SecurityError` when the plan would hold more than `limits.maxPlanNodes` sections and items.
 */
export function planTest(structure: TestStructure, options: PlanOptions): TestPlan {
  checkRecord(structure, "The structure must be an object from resolveStructure");
  checkRecord(structure.test, "The structure must be an object from resolveStructure");
  checkArray(
    structure.test.parts,
    "The structure must be an object from resolveStructure, whose test has an array parts",
  );
  checkOptions(options);
  const { random, limits = {} } = options;
  checkRecord(random, "The option random must be an object with a function uniform");
  checkFunction(random.uniform, "The option random must be an object with a function uniform");
  checkRecord(limits, "The option limits must be an object");
  const { maxPlanNodes = DEFAULT_PLAN_LIMITS.maxPlanNodes } = limits;
  checkPositiveInteger(maxPlanNodes, "The option limits.maxPlanNodes");
  const drafting: Drafting = { random, maxPlanNodes, remaining: maxPlanNodes };
  const occurrences = new Map<string, number>();
  const parts = structure.test.parts.map((part): PlannedPart => {
    const sections = part.sections.map((section) => draftSection(section, drafting));
    return {
      kind: "part",
      identifier: part.model.identifier,
      children: sections.map((entry) => planSection(entry, occurrences)),
    };
  });
  return { parts };
}

/**
 * Returns the item instances of a plan in presentation order, or those of one test part. A part with simultaneous
 * submission submits these together at its end (B27).
 *
 * @param part - The identifier of a test part. Default: every part.
 * @throws `DataError` when the plan is not a plan, or the part is not in it.
 */
export function planItems(plan: TestPlan, part?: string): readonly ItemKey[] {
  checkRecord(plan, "The plan must be an object");
  checkArray(plan.parts, "The plan must have an array parts");
  if (part !== undefined) checkString(part, "The test part");
  const chosen = part === undefined ? plan.parts : plan.parts.filter((candidate) => candidate.identifier === part);
  if (part !== undefined && chosen.length === 0) throw new DataError(`The plan has no test part ${describe(part)}.`);
  return chosen.flatMap((entry) => keysOf(entry.children));
}

function keysOf(children: readonly PlannedChild[]): ItemKey[] {
  return children.flatMap((child) => (child.kind === "item" ? [child.key] : keysOf(child.children)));
}
