import type { ModelNode, Prompt } from "@assesskit/runtime/asi";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { uniqueId } from "../internal.js";

/** A rendered `qti-prompt` and the `id` that names the interaction by it. */
export interface RenderedPrompt {
  /** The element, to put in the interaction. */
  readonly element: Element;
  /** Its `id`: the element's own, else one made for it. */
  readonly id: string;
}

/**
 * Renders the prompt of an interaction.
 *
 * @param prompt - The prompt, if the interaction has one.
 * @param renderer - The renderer of content.
 * @returns The prompt, or `undefined` when the interaction has none.
 */
export function renderPrompt(prompt: Prompt | undefined, renderer: BodyRenderer): RenderedPrompt | undefined {
  if (prompt === undefined) return undefined;
  const element = renderer.element("qti-prompt", prompt, renderer.nodes(prompt.children));
  if (!element.id) element.id = uniqueId("ak-prompt");
  return { element, id: element.id };
}

/**
 * Names an element by the prompt, so that a screen reader says the task with the group of controls.
 *
 * @param element - The element.
 * @param prompt - The rendered prompt, if there is one.
 * @see {@link https://www.w3.org/TR/WCAG22/#labels-or-instructions | WCAG 2.2, labels or instructions}
 */
export function nameByPrompt(element: Element, prompt: RenderedPrompt | undefined): void {
  if (prompt !== undefined) element.setAttribute("aria-labelledby", prompt.id);
}

/**
 * Returns the text that names a rendered choice for a person who cannot see it: its text, with the `alt` of its images, in
 * one line.
 *
 * @see {@link https://www.w3.org/TR/WCAG22/#non-text-content | WCAG 2.2, non-text content}
 */
function textOf(node: Node): string {
  if (node instanceof Element && node.localName === "img") return node.getAttribute("alt") ?? "";
  if (node instanceof Text) return node.data;
  return [...node.childNodes].map(textOf).join("");
}

/**
 * Returns the text of rendered nodes, as `textOf` reads it, with white space reduced to single spaces.
 *
 * @param nodes - The nodes.
 * @returns The text.
 */
export function nameOf(nodes: readonly Node[]): string {
  return nodes.map(textOf).join("").replace(/\s+/gu, " ").trim();
}

/**
 * Makes the class that the shared vocabulary reads from the `orientation` attribute, unless the item gave the class itself.
 *
 * @param element - The interaction element.
 * @param orientation - The `orientation` attribute.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/vocab/ | QTI 3 Standardized Shared Vocabulary, orientation}
 */
export function applyOrientation(element: Element, orientation: string | undefined): void {
  if (orientation === "horizontal" && !element.classList.contains("qti-orientation-vertical")) {
    element.classList.add("qti-orientation-horizontal");
  }
}

/**
 * Sets the width of the container of the choices from `data-choices-container-width`, in pixels.
 *
 * @param element - The interaction element.
 * @param width - The width, if the item gave one.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/vocab/ | QTI 3 Standardized Shared Vocabulary, choices container width}
 */
export function applyContainerWidth(element: HTMLElement, width: number | undefined): void {
  if (width !== undefined) element.style.setProperty("--ak-choices-width", `${width}px`);
}

/**
 * Returns the name of a choice for a person who cannot see it: its text, else, when it shows none, such as an image with
 * no alternative text, its place in the list.
 *
 * @param name - The text of the choice.
 * @param index - The position of the choice, from 0.
 * @param messages - The interface messages.
 * @returns The name.
 * @see {@link https://www.w3.org/TR/WCAG22/#name-role-value | WCAG 2.2, name, role, value}
 */
export function choiceName(name: string, index: number, messages: Messages): string {
  return name === "" ? `${messages.choiceLabel} ${index + 1}` : name;
}

/** A choice that the candidate puts in a place: its element in the pool, what it shows, and its name. */
export interface BuiltChoice {
  /** The identifier, which the response names. */
  readonly id: string;
  /** The element of the choice, with the attributes of its node. */
  readonly element: Element;
  /** What the choice shows. */
  readonly content: Node[];
  /** The text that names it for a person who cannot see it; empty when it shows no text. */
  readonly name: string;
}

/**
 * Builds a choice from its node.
 *
 * @param renderer - The renderer of content.
 * @param name - The element, such as `qti-simple-choice`.
 * @param node - The node of the choice.
 * @param content - What the choice shows.
 * @returns The built choice.
 */
export function buildChoice(
  renderer: BodyRenderer,
  name: string,
  node: ModelNode & { readonly identifier: string },
  content: Node[],
): BuiltChoice {
  return {
    id: node.identifier,
    element: renderer.element(name, node, []),
    content,
    name: nameOf(content),
  };
}

/**
 * Returns the elements called `name` among rendered nodes and below them, in the order of the document.
 *
 * @param rendered - The nodes.
 * @param name - The name of the element.
 * @returns The elements.
 */
export function elementsNamed(rendered: readonly Node[], name: string): Element[] {
  return rendered.flatMap((node) =>
    node instanceof Element ? [...(node.localName === name ? [node] : []), ...node.querySelectorAll(name)] : [],
  );
}
