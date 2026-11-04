import { describe, expect, it } from "vitest";
import {
  type AssessmentItem,
  type BodyNode,
  buildContainer,
  createItemVariables,
  createRandom,
  type ItemVariables,
  isShown,
  listDescendantNodes,
  type ModelNode,
  ProcessingError,
  resolveContent,
  runTemplateProcessing,
} from "../src/index.js";
import { exampleItems } from "./corpus-items.js";

const items = exampleItems();

/** The variables of a new session of the item after template processing, or `undefined` when processing refuses the item. */
function instanceOf(item: AssessmentItem): ItemVariables | undefined {
  try {
    return runTemplateProcessing(item, createItemVariables(item), { random: createRandom(3) });
  } catch (error) {
    if (error instanceof ProcessingError) return undefined;
    throw error;
  }
}

const nodesOf = (nodes: readonly ModelNode[]): ModelNode[] =>
  nodes.flatMap((node) => [node, ...listDescendantNodes(node)]);
const countKinds = (nodes: readonly ModelNode[], kinds: ReadonlySet<string>): number =>
  nodesOf(nodes).filter((node) => kinds.has(node.kind)).length;

/** The content that an outcome or a template variable shows or hides. */
const CONTROLLED = new Set(["feedback-block", "feedback-inline", "template-block", "template-inline"]);

/** A node that an outcome or a template variable controls, with the attributes that decide. */
interface Controlled extends ModelNode {
  readonly outcomeIdentifier?: string;
  readonly templateIdentifier?: string;
  readonly identifier: string;
  readonly showHide?: "hide" | "show";
}

const isControlled = (node: ModelNode): node is Controlled => CONTROLLED.has(node.kind);

/** A node of the XML that the model keeps for MathML. */
interface XmlPart {
  readonly kind: string;
  readonly name?: string;
  readonly value?: string;
  readonly children?: readonly XmlPart[];
}

/** The text of each MathML element named so, below the nodes, in document order. */
function mathTexts(nodes: readonly ModelNode[], names: ReadonlySet<string>): string[] {
  const texts: string[] = [];
  const visit = (element: XmlPart): void => {
    for (const child of element.children ?? []) if (child.kind === "element") visit(child);
    if (element.name !== undefined && names.has(element.name)) {
      texts.push(
        (element.children ?? [])
          .map((part) => part.value ?? "")
          .join("")
          .trim(),
      );
    }
  };
  for (const node of nodesOf(nodes)) if (node.kind === "element") visit(node);
  return texts;
}

const IDENTIFIERS = new Set(["mi", "ci"]);
const NUMBERS = new Set(["mn", "cn"]);

describe("the content of the 1EdTech examples", () => {
  it("has its printed variables printed, in every example", () => {
    let printed = 0;
    for (const { path, item } of items) {
      const instance = instanceOf(item);
      if (instance === undefined) continue;
      const body = item.body?.children ?? [];
      printed += countKinds(body, new Set(["printed-variable"]));
      const resolved = resolveContent(body, instance, item, { view: "candidate" });
      expect(countKinds(resolved, new Set(["printed-variable"])), path).toBe(0);
    }
    expect(printed).toBeGreaterThan(20);
  });

  it("keeps no feedback or template content that is hidden, and at most what is shown, in every example", () => {
    let hidden = 0;
    for (const { path, item } of items) {
      const instance = instanceOf(item);
      if (instance === undefined) continue;
      const body = item.body?.children ?? [];
      const resolved = resolveContent(body, instance, item, { view: "candidate" });
      let shown = 0;
      for (const node of nodesOf(body)) {
        if (!isControlled(node)) continue;
        const value =
          node.outcomeIdentifier === undefined
            ? (instance.templates.get(node.templateIdentifier ?? "") ?? null)
            : (instance.outcomes.get(node.outcomeIdentifier) ?? null);
        if (isShown(node.showHide, node.identifier, value)) shown++;
        else hidden++;
      }
      expect(countKinds(resolved, CONTROLLED), path).toBeLessThanOrEqual(shown);
    }
    expect(hidden).toBeGreaterThan(20);
  });

  it("has the MathML identifiers of its math variables replaced by their values: Example04 of the feedback tests", () => {
    const example = items.find(({ path }) => path === "packaging/items/Example04-feedbackBlock-templateBlock.xml");
    if (example === undefined) throw new Error("The example is missing.");
    const { item } = example;
    const instance = instanceOf(item);
    if (instance === undefined) throw new Error("Template processing refuses the example.");
    const body: readonly BodyNode[] = item.body?.children ?? [];
    // The solution is in feedback that the outcome FEEDBACK shows: let it name every feedback block of the item.
    const feedback = nodesOf(body).flatMap((node) =>
      "outcomeIdentifier" in node ? [String(Reflect.get(node, "identifier"))] : [],
    );
    const outcomes = new Map(instance.outcomes).set("FEEDBACK", buildContainer("multiple", "identifier", feedback));
    const mathVariables = new Set(
      item.templateDeclarations.filter(({ mathVariable }) => mathVariable).map(({ identifier }) => identifier),
    );
    const resolved = resolveContent(body, { ...instance, outcomes }, item, { view: "candidate" });
    // Template processing shows the block of the right angle case: its MathML and the printed variables are kept.
    expect(countKinds(resolved, new Set(["template-block"]))).toBe(1);
    const identifiers = mathTexts(resolved, IDENTIFIERS);
    expect(identifiers.length).toBeGreaterThan(0);
    expect(identifiers.filter((name) => mathVariables.has(name))).toEqual([]);
    expect(mathTexts(body, IDENTIFIERS).filter((name) => mathVariables.has(name)).length).toBeGreaterThan(5);
    // The numbers that resolution added are the values of the math variables: integers as they are, floats to 6 figures.
    const values = new Set(
      [...mathVariables].flatMap((identifier) => {
        const value = instance.templates.get(identifier);
        if (value?.cardinality !== "single" || typeof value.value !== "number") return [];
        return [value.baseType === "integer" ? String(value.value) : String(Number(value.value.toPrecision(6)))];
      }),
    );
    const authored = mathTexts(body, NUMBERS);
    const added = mathTexts(resolved, NUMBERS).filter((text) => {
      const at = authored.indexOf(text);
      if (at < 0) return true;
      authored.splice(at, 1);
      return false;
    });
    expect(added).toHaveLength(3);
    expect(added.filter((text) => !values.has(text))).toEqual([]);
  });
});
