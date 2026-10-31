import type { BranchRule, Expression } from "../asi/index.js";
import type { Findings } from "./findings.js";
import {
  mayRepeat,
  type Placed,
  type PlacedItemRef,
  type PlacedPart,
  type PlacedSection,
  type PlacedTest,
  partOf,
} from "./test-structure.js";

/** The targets of a branch rule that name no identifier (INFO §5.23.1). */
const EXIT_SECTION = "EXIT_SECTION";
const EXIT_TESTPART = "EXIT_TESTPART";
const EXIT_TEST = "EXIT_TEST";
const EXITS = new Set([EXIT_SECTION, EXIT_TESTPART, EXIT_TEST]);

/** A node that carries branch rules and pre-conditions. */
type Ruled = PlacedPart | PlacedSection | PlacedItemRef;

/** Returns whether a branch rule always branches: its expression is the constant true. */
function always({ expression }: { readonly expression: Expression }): boolean {
  return (
    expression.kind === "base-value" &&
    expression.baseType === "boolean" &&
    ["true", "1"].includes(expression.value.trim())
  );
}

function insideAdaptive(node: Placed): boolean {
  if (node.kind === "part") return false;
  for (let at: Placed = node.parent; at.kind !== "part"; at = at.parent) {
    if (at.model.adaptiveSelection !== undefined) return true;
  }
  return false;
}

/** Returns the name of a node's element for messages and locations. */
function elementOf(node: Placed): string {
  return node.kind === "part"
    ? "qti-test-part"
    : node.kind === "section"
      ? "qti-assessment-section"
      : "qti-assessment-item-ref";
}

const ROOT = "qti-assessment-test";

/** Checks the branch rules and pre-conditions of a placed test: the targets, the nodes no path reaches, and the rules that are ignored. */
export class BranchRuleChecks {
  private readonly findings: Findings;
  private readonly placed: PlacedTest;
  private readonly nodes: readonly Ruled[];

  constructor(placed: PlacedTest, findings: Findings) {
    this.findings = findings;
    this.placed = placed;
    const sections = (section: PlacedSection): Ruled[] => [
      section,
      ...section.children.flatMap((child) => (child.kind === "section" ? sections(child) : [child])),
    ];
    this.nodes = placed.parts.flatMap((part) => [part, ...part.sections.flatMap(sections)]);
  }

  /** Runs every check. */
  check(): void {
    for (const node of this.nodes) {
      for (const rule of node.model.branchRules) this.target(node, rule);
      this.ignored(node);
    }
    this.unreachableParts();
    for (const part of this.placed.parts) this.unreachableItems(part);
  }

  private path(node: Placed): string {
    return `${ROOT}/${elementOf(node)}/qti-branch-rule`;
  }

  /** Checks that the target of a branch rule is a node ahead of the one that has the rule, of the kind it may name (INFO §5.23). */
  private target(source: Ruled, rule: BranchRule): void {
    const { target } = rule;
    if (EXITS.has(target)) return;
    const node = this.placed.byIdentifier.get(target);
    const here = this.path(source);
    const name = JSON.stringify(target);
    if (node === undefined) {
      const message = `The branch rule of the ${elementOf(source)} ${JSON.stringify(source.model.identifier)} names the target ${name}, which is no test part, section or item reference of the test.`;
      this.findings.error("assesskit/validate/branch-target", message, "INFO §5.23.1", here);
      return;
    }
    if (source.kind === "part" ? node.kind !== "part" : node.kind === "part" || partOf(node) !== partOf(source)) {
      const wanted = source.kind === "part" ? "another test part" : "an item or section in the same test part";
      const message = `The branch rule of the ${elementOf(source)} ${JSON.stringify(source.model.identifier)} names the target ${name}, but it must name ${wanted}.`;
      this.findings.error("assesskit/validate/branch-target", message, "INFO §5.23", here);
    } else if (node.order <= source.last) {
      const message = `The branch rule of the ${elementOf(source)} ${JSON.stringify(source.model.identifier)} names the target ${name}, which is not ahead of it; a branch rule only jumps forward, so that the paths through a test are trees.`;
      this.findings.error("assesskit/validate/branch-target", message, "INFO §2.8.3.2", here);
    }
    if (mayRepeat(node)) {
      const message = `The branch rule of the ${elementOf(source)} ${JSON.stringify(source.model.identifier)} names the target ${name}, which selection with replacement can repeat, so the target is ambiguous.`;
      this.findings.error("assesskit/validate/branch-to-repeated", message, "INFO §5.98", here);
    } else if (insideAdaptive(node)) {
      const message = `The branch rule of the ${elementOf(source)} ${JSON.stringify(source.model.identifier)} names the target ${name}, an item of an adaptive section, so the rule is ignored.`;
      this.findings.warning("assesskit/validate/ignored-rule", message, "CAT §2.1", here);
    }
  }

  /** Warns about the rules of items and sections that the navigation mode or an adaptive section ignores (INFO §2.8.3, CAT §2.1). */
  private ignored(node: Ruled): void {
    if (node.kind === "part" || (node.model.branchRules.length === 0 && node.model.preConditions.length === 0)) return;
    const nonlinear = partOf(node).model.navigationMode === "nonlinear";
    if (!nonlinear && !insideAdaptive(node)) return;
    const why = nonlinear ? "the test part is navigated in nonlinear mode" : "the section selects its items adaptively";
    const message = `The ${elementOf(node)} ${JSON.stringify(node.model.identifier)} has branch rules or pre-conditions, which are ignored because ${why}.`;
    this.findings.warning(
      "assesskit/validate/ignored-rule",
      message,
      nonlinear ? "INFO §2.8.3" : "CAT §2.1",
      `${ROOT}/${elementOf(node)}`,
    );
  }

  /** The index of the first node after a section, among a list of nodes in presentation order. */
  private static after<T extends Placed>(nodes: readonly T[], last: number): number {
    const index = nodes.findIndex((node) => node.order > last);
    return index === -1 ? nodes.length : index;
  }

  /**
   * Finds the indexes among `nodes` that a node's rules may lead to. A rule leads to the first node of its target, and an
   * exit of the part or test to the end, the index after the last node.
   */
  private jumps<T extends Placed>(nodes: readonly T[], source: Ruled, rules: readonly BranchRule[]): readonly number[] {
    return rules.flatMap((rule) => {
      if (rule.target === EXIT_SECTION) {
        return source.kind === "item-ref"
          ? [BranchRuleChecks.after(nodes, source.parent.last)]
          : [BranchRuleChecks.after(nodes, source.last)];
      }
      if (EXITS.has(rule.target)) return [nodes.length];
      const target = this.placed.byIdentifier.get(rule.target);
      if (target === undefined) return [];
      const index = nodes.findIndex((node) => node.order >= target.order && node.order <= target.last);
      return index === -1 ? [] : [index];
    });
  }

  /** Walks the nodes from the first along the sequence and the branch rules and returns the indexes it reaches. */
  private static reach(
    count: number,
    leaving: (index: number) => { readonly next: boolean; readonly jumps: readonly number[] },
  ): Set<number> {
    const reached = new Set<number>();
    const open = [0];
    for (let index = open.pop(); index !== undefined; index = open.pop()) {
      if (index >= count || reached.has(index)) continue;
      reached.add(index);
      const { next, jumps } = leaving(index);
      open.push(...jumps, ...(next ? [index + 1] : []));
    }
    return reached;
  }

  private unreachableParts(): void {
    const parts = this.placed.parts;
    const reached = BranchRuleChecks.reach(parts.length, (index) => {
      const part = parts[index];
      if (part === undefined) return { next: false, jumps: [] };
      const rules = part.model.branchRules;
      return { next: !rules.some(always), jumps: this.jumps(parts, part, rules) };
    });
    parts.forEach((part, index) => {
      if (reached.has(index)) return;
      const message = `The test part ${JSON.stringify(part.model.identifier)} is never presented: a branch rule that is always true jumps over it.`;
      this.findings.warning("assesskit/validate/unreachable", message, "INFO §2.8.3.2", `${ROOT}/qti-test-part`);
    });
  }

  private unreachableItems(part: PlacedPart): void {
    if (part.model.navigationMode !== "linear") return;
    const items = this.placed.itemRefs.filter((item) => partOf(item) === part);
    const endsAt = (item: PlacedItemRef): readonly BranchRule[] => {
      const sections: PlacedSection[] = [];
      for (let at: Placed = item.parent; at.kind === "section"; at = at.parent)
        if (at.last === item.last) sections.push(at);
      return [...item.model.branchRules, ...sections.flatMap((section) => section.model.branchRules)];
    };
    const reached = BranchRuleChecks.reach(items.length, (index) => {
      const item = items[index];
      if (item === undefined) return { next: false, jumps: [] };
      const rules = endsAt(item);
      return { next: !rules.some(always), jumps: this.jumps(items, item, rules) };
    });
    items.forEach((item, index) => {
      if (reached.has(index) || insideAdaptive(item)) return;
      const message = `The item reference ${JSON.stringify(item.model.identifier)} is never presented: a branch rule that is always true jumps over it.`;
      this.findings.warning(
        "assesskit/validate/unreachable",
        message,
        "INFO §2.8.3.2",
        `${ROOT}/qti-assessment-item-ref`,
      );
    });
  }
}
