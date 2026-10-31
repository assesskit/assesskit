import type { BodyRenderer, RenderContext } from "./context.js";
import { buildElement, renderNodes } from "./nodes.js";
import { type BodyRendererOptions, type RenderSettings, readRenderOptions } from "./options.js";

/**
 * Creates the renderer of content.
 *
 * @remarks
 * It builds the DOM for the nodes of the runtime's typed content model with `createElementNS` and never `innerHTML`. A node
 * becomes the element of its name, and the attributes that the player keeps are set on it: those of the model, the ARIA
 * attributes and the `data-*` attributes. The renderer decides nothing of QTI: what the runtime's `resolveContent` and the
 * engine resolved (feedback, template content, printed values, hidden choices) is rendered as it is.
 *
 * What it refuses, it leaves out:
 *
 * - script, event handlers, `style` and the attributes of other namespaces, which the model does not carry over;
 * - elements of a namespace other than MathML, SSML and CML;
 * - a reference that is outside the package, on an origin the options do not name, or that has a scheme other than `http`,
 *   `https` and a raster `data:` URL.
 *
 * @param options - See {@link BodyRendererOptions}.
 * @returns The renderer.
 * @throws `DataError` when an option is not of its type.
 */
export function createBodyRenderer(options: BodyRendererOptions): BodyRenderer {
  const settings = readRenderOptions(options);
  const { nodes, element } = contextFor(settings, settings.base);
  return { nodes, element };
}

/** Makes the context of a rendering whose references start at a base: its methods render with that base. */
function contextFor(settings: RenderSettings, base: string): RenderContext {
  const context: RenderContext = {
    ...settings,
    urls: { assets: settings.assets, base, origins: settings.origins },
    nodes: (nodes) => renderNodes(nodes, context),
    element: (name, node, children) => buildElement(name, node, children, context),
    scope: (scoped) => contextFor(settings, scoped),
  };
  return context;
}
