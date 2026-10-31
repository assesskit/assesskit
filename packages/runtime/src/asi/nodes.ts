import { isRecord } from "../checks.js";
import type { BodyNode } from "./body.js";

/**
 * A node of the content model, whatever its element: the field that every element model, text node and XML element has
 * is the `kind` that names it. Narrow a node by its `kind`, or with a guard such as `isBodyNode`.
 */
export interface ModelNode {
  /** The name of the element without `qti-`, `"text"` for text, or `"element"` for MathML, SSML and `xi:include`. */
  readonly kind: string;
}

/**
 * Returns whether a value is a node of the content model: an object whose `kind` is a string. The check is shallow;
 * `writeAsi` checks the rest when it writes the tree.
 *
 * @param value - The value to test.
 * @returns `true` for a node of the model of an element.
 */
export function isModelNode(value: unknown): value is ModelNode {
  return isRecord(value) && typeof value.kind === "string";
}

/**
 * Returns whether a value is a node of flow content, such as the children of an item body: like {@link isModelNode}, a
 * shallow check of the `kind`. Use it for a node that came from flow content and went through code that copies nodes.
 *
 * @param value - The value to test.
 * @returns `true` for a node of flow content.
 */
export function isBodyNode(value: unknown): value is BodyNode {
  return isModelNode(value);
}

/** The `kind` of an XML element that the model keeps as XML: MathML, SSML or `xi:include`. */
const XML_ELEMENT = "element";

/**
 * Returns the nodes directly below a node, in every place the model keeps them: the flow content in `children`, a prompt,
 * the choices of an interaction, the content body of feedback, and so on. MathML, SSML and `xi:include` are leaves,
 * because the model keeps them as XML.
 *
 * @param node - A node of the model.
 * @returns The child nodes in document order, text and elements.
 */
export function childNodes(node: ModelNode): readonly ModelNode[] {
  const children: ModelNode[] = [];
  if (node.kind === XML_ELEMENT) return children;
  for (const property of Object.values(node)) {
    if (!Array.isArray(property)) {
      if (isModelNode(property)) children.push(property);
      continue;
    }
    for (const entry of property) if (isModelNode(entry)) children.push(entry);
  }
  return children;
}

/** Appends the nodes below a node to `found`, depth first. */
function collect(node: ModelNode, found: ModelNode[]): void {
  for (const child of childNodes(node)) {
    found.push(child);
    collect(child, found);
  }
}

/**
 * Returns the nodes below a node at any depth, in document order, without the node itself.
 *
 * @param node - A node of the model.
 * @returns Every node below it, depth first, in document order.
 */
export function descendantNodes(node: ModelNode): readonly ModelNode[] {
  const found: ModelNode[] = [];
  collect(node, found);
  return found;
}

/**
 * Returns the nodes of some content and every node below them: each node is followed by its descendants, in document
 * order.
 *
 * @param nodes - The root nodes of the content, such as the children of an item body.
 */
export function withDescendants(nodes: readonly ModelNode[]): readonly ModelNode[] {
  const found: ModelNode[] = [];
  for (const node of nodes) {
    found.push(node);
    collect(node, found);
  }
  return found;
}
