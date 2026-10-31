import { childNodes, type ModelNode } from "@assesskit/runtime/asi";
import type { RenderContext } from "./context.js";
import { canAnimate } from "./embed.js";

/** The children of an `audio` or `video` that are its fallback content: the sources and tracks are not. */
const isFallback = (node: ModelNode): boolean => node.kind !== "source" && node.kind !== "track";

/**
 * Renders an `audio` or `video` element with the `controls` of the player, so that the candidate decides when it plays.
 *
 * @remarks
 * `autoplay` is not in the attributes that the player keeps. The `source` and `track` children (captions, descriptions,
 * subtitles, chapters) are rendered with their languages and labels. Where a hazard remains the media are not drawn, and
 * the fallback content stays.
 *
 * @param node - The `audio` or `video` node.
 * @param context - The context of the rendering.
 * @returns The element, or its fallback content where media are withheld.
 * @see {@link https://www.w3.org/TR/WCAG22/#audio-control | WCAG 2.2, audio control}
 * @see {@link https://www.w3.org/TR/WCAG22/#pause-stop-hide | WCAG 2.2, pause, stop, hide}
 */
export function renderPlayer(node: ModelNode, context: RenderContext): Node[] {
  if (context.withholdMedia) return context.nodes(childNodes(node).filter(isFallback));
  const element = context.element(node.kind, node, context.nodes(childNodes(node)));
  element.setAttribute("controls", "");
  return [element];
}

/**
 * Renders an `img`; where a hazard remains, an image that can move is replaced by its `alt` text.
 *
 * @param node - The `img` node.
 * @param context - The context of the rendering.
 * @returns The element, or the text that stands for it.
 */
export function renderImage(node: ModelNode, context: RenderContext): Node[] {
  const src: unknown = Reflect.get(node, "src");
  if (context.withholdMedia && typeof src === "string" && canAnimate(undefined, src)) {
    const alt: unknown = Reflect.get(node, "alt");
    return typeof alt === "string" && alt !== "" ? [document.createTextNode(alt)] : [];
  }
  return [context.element(node.kind, node, [])];
}
