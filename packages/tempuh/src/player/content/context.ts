import type { Interaction, ModelNode } from "@luthfanwakan/olah/asi";
import type { ContentVariables, View } from "@luthfanwakan/olah/content";
import type { FileValue } from "@luthfanwakan/olah/values";
import type { Messages } from "../../messages/index.js";
import type { UrlPolicy } from "./urls.js";

/** The means to render content with the rules of the player, which an interaction renderer uses for the content of its interaction. */
export interface BodyRenderer {
  /**
   * Renders the nodes of content, in order: text, HTML elements, QTI elements, MathML, SSML and interactions. What the
   * policy of the renderer refuses is left out, with the nodes below it.
   *
   * @throws `DataError` when a node is not an object with a `kind`.
   */
  nodes(nodes: readonly ModelNode[]): Node[];
  /**
   * Builds the element for a node around the given children, with the attributes of the node that the player keeps:
   * `id`, `class`, the language, `dir`, `role`, the ARIA attributes, `data-*` attributes and, for an HTML element, the
   * attributes of HTML; references go through the URL policy.
   *
   * @param name - The name of the element, such as `qti-choice-interaction`.
   * @param node - The node whose attributes the element gets.
   * @param children - The nodes to put in it.
   */
  element(name: string, node: ModelNode, children: readonly Node[]): Element;
}

/** Builds the element of an interaction, in place of the placeholder that the renderer draws for one without a renderer. */
export type InteractionRenderer = (interaction: Interaction, renderer: BodyRenderer) => Element;

/** The renderers of interactions by their `kind`, such as `choice-interaction`. */
export type InteractionRenderers = ReadonlyMap<Interaction["kind"], InteractionRenderer>;

/** What the parts of the renderer share: the {@link BodyRenderer} and the settings of one rendering. */
export interface RenderContext extends BodyRenderer {
  /** How references become URLs. */
  readonly urls: UrlPolicy;
  /** The text of the interface. */
  readonly messages: Messages;
  /** The factor for the pixel sizes of media. */
  readonly mediaScale: number;
  /** Whether media and animation are withheld because a hazard remains. */
  readonly withholdMedia: boolean;
  /** The view whose rubric blocks stay. */
  readonly view: View;
  /** The variables that printed variables read; absent when the content has none. */
  readonly variables: ContentVariables | undefined;
  /** The URL of a file value, or `undefined` when the host gives none. */
  readonly fileUrl: ((file: FileValue) => string) | undefined;
  /** The renderers of interactions. */
  readonly interactions: InteractionRenderers;
  /** Returns the context for content whose references start at another base, such as that of an element with `xml:base`. */
  scope(base: string): RenderContext;
}
