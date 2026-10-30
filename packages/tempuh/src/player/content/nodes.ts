import {
  childNodes,
  type Interaction,
  isModelNode,
  type ModelNode,
  type PrintedVariable,
  type RubricBlock,
  type TestRubricBlock,
} from "@luthfanwakan/olah/asi";
import { rubricBlocksFor } from "@luthfanwakan/olah/content";
import { resolveReference } from "@luthfanwakan/olah/package";
import type { XmlElement } from "@luthfanwakan/olah/xml";
import { checkArray, describe } from "../../checks.js";
import { DataError } from "../../errors.js";
import { setAttributes } from "./attributes.js";
import type { RenderContext } from "./context.js";
import { renderForeign } from "./foreign.js";
import { elementName } from "./html-elements.js";
import { renderImage, renderPlayer } from "./media.js";
import { renderObject } from "./object.js";
import { renderPrinted } from "./printed.js";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** A `kind` that is the name of an element: lower case letters, digits and hyphens. */
const KIND = /^[a-z][a-z0-9-]*$/u;

/**
 * The nodes that the player draws nowhere in the flow of content: stylesheets, which the content root loads from the paths
 * it is given, the catalogs, whose cards the candidate asks for (T17), and the parameters of an object.
 */
const NOT_DRAWN: ReadonlySet<string> = new Set(["stylesheet", "catalog-info", "param"]);

/** The terms of `use` that a rubric block can have; an `ext:` term is an extension that the player ignores (INFO §9.3.6). */
const RUBRIC_USES: ReadonlySet<string> = new Set(["instructions", "scoring", "navigation"]);

const isInteraction = (node: ModelNode): node is Interaction => node.kind.endsWith("-interaction");
const isRubricBlock = (node: ModelNode): node is RubricBlock | TestRubricBlock => node.kind === "rubric-block";
const isPrintedVariable = (node: ModelNode): node is PrintedVariable => node.kind === "printed-variable";

function isXmlElement(node: ModelNode): node is XmlElement {
  return (
    node.kind === "element" &&
    typeof Reflect.get(node, "namespace") === "string" &&
    typeof Reflect.get(node, "name") === "string" &&
    Array.isArray(Reflect.get(node, "attributes")) &&
    Array.isArray(Reflect.get(node, "children"))
  );
}

/** Builds the element for a node: see {@link BodyRenderer.element}. */
export function buildElement(
  name: string,
  node: ModelNode,
  children: readonly Node[],
  context: RenderContext,
): Element {
  const element = document.createElementNS(XHTML_NAMESPACE, name);
  setAttributes(element, node, context);
  element.append(...children);
  return element;
}

/** Marks the links the player draws: they open in a tab of its own and give the page no reference (T7). */
function openAway(element: Element): void {
  const href = element.getAttribute("href");
  if (href === null || href.startsWith("#")) return;
  element.setAttribute("target", "_blank");
  element.setAttribute("rel", "noopener noreferrer");
}

/** Renders a rubric block for the view of the renderer, or nothing when its `view` does not list it (INFO §2.8.6). */
function renderRubric(node: RubricBlock | TestRubricBlock, context: RenderContext): Node[] {
  if (rubricBlocksFor([node], context.view).length === 0) return [];
  const element = context.element("qti-rubric-block", node, context.nodes(childNodes(node)));
  if (RUBRIC_USES.has(node.use ?? "")) element.setAttribute("data-use", node.use ?? "");
  return [element];
}

/**
 * Renders the content of an interaction that has no renderer. The `label` that an interaction holds is the `qti-label` of
 * an inline choice (INFO §5.82), not the HTML element of that name, which only flow content holds.
 */
function renderPlaceholderContent(node: Interaction, context: RenderContext): Node[] {
  return childNodes(node).flatMap((child) =>
    child.kind === "label"
      ? [context.element("qti-label", child, context.nodes(childNodes(child)))]
      : context.nodes([child]),
  );
}

/** Renders an interaction with the renderer registered for its kind, or as a placeholder that holds its content. */
function renderInteraction(node: Interaction, context: RenderContext): Node[] {
  const render = context.interactions.get(node.kind);
  if (render !== undefined) return [render(node, context)];
  const placeholder = context.element(`qti-${node.kind}`, node, renderPlaceholderContent(node, context));
  placeholder.setAttribute("data-tempuh-placeholder", "");
  return [placeholder];
}

/**
 * Returns the context for an element and what it holds: the references below an element with `xml:base` start at that base,
 * resolved against the base of its parent (XML Base §4.2). A base outside the package changes nothing.
 */
function scopeOf(node: ModelNode, context: RenderContext): RenderContext {
  const xmlBase: unknown = Reflect.get(node, "xmlBase");
  const base = typeof xmlBase === "string" ? resolveReference(context.urls.base, xmlBase) : undefined;
  return base === undefined ? context : context.scope(base);
}

function renderElementNode(node: ModelNode, outer: RenderContext): Node[] {
  const context = scopeOf(node, outer);
  if (isXmlElement(node)) {
    const foreign = renderForeign(node, context.urls);
    return foreign === undefined ? [] : [foreign];
  }
  if (NOT_DRAWN.has(node.kind)) return [];
  if (isRubricBlock(node)) return renderRubric(node, context);
  if (isPrintedVariable(node)) return [renderPrinted(node, context)];
  if (isInteraction(node)) return renderInteraction(node, context);
  switch (node.kind) {
    case "object":
      return renderObject(node, context);
    case "img":
      return renderImage(node, context);
    case "audio":
    case "video":
      return renderPlayer(node, context);
    default: {
      const element = context.element(elementName(node.kind), node, context.nodes(childNodes(node)));
      if (node.kind === "a") openAway(element);
      return [element];
    }
  }
}

function renderNode(node: unknown, context: RenderContext): Node[] {
  if (!(isModelNode(node) && KIND.test(node.kind))) {
    throw new DataError(`A node of content must be an object whose kind names an element, found ${describe(node)}.`);
  }
  if (node.kind === "text") {
    const value: unknown = Reflect.get(node, "value");
    if (typeof value !== "string")
      throw new DataError(`The value of a text node must be a string, found ${describe(value)}.`);
    return [document.createTextNode(value)];
  }
  return renderElementNode(node, context);
}

/** Renders nodes: see {@link BodyRenderer.nodes}. */
export function renderNodes(nodes: readonly unknown[], context: RenderContext): Node[] {
  checkArray(nodes, "The nodes of content must be an array");
  return nodes.flatMap((node) => renderNode(node, context));
}
