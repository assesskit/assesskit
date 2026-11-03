import { descendantNodes, type HotText, type HotTextInteraction } from "@assesskit/runtime/asi";
import { AssesskitError } from "@assesskit/runtime/errors";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer } from "../content/index.js";
import { appendAll } from "../internal.js";
import { createInteraction } from "./element.js";
import { Notes } from "./notes.js";
import { elementsNamed, renderPrompt } from "./parts.js";
import { SelectionElement } from "./selection.js";

const isHotText = (node: { readonly kind: string }): node is HotText => node.kind === "hottext";

/**
 * The element of `qti-hottext-interaction`: runs of text in a passage that the candidate selects.
 *
 * @remarks
 * The text of each hot text is the face of its control.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, hottext interaction}
 */
export class HotTextInteractionElement extends SelectionElement {
  /** The kind of interaction that the element is for. */
  override readonly kind = "hottext-interaction";

  /**
   * Fills the element with the prompt and the passage of the node, and pairs the hot texts with their identifiers.
   *
   * @param node - The interaction.
   * @param renderer - The renderer of content.
   * @throws `AssesskitError` when the renderer drew a different number of hot texts than the model has.
   */
  build(node: HotTextInteraction, renderer: BodyRenderer): void {
    this.prompt = renderPrompt(node.prompt, renderer);
    const passage = renderer.nodes(node.children);
    const identifiers = node.children.flatMap((child) => [child, ...descendantNodes(child)]).filter(isHotText);
    // The renderer drew the hot texts where the text has them and dropped their identifiers, which the model keeps in the same order.
    const elements = elementsNamed(passage, "qti-hottext");
    if (identifiers.length !== elements.length) {
      throw new AssesskitError(
        `The passage has ${elements.length} hot texts drawn for ${identifiers.length} in the model.`,
      );
    }
    identifiers.forEach(({ identifier }, index) => {
      const element = elements[index];
      if (element !== undefined) this.choices.push({ identifier, element, content: [...element.childNodes] });
    });
    this.custom = { min: node.dataMinSelectionsMessage, max: node.dataMaxSelectionsMessage };
    this.notes = new Notes();
    appendAll(this, [...(this.prompt === undefined ? [] : [this.prompt.element]), ...passage, this.notes.element]);
    this.listen();
  }
}

/**
 * Renders a `qti-hottext-interaction`.
 *
 * @param node - The interaction.
 * @param renderer - The renderer of content.
 * @param messages - The interface messages.
 * @returns The element.
 */
export function renderHotText(node: HotTextInteraction, renderer: BodyRenderer, messages: Messages): Element {
  const element = createInteraction(HotTextInteractionElement, "qti-hottext-interaction", node, renderer, messages);
  element.build(node, renderer);
  return element;
}
