import type { ModelNode, Prompt } from "@luthfanwakan/olah/asi";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { uniqueId } from "../dom.js";

/** A rendered `qti-prompt` and the `id` that names the interaction by it. */
export interface RenderedPrompt {
  /** The element, to put in the interaction. */
  readonly element: Element;
  /** Its `id`: the element's own, else one made for it. */
  readonly id: string;
}

/** Renders the prompt of an interaction, or returns `undefined` when it has none. */
export function renderPrompt(prompt: Prompt | undefined, renderer: BodyRenderer): RenderedPrompt | undefined {
  if (prompt === undefined) return undefined;
  const element = renderer.element("qti-prompt", prompt, renderer.nodes(prompt.children));
  if (!element.id) element.id = uniqueId("tempuh-prompt");
  return { element, id: element.id };
}

/** Names an element by the prompt, so that a screen reader says the task with the group of controls (WCAG 3.3.2). */
export function nameByPrompt(element: Element, prompt: RenderedPrompt | undefined): void {
  if (prompt !== undefined) element.setAttribute("aria-labelledby", prompt.id);
}

/**
 * Returns the text that names a rendered choice for a person who cannot see it: its text, with the `alt` of its images
 * (WCAG 1.1.1), in one line.
 */
function textOf(node: Node): string {
  if (node instanceof Element && node.localName === "img") return node.getAttribute("alt") ?? "";
  if (node instanceof Text) return node.data;
  return [...node.childNodes].map(textOf).join("");
}

/** Returns the text of rendered nodes, as `textOf` reads it, with white space reduced to single spaces. */
export function nameOf(nodes: readonly Node[]): string {
  return nodes.map(textOf).join("").replace(/\s+/gu, " ").trim();
}

/**
 * Makes the class that the shared vocabulary reads from the `orientation` attribute (VOCAB §1.2.1.4, INFO §5.30.4), unless
 * the item gave the class itself.
 */
export function applyOrientation(element: Element, orientation: string | undefined): void {
  if (orientation === "horizontal" && !element.classList.contains("qti-orientation-vertical")) {
    element.classList.add("qti-orientation-horizontal");
  }
}

/** Sets the width of the container of the choices from `data-choices-container-width`, in pixels (VOCAB §1.2.10.2). */
export function applyContainerWidth(element: HTMLElement, width: number | undefined): void {
  if (width !== undefined) element.style.setProperty("--tempuh-choices-width", `${width}px`);
}

/**
 * Returns the name of a choice for a person who cannot see it: its text, else, when it shows none, such as an image with
 * no alternative text, its place in the list. A control must have a name (WCAG 4.1.2), whatever the content gives.
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

/** Builds a choice from its node: `name` is the element, such as `qti-simple-choice`, and `content` what it shows. */
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

/** Returns the elements called `name` among rendered nodes and below them, in the order of the document. */
export function elementsNamed(rendered: readonly Node[], name: string): Element[] {
  return rendered.flatMap((node) =>
    node instanceof Element ? [...(node.localName === name ? [node] : []), ...node.querySelectorAll(name)] : [],
  );
}
