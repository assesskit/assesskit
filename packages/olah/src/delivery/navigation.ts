import type { Expression } from "../asi/index.js";
import { checkArray, checkFunction, checkRecord, describe } from "../checks.js";
import { DataError, ProcessingError } from "../errors.js";
import { evaluateTestExpression, type ProcessingContext, type TestScope } from "../processing/index.js";
import type { Value } from "../values/index.js";
import {
  checkKey,
  type ItemKey,
  type PlannedChild,
  type PlannedPart,
  planItems,
  sameKey,
  type TestPlan,
} from "./plan.js";
import type { TestStructure } from "./structure.js";

/**
 * What the expressions of pre-conditions and branch rules read: the outcomes of the test as they are now, the item
 * sessions and other variables of the test, and the processing context (INFO §2.8.3). They are the arguments of
 * `runOutcomeProcessing` after the test.
 */
export interface RuleContext {
  /** The values of the outcomes of the test, by identifier; an outcome left out has its starting value. */
  readonly outcomes: ReadonlyMap<string, Value | null>;
  /** The item sessions and the other variables of the test. */
  readonly scope: TestScope;
  /** The source of random draws, the custom operators and the limits. */
  readonly context: ProcessingContext;
}

/** The branch rule targets that name no node but a place to leave (INFO §5.23.1). */
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

/** What the walk does next: it enters, completes or goes on after a node, stops at an item to present, or ends. */
type Move =
  | { readonly to: "enter" | "complete" | "after"; readonly frame: Frame }
  | { readonly to: "present"; readonly key: ItemKey }
  | { readonly to: "end" };

const END: Move = { to: "end" };

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
    build.named.set(identifier, [...(build.named.get(identifier) ?? []), frame]);
    if (node.kind !== "item") children.push(...buildFrames(node.children, frame, build));
    frame.last = build.next - 1;
    return frame;
  });
}

function indexPlan(plan: TestPlan): Frames {
  const build: Build = { next: 0, named: new Map() };
  const roots = buildFrames(plan.parts, undefined, build);
  return { roots, named: build.named };
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
 * what a pre-condition rules out and follows the branch rules (INFO §2.8.3). The rules of a test part and of what it
 * holds apply only when the part is linear.
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

  /** Returns the first item to present, `undefined` when the test has none. */
  start(): ItemKey | undefined {
    const [first] = this.frames.roots;
    return this.run(first === undefined ? END : { to: "enter", frame: first });
  }

  /**
   * Returns the item to present after the candidate leaves an item, `undefined` when the test ends.
   *
   * @throws `DataError` when the plan has no such item instance.
   */
  after(key: ItemKey): ItemKey | undefined {
    const frame = this.frames.named
      .get(key.ref)
      ?.find((candidate) => candidate.node.kind === "item" && sameKey(candidate.node.key, key));
    if (frame === undefined) {
      throw new DataError(`The plan has no item instance ${describe(key.ref)} ${key.instance}.`);
    }
    return this.run({ to: "complete", frame });
  }

  private run(first: Move): ItemKey | undefined {
    let move = first;
    for (;;) {
      switch (move.to) {
        case "present":
          return move.key;
        case "end":
          return undefined;
        case "enter":
          move = this.enter(move.frame);
          break;
        case "complete":
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

  /** Whether the rules of the frame apply: its test part is linear (INFO §2.8.3). */
  private applies(frame: Frame): boolean {
    return navigationMode(this.structure, identifierOf(rootOf(frame).node)) === "linear";
  }

  /**
   * Returns whether an expression is true. NULL counts as false (B47).
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
      throw new ProcessingError(
        `A pre-condition or branch rule must give a single boolean, found ${found}.`,
        "INFO §2.8.3",
      );
    }
    return value.value === true;
  }

  /** Whether every pre-condition of the frame is true, evaluated in order (INFO §4.2.9). */
  private eligible(frame: Frame): boolean {
    return this.modelOf(frame).preConditions.every((condition) => this.holds(condition.operand));
  }

  /** Enters a node: skips it when a pre-condition is false, presents an item, else goes to the first child. */
  private enter(frame: Frame): Move {
    if (this.applies(frame) && !this.eligible(frame)) return { to: "after", frame };
    if (frame.node.kind === "item") return { to: "present", key: frame.node.key };
    const [first] = frame.children;
    return first === undefined ? { to: "complete", frame } : { to: "enter", frame: first };
  }

  /** Completes a node that was entered: the first branch rule that is true decides, else the walk goes on after it. */
  private complete(frame: Frame): Move {
    if (!this.applies(frame)) return { to: "after", frame };
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
   * Returns where a branch rule of a node leads when it fires, `undefined` when its target is not ahead of the node
   * (INFO §5.23.1). A target is ahead when it comes after everything in the node and is a test part or lies in the
   * node's own test part; one that selection left out is not in the plan.
   *
   * - `EXIT_TEST` ends the test and `EXIT_TESTPART` completes the test part, so that its branch rules follow.
   * - `EXIT_SECTION` completes the section that holds the node, so that its branch rules follow. A node that is a
   *   section or a part has nothing to leave: the walk goes on after it.
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

/** Checks the arguments that every navigation function takes. */
function checkArguments(structure: TestStructure, plan: TestPlan): void {
  checkRecord(structure, "The structure must be an object from resolveStructure");
  for (const lookup of [structure.part, structure.section, structure.itemRef]) {
    checkFunction(lookup, "The structure must be an object from resolveStructure");
  }
  checkRecord(plan, "The plan must be an object from planTest");
  checkArray(plan.parts, "The plan must be an object from planTest, with an array parts");
}

/**
 * Returns the item to present after the candidate leaves an item, or the first item of the test (B26, B28, B29).
 *
 * - In a nonlinear test part the next item is the next one in the plan, and the first item of the next part after the
 *   last; pre-conditions and branch rules are ignored there, and so are those of the part itself (INFO §2.8.3).
 * - In a linear part, entering a node evaluates its `qti-pre-condition`s in order and skips the node, with everything
 *   in it, when one is false or NULL. Completing a node, after its last child or after an exit, evaluates its
 *   `qti-branch-rule`s in order and the first that is true decides. A skipped node is not completed, so its branch
 *   rules do not run. A part that has no item to present is passed over.
 * - A branch rule target is an item or a section in the same part, or a test part, ahead of the node that has the
 *   rule; a rule whose target is behind it, inside it, in another part, or not in the plan because selection left it
 *   out, is not evaluated. The target is entered, from the outermost section that the walk has not entered; a false
 *   pre-condition on the way skips that section. Of the occurrences of a target that selection with replacement
 *   repeated, the first ahead is the target.
 * - `EXIT_SECTION` completes the section that holds the node, `EXIT_TESTPART` the test part, and `EXIT_TEST` ends the
 *   test; the branch rules of what is completed follow. A rule of a section for `EXIT_SECTION`, or of a part for
 *   `EXIT_TESTPART`, finds nothing to leave and the walk goes on after the node.
 * - A section that ordering mixed into its parent is not in the plan, so its pre-conditions and branch rules do not
 *   run.
 *
 * @param from - The item the candidate leaves. Default: the start of the test, which gives its first item.
 * @param rules - What the expressions read.
 * @returns The next item instance; `undefined` when the test has no further item.
 * @throws `DataError` when an argument has the wrong type, the plan does not match the structure, or `from` is not in
 * the plan.
 * @throws `ProcessingError` when an expression fails, or does not give a single boolean or NULL.
 * @throws `SecurityError` when an expression builds a container above the limit.
 */
export function nextItem(
  structure: TestStructure,
  plan: TestPlan,
  from: ItemKey | undefined,
  rules: RuleContext,
): ItemKey | undefined {
  checkArguments(structure, plan);
  if (from !== undefined) checkKey(from);
  checkRecord(rules, "The rule context must be an object");
  const walk = new Walk(structure, plan, rules);
  return from === undefined ? walk.start() : walk.after(from);
}

/**
 * Returns the item before an item in its test part, which the candidate may go back to: only in a nonlinear part, since
 * a linear part moves forward only (B26).
 *
 * @returns The previous item instance; `undefined` for the first item of the part and for any item of a linear part.
 * @throws `DataError` when an argument has the wrong type, the plan does not match the structure, or `from` is not in
 * the plan.
 */
export function previousItem(structure: TestStructure, plan: TestPlan, from: ItemKey): ItemKey | undefined {
  checkArguments(structure, plan);
  checkKey(from);
  for (const part of plan.parts) {
    const items = planItems(plan, part.identifier);
    const at = items.findIndex((key) => sameKey(key, from));
    if (at >= 0) return navigationMode(structure, part.identifier) === "nonlinear" ? items[at - 1] : undefined;
  }
  throw new DataError(`The plan has no item instance ${describe(from.ref)} ${from.instance}.`);
}
