import { childNodes, type ModelNode } from "@assesskit/runtime/asi";
import { isRecord } from "../../checks.js";
import { declareSize, scaleSize, setCommonAttributes } from "./attributes.js";
import type { RenderContext } from "./context.js";
import { embed } from "./embed.js";
import { resolveUrl } from "./urls.js";

const stringOf = (node: ModelNode, property: string): string | undefined => {
  const value: unknown = Reflect.get(node, property);
  return typeof value === "string" ? value : undefined;
};

/** Returns the `alt` that an author gave the object beside the schema, which has none: the attribute is in `extensions`. */
function altOf(node: ModelNode): string | undefined {
  const extensions: unknown = Reflect.get(node, "extensions");
  const alt = Array.isArray(extensions)
    ? extensions.find((attribute) => isRecord(attribute) && attribute.namespace === "" && attribute.name === "alt")
    : undefined;
  return isRecord(alt) && typeof alt.value === "string" ? alt.value : undefined;
}

/**
 * Renders a `qti-object`, which embeds a file, by its `type`.
 *
 * @remarks
 * The fallback content of the object is its text alternative, and the `alt` that some authors add overrides it. The
 * parameters are for plug-ins, which the player does not run, so they are not drawn. A file that the URL policy refuses
 * leaves the fallback content.
 *
 * @param node - The `qti-object` node.
 * @param context - The context of the rendering.
 * @returns The DOM nodes that stand for the object.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, object}
 */
export function renderObject(node: ModelNode, context: RenderContext): Node[] {
  const content = context.nodes(childNodes(node));
  const alt = altOf(node);
  const alternative = alt === undefined ? content : [document.createTextNode(alt)];
  const data = stringOf(node, "data");
  const url = data === undefined ? undefined : resolveUrl(data, context.urls, "load");
  if (url === undefined) return content;
  const width = stringOf(node, "width");
  const height = stringOf(node, "height");
  const embedded = embed(context, {
    url,
    type: stringOf(node, "type") ?? "",
    alternative,
    ...(width === undefined ? {} : { width: scaleSize(width, context.mediaScale) }),
    ...(height === undefined ? {} : { height: scaleSize(height, context.mediaScale) }),
  });
  const [first] = embedded;
  if (first instanceof Element) setCommonAttributes(first, node, context);
  if (first instanceof Element) {
    if (width !== undefined) declareSize(first, "width", width);
    if (height !== undefined) declareSize(first, "height", height);
  }
  return embedded;
}
