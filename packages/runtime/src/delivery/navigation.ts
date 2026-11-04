import type { Expression } from "../asi/index.js";
import { checkArray, checkFunction, checkRecord, describe } from "../checks.js";
import { DataError, ProcessingError } from "../errors.js";
import type { ProcessingContext, TestScope } from "../processing/index.js";
import { evaluateTestExpression } from "../processing/internal.js";
import type { Value } from "../values/index.js";
import {
  checkKey,
  type ItemKey,
  listPlanItems,
  type PlannedChild,
  type PlannedPart,
  sameKey,
  type TestPlan,
} from "./plan.js";
import type { TestStructure } from "./structure.js";

/**
 * What the expressions of pre-conditions and branch rules read: the current outcomes of the test, the item
 * sessions and other variables of the test, and the processing context.
 *
 * @remarks
 * They are the arguments of `runOutcomeProcessing` after the test.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export interface RuleContext {
  /** The values of the outcomes of the test, by identifier; an outcome left out has its starting value. */
  readonly outcomes: ReadonlyMap<string, Value | null>;
  /** The item sessions and the other variables of the test. */
  readonly scope: TestScope;
  /** The source of random draws, the custom operators and the limits. */
  readonly context: ProcessingContext;
  /**
   * Whether the candidate has entered the instance of an adaptive section, so that the walk stops at one that it has
   * not: its first stage comes from the CAT engine.
   *
   * @defaultValue none, so that an adaptive section without items is passed
   */
  readonly catStarted?: (section: string, instance: number) => boolean;
}

/**
 * The branch rule targets that name no node but a place to leave.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const EXIT_SECTION = "EXIT_SECTION";
const EXIT_TESTPART = "EXIT_TESTPART";
const EXIT_TEST = "EXIT_TEST";

/** A node of the plan with its place in it, so that the walk can go up, along and down. */
interface Frame {
  readonly node: PlannedPart | PlannedChild;
  readonly parent: Frame | undefined;
  /** The position among the siblings. */
  readonly index: number;
  readonly children: readonly Frame[];
  /** The number of the node in a depth-first walk of the plan, which orders nodes by where they come. */
  readonly start: number;
  /** The number of the last node in the subtree: a node whose number is above it comes after the whole subtree. */
  last: number;
}

/**
 * What the walk does next: it enters, completes or goes on after a node, stops at an item to present or at an adaptive
 * section to start, or ends.
 */
type Move =
  | { readonly to: "enter" | "complete" | "after"; readonly frame: Frame }
  | { readonly to: "present"; readonly key: ItemKey }
  | { readonly to: "adaptive"; readonly section: string; readonly instance: number }
  | { readonly to: "end" };

const END: Move = { to: "end" };

/**
 * Where the candidate goes on leaving an item or a section: an item, of the same test part or of another that a branch
 * rule leads to; an adaptive section that the candidate has not entered, whose first stage the CAT engine gives; the
 * end of the test part, after which the walk goes on from the part once it has ended; or the end of the test, at
 * `EXIT_TEST` or after the last part.
 */
export type Destination =
  | { readonly to: "item"; readonly key: ItemKey }
  | { readonly to: "adaptive"; readonly section: string; readonly instance: number }
  | { readonly to: "part-end" }
  | { readonly to: "test-end" };

/** The destination at the end of the test part. */
export const PART_END: Destination = { to: "part-end" };

/** The destination at the end of the test. */
export const TEST_END: Destination = { to: "test-end" };

/** The nodes of a plan with their places in it, and the frames by the identifier of their nodes. */
interface Frames {
  readonly roots: readonly Frame[];
  readonly named: ReadonlyMap<string, readonly Frame[]>;
}

/** The identifier of a node of the plan: for an item, the identifier of its item reference. */
function identifierOf(node: PlannedPart | PlannedChild): string {
  return node.kind === "item" ? node.key.ref : node.identifier;
}

function notInStructure(identifier: string): DataError {
  return new DataError(`The plan names ${describe(identifier)}, which the structure does not have.`);
}

/** Returns the navigation mode of the test part with the identifier. */
function navigationMode(structure: TestStructure, part: string): "linear" | "nonlinear" {
  const node = structure.part(part);
  if (node === undefined) throw notInStructure(part);
  return node.model.navigationMode;
}

/** The counters of a build of frames. */
interface Build {
  next: number;
  readonly named: Map<string, Frame[]>;
}

function buildFrames(nodes: readonly (PlannedPart | PlannedChild)[], parent: Frame | undefined, build: Build): Frame[] {
  return nodes.map((node, index) => {
    const children: Frame[] = [];
    const frame: Frame = { node, parent, index, children, start: build.next, last: build.next };
    build.next += 1;
    const identifier = identifierOf(node);
    const named = build.named.get(identifier);
    if (named === undefined) build.named.set(identifier, [frame]);
    else named.push(frame);
    if (node.kind !== "item") for (const child of buildFrames(node.children, frame, build)) children.push(child);
    frame.last = build.next - 1;
    return frame;
  });
}

/** The frames of each plan, made once: a plan does not change, and every step of a session walks the same one. */
const FRAMES = new WeakMap<TestPlan, Frames>();

function indexPlan(plan: TestPlan): Frames {
  const known = FRAMES.get(plan);
  if (known !== undefined) return known;
  const build: Build = { next: 0, named: new Map() };
  const frames = { roots: buildFrames(plan.parts, undefined, build), named: build.named };
  FRAMES.set(plan, frames);
  return frames;
}

/** Returns the frames from the root down to a frame. */
function pathTo(frame: Frame): Frame[] {
  const path: Frame[] = [];
  for (let at: Frame | undefined = frame; at !== undefined; at = at.parent) path.unshift(at);
  return path;
}

function rootOf(frame: Frame): Frame {
  return frame.parent === undefined ? frame : rootOf(frame.parent);
}

/**
 * A walk over a plan in the order of presentation, which decides what follows an item in a linear test part: it skips
 * what a pre-condition rules out and follows the branch rules. The rules of a test part and of what it holds apply only
 * when the part is linear.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
class Walk {
  private readonly structure: TestStructure;
  private readonly rules: RuleContext;
  private readonly frames: Frames;

  constructor(structure: TestStructure, plan: TestPlan, rules: RuleContext) {
    this.structure = structure;
    this.rules = rules;
    this.frames = indexPlan(plan);
  }

  /** Returns where the test starts: its first item, or the end when it has none. */
  start(): Destination {
    const [first] = this.frames.roots;
    return this.run(first === undefined ? END : { to: "enter", frame: first });
  }

  /**
   * Returns where the candidate goes on leaving an item.
   *
   * @throws `DataError` when the plan has no such item instance.
   */
  after(key: ItemKey): Destination {
    return this.run({ to: "complete", frame: this.itemFrame(key) });
  }

  /**
   * Returns where the candidate goes on leaving a node that holds an item: the item itself, or one of the sections it
   * lies in.
   *
   * @remarks
   * The walk stops where the test part of the item would be completed.
   *
   * @throws `DataError` when the plan has no such item instance, or the node does not hold it.
   */
  depart(key: ItemKey, node: string): Destination {
    const item = this.itemFrame(key);
    let frame: Frame | undefined = item;
    while (frame !== undefined && identifierOf(frame.node) !== node) frame = frame.parent;
    if (frame === undefined) {
      throw new DataError(`The item instance ${describe(key.ref)} ${key.instance} does not lie in ${describe(node)}.`);
    }
    return this.run({ to: "complete", frame }, rootOf(item));
  }

  /**
   * Returns where the candidate goes on leaving an adaptive section that holds no item for the walk to stop at: the
   * section is completed, so that its branch rules follow.
   *
   * @throws `DataError` when the plan has no such section.
   */
  afterSection(section: string, instance: number): Destination {
    const frame = this.frames.named
      .get(section)
      ?.find((candidate) => candidate.node.kind === "section" && candidate.node.instance === instance);
    if (frame === undefined) throw new DataError(`The plan has no section ${describe(section)} ${instance}.`);
    return this.run({ to: "complete", frame });
  }

  /**
   * Returns where the candidate goes once a test part has ended: the part is completed, so that its branch rules
   * follow.
   *
   * @throws `DataError` when the plan has no such test part.
   */
  afterPart(part: string): Destination {
    const frame = this.frames.roots.find((root) => identifierOf(root.node) === part);
    if (frame === undefined) throw new DataError(`The plan has no test part ${describe(part)}.`);
    return this.run({ to: "complete", frame });
  }

  private itemFrame(key: ItemKey): Frame {
    const frame = this.frames.named
      .get(key.ref)
      ?.find((candidate) => candidate.node.kind === "item" && sameKey(candidate.node.key, key));
    if (frame === undefined) {
      throw new DataError(`The plan has no item instance ${describe(key.ref)} ${key.instance}.`);
    }
    return frame;
  }

  /** Walks from a move until an item or the end of the test, or until it would complete the part `stop`. */
  private run(first: Move, stop?: Frame): Destination {
    let move = first;
    for (;;) {
      switch (move.to) {
        case "present":
          return { to: "item", key: move.key };
        case "adaptive":
          return { to: "adaptive", section: move.section, instance: move.instance };
        case "end":
          return TEST_END;
        case "enter":
          move = this.enter(move.frame);
          break;
        case "complete":
          if (move.frame === stop) return PART_END;
          move = this.complete(move.frame);
          break;
        case "after":
          move = this.next(move.frame);
          break;
      }
    }
  }

  /** The model of the node of a frame in the structure: it holds the pre-conditions and branch rules. */
  private modelOf(frame: Frame) {
    const { node } = frame;
    const model =
      node.kind === "part"
        ? this.structure.part(node.identifier)?.model
        : node.kind === "section"
          ? this.structure.section(node.identifier)?.model
          : this.structure.itemRef(node.key.ref)?.model;
    if (model === undefined) throw notInStructure(identifierOf(node));
    return model;
  }

  /** Whether the rules of the frame apply: its test part is linear. */
  private applies(frame: Frame): boolean {
    return navigationMode(this.structure, identifierOf(rootOf(frame).node)) === "linear";
  }

  /**
   * Returns whether an expression is true.
   *
   * @remarks
   * NULL counts as false.
   *
   * @throws `ProcessingError` when the expression fails, or is not a single boolean.
   */
  private holds(expression: Expression): boolean {
    const { test } = this.structure;
    const { outcomes, scope, context } = this.rules;
    const value = evaluateTestExpression(expression, test.model, outcomes, scope, context);
    if (value === null) return false;
    if (value.cardinality !== "single" || value.baseType !== "boolean") {
      const found = value.cardinality === "record" ? "a record" : `${value.cardinality} ${value.baseType}`;
      throw new ProcessingError(`A pre-condition or branch rule must give a single boolean, found ${found}.`);
    }
    return value.value === true;
  }

  /** Whether every pre-condition of the frame is true, evaluated in order. */
  private eligible(frame: Frame): boolean {
    return this.modelOf(frame).preConditions.every((condition) => this.holds(condition.operand));
  }

  /** Whether the frame is an item of an adaptive section, whose pre-conditions and branch rules are ignored. */
  private inAdaptive(frame: Frame): boolean {
    if (frame.node.kind !== "item") return false;
    return pathTo(frame).some(
      ({ node }) =>
        node.kind === "section" && this.structure.section(node.identifier)?.model.adaptiveSelection !== undefined,
    );
  }

  /** Returns the move that starts the adaptive section of a frame, `undefined` when the frame is not one to start. */
  private startAdaptive(frame: Frame): Move | undefined {
    const { node } = frame;
    const started = this.rules.catStarted;
    if (node.kind !== "section" || started === undefined || started(node.identifier, node.instance)) return undefined;
    if (this.structure.section(node.identifier)?.model.adaptiveSelection === undefined) return undefined;
    return { to: "adaptive", section: node.identifier, instance: node.instance };
  }

  /** Enters a node: skips it when a pre-condition is false, presents an item, else goes to the first child. */
  private enter(frame: Frame): Move {
    if (this.applies(frame) && !this.inAdaptive(frame) && !this.eligible(frame)) return { to: "after", frame };
    if (frame.node.kind === "item") return { to: "present", key: frame.node.key };
    const [first] = frame.children;
    if (first !== undefined) return { to: "enter", frame: first };
    return this.startAdaptive(frame) ?? { to: "complete", frame };
  }

  /** Completes a node that was entered: the first branch rule that is true decides, else the walk goes on after it. */
  private complete(frame: Frame): Move {
    if (!this.applies(frame) || this.inAdaptive(frame)) return { to: "after", frame };
    for (const rule of this.modelOf(frame).branchRules) {
      const destination = this.destination(frame, rule.target);
      if (destination !== undefined && this.holds(rule.expression)) return destination;
    }
    return { to: "after", frame };
  }

  /** Goes on after a node: to its next sibling, else completes its parent; after the last part the test ends. */
  private next(frame: Frame): Move {
    const siblings = frame.parent === undefined ? this.frames.roots : frame.parent.children;
    const sibling = siblings[frame.index + 1];
    if (sibling !== undefined) return { to: "enter", frame: sibling };
    return frame.parent === undefined ? END : { to: "complete", frame: frame.parent };
  }

  /**
   * Returns where a branch rule of a node leads when it fires, `undefined` when its target is not ahead of the node. A
   * target is ahead when it comes after everything in the node and is a test part or lies in the node's own test part;
   * one that selection left out is not in the plan.
   *
   * - `EXIT_TEST` ends the test and `EXIT_TESTPART` completes the test part, so that its branch rules follow.
   * - `EXIT_SECTION` completes the section that holds the node, so that its branch rules follow. A node that is a
   *   section or a part has nothing to leave: the walk goes on after it.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  private destination(owner: Frame, target: string): Move | undefined {
    switch (target) {
      case EXIT_TEST:
        return END;
      case EXIT_TESTPART:
        return this.leave(owner, rootOf(owner));
      case EXIT_SECTION:
        return this.leave(owner, owner.node.kind === "item" ? owner.parent : owner);
      default: {
        const ahead = this.ahead(owner, target);
        return ahead === undefined ? undefined : this.jump(owner, ahead);
      }
    }
  }

  private leave(owner: Frame, container: Frame | undefined): Move {
    return container === undefined || container === owner
      ? { to: "after", frame: owner }
      : { to: "complete", frame: container };
  }

  private ahead(owner: Frame, identifier: string): Frame | undefined {
    const part = rootOf(owner);
    return this.frames.named
      .get(identifier)
      ?.find((frame) => frame.start > owner.last && (frame.node.kind === "part" || rootOf(frame) === part));
  }

  /**
   * Goes to a target: the sections that it lies in and the walk has not entered are entered from the outermost, and a
   * pre-condition that is false skips the section that has it.
   */
  private jump(owner: Frame, target: Frame): Move {
    const inside = new Set(pathTo(owner));
    for (const frame of pathTo(target)) {
      if (frame !== target && !inside.has(frame) && !this.eligible(frame)) return { to: "after", frame };
    }
    return { to: "enter", frame: target };
  }
}

/** Returns the item of a destination of a walk, `undefined` for any other. */
function keyOf(destination: Destination): ItemKey | undefined {
  return destination.to === "item" ? destination.key : undefined;
}

/** Checks the arguments that every navigation function takes. */
function checkArguments(structure: TestStructure, plan: TestPlan): void {
  checkRecord(structure, "The structure must be an object from resolveStructure");
  for (const lookup of [structure.part, structure.section, structure.itemRef]) {
    checkFunction(lookup, "The structure must be an object from resolveStructure");
  }
  checkRecord(plan, "The plan must be an object from a delivery state");
  checkArray(plan.parts, "The plan must be an object from a delivery state, with an array parts");
}

/**
 * Returns the item to present after the candidate leaves an item, or the first item of the test.
 *
 * @remarks
 * - In a nonlinear test part the next item is the next one in the plan, and the first item of the next part after the
 *   last; pre-conditions and branch rules are ignored there, and so are those of the part itself.
 * - In a linear part, entering a node evaluates its `qti-pre-condition`s in order and skips the node, with everything
 *   in it, when one is false or NULL. Completing a node, after its last child or after an exit, evaluates its
 *   `qti-branch-rule`s in order and the first that is true decides. A skipped node is not completed, so its branch rules
 *   do not run. A part that has no item to present is passed over.
 * - A branch rule target is an item or a section in the same part, or a test part, ahead of the node that has the
 *   rule; a rule whose target is behind it, inside it, in another part, or not in the plan because selection left it out,
 *   is not evaluated. The target is entered, from the outermost section that the walk has not entered; a false
 *   pre-condition on the way skips that section. Of the occurrences of a target that selection with replacement repeated,
 *   the first ahead is the target.
 * - `EXIT_SECTION` completes the section that holds the node, `EXIT_TESTPART` the test part, and `EXIT_TEST` ends the
 *   test; the branch rules of what is completed follow. A rule of a section for `EXIT_SECTION`, or of a part for
 *   `EXIT_TESTPART`, finds nothing to leave and the walk goes on after the node.
 * - A section that ordering mixed into its parent is not in the plan, so its pre-conditions and branch rules do not
 *   run.
 *
 * @param structure - The test, from {@link resolveStructure}.
 * @param plan - The plan of the session, from a delivery state.
 * @param from - The item the candidate leaves. Without it, the start of the test, which gives its first item.
 * @param rules - What the expressions read.
 * @returns The next item instance; `undefined` when the test has no further item.
 * @throws `DataError` when an argument has the wrong type, the plan does not match the structure, or `from` is not in
 * the plan.
 * @throws `ProcessingError` when an expression fails, or does not give a single boolean or NULL.
 * @throws `SecurityError` when an expression builds a container above the limit.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-pre-condition}
 */
export function findNextItem(
  structure: TestStructure,
  plan: TestPlan,
  from: ItemKey | undefined,
  rules: RuleContext,
): ItemKey | undefined {
  checkArguments(structure, plan);
  if (from !== undefined) checkKey(from);
  checkRecord(rules, "The rule context must be an object");
  const walk = new Walk(structure, plan, rules);
  return keyOf(from === undefined ? walk.start() : walk.after(from));
}

/**
 * Returns where the candidate goes on leaving an item, or a section it lies in, as {@link findNextItem} decides, except
 * that the walk stops at the end of the test part of the item: the engine ends the part, so that its submissions and
 * outcome processing come first, then calls {@link itemAfterPart}. Its callers pass a structure, a plan and an instance
 * of the session, so the arguments are not checked.
 *
 * @param node - The identifier of the item reference of `from`, or of a section that `from` lies in.
 * @throws `ProcessingError` when an expression fails, or does not give a single boolean or NULL.
 * @throws `SecurityError` when an expression builds a container above the limit.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function destinationAfter(
  structure: TestStructure,
  plan: TestPlan,
  from: ItemKey,
  node: string,
  rules: RuleContext,
): Destination {
  return new Walk(structure, plan, rules).depart(from, node);
}

/**
 * Returns where the candidate goes once a test part ended, as {@link itemAfterPart} decides, with the adaptive sections
 * the candidate has not entered among the destinations.
 *
 * @remarks
 * Its callers pass a structure and a plan of the session.
 *
 * @throws `ProcessingError` when an expression fails, or does not give a single boolean or NULL.
 * @throws `SecurityError` when an expression builds a container above the limit.
 */
export function destinationAfterPart(
  structure: TestStructure,
  plan: TestPlan,
  part: string,
  rules: RuleContext,
): Destination {
  return new Walk(structure, plan, rules).afterPart(part);
}

/**
 * Returns where the candidate goes on leaving an adaptive section that has no item to present, as {@link findNextItem}
 * decides.
 *
 * @remarks
 * Its callers pass a structure and a plan of the session.
 *
 * @throws `ProcessingError` when an expression fails, or does not give a single boolean or NULL.
 * @throws `SecurityError` when an expression builds a container above the limit.
 */
export function destinationAfterSection(
  structure: TestStructure,
  plan: TestPlan,
  section: string,
  instance: number,
  rules: RuleContext,
): Destination {
  return new Walk(structure, plan, rules).afterSection(section, instance);
}

/**
 * Returns where the session starts, as {@link findNextItem} decides without a `from`, with an adaptive section among the
 * destinations.
 *
 * @remarks
 * Its callers pass a structure and a plan of the session.
 *
 * @throws `ProcessingError` when an expression fails, or does not give a single boolean or NULL.
 * @throws `SecurityError` when an expression builds a container above the limit.
 */
export function startDestination(structure: TestStructure, plan: TestPlan, rules: RuleContext): Destination {
  return new Walk(structure, plan, rules).start();
}

/**
 * Returns the item before an item in its test part, which the candidate may go back to: only in a nonlinear part, since
 * a linear part moves forward only.
 *
 * @param structure - The test, from {@link resolveStructure}.
 * @param plan - The plan of the session, from a delivery state.
 * @param from - The item the candidate leaves.
 * @returns The previous item instance; `undefined` for the first item of the part and for any item of a linear part.
 * @throws `DataError` when an argument has the wrong type, the plan does not match the structure, or `from` is not in
 * the plan.
 */
export function findPreviousItem(structure: TestStructure, plan: TestPlan, from: ItemKey): ItemKey | undefined {
  checkArguments(structure, plan);
  checkKey(from);
  for (const part of plan.parts) {
    const items = listPlanItems(plan, { part: part.identifier });
    const at = items.findIndex((key) => sameKey(key, from));
    if (at >= 0) return navigationMode(structure, part.identifier) === "nonlinear" ? items[at - 1] : undefined;
  }
  throw new DataError(`The plan has no item instance ${describe(from.ref)} ${from.instance}.`);
}
