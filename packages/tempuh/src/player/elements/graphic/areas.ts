import type { AssociableHotspot, HotspotChoice } from "@luthfanwakan/olah/asi";
import type { Point } from "@luthfanwakan/olah/values";
import { TempuhError } from "../../../errors.js";
import type { BodyRenderer } from "../../content/index.js";
import { html, svg } from "../../dom.js";
import { type Box, parseArea } from "./geometry.js";
import type { Stage } from "./stage.js";

/** The element that an area of an image is: a hotspot to select, or an associable hotspot to pair or fill. */
export type AreaNode = HotspotChoice | AssociableHotspot;

/** The name of the element each node is drawn as. */
const AREA_ELEMENTS = {
  "hotspot-choice": "qti-hotspot-choice",
  "associable-hotspot": "qti-associable-hotspot",
} as const;

/**
 * Returns the SVG that draws a polygon in the box that holds it, scaled with the box and with a line that keeps its width.
 * The halo under the line keeps the outline in sight on any image (WCAG 2.2, 1.4.11), as the border and the outline of the
 * other shapes do.
 */
function drawOutline(outline: SVGSVGElement, corners: readonly Point[], box: Box): void {
  const points = corners.map(([x, y]) => `${x - box.x},${y - box.y}`).join(" ");
  const polygon = { points, "vector-effect": "non-scaling-stroke" };
  outline.setAttribute("viewBox", `0 0 ${Math.max(box.width, 1)} ${Math.max(box.height, 1)}`);
  outline.replaceChildren(svg("polygon", { ...polygon, class: "tempuh-halo" }), svg("polygon", polygon));
}

/** A hotspot over an image: its element, and the parts of its face that the interaction puts in the face it builds. */
export interface Area {
  /** The element that stands over the image, positioned by the stylesheet from the box of the shape. */
  readonly element: HTMLElement;
  /**
   * The content of the face: the label of the hotspot for a screen reader, which the author gave, and the outline of a
   * polygon. The face is what the candidate sees of the hotspot, and its text names the control.
   */
  readonly content: readonly Node[];
}

/**
 * Builds the element of a hotspot or an associable hotspot over an image. The stylesheet places and sizes it in the layer
 * of the stage from the box of the shape, which this sets as custom properties in the units of the image; a polygon draws its
 * outline as SVG in the face, because a border cannot follow it. The control and the face are the interaction's to add.
 *
 * @throws `DataError` when the coordinates do not fit the shape.
 * @throws `TempuhError` when the renderer builds the element as something other than an HTML element.
 */
export function createArea(node: AreaNode, context: { readonly renderer: BodyRenderer; readonly stage: Stage }): Area {
  // A percentage needs the size of the image, so the syntax is checked against any size now, and the box later.
  parseArea(node.shape, node.coords, { width: 1, height: 1 });
  const element = context.renderer.element(AREA_ELEMENTS[node.kind], node, []);
  if (!(element instanceof HTMLElement)) throw new TempuhError("The renderer built a hotspot as a foreign element.");
  const outline =
    node.shape === "poly"
      ? svg("svg", { class: "tempuh-outline", preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" })
      : undefined;
  context.stage.whenSized((size) => {
    const { shape, box, corners } = parseArea(node.shape, node.coords, size);
    element.setAttribute("data-shape", shape);
    element.style.setProperty("--tempuh-x", String(box.x));
    element.style.setProperty("--tempuh-y", String(box.y));
    element.style.setProperty("--tempuh-w", String(box.width));
    element.style.setProperty("--tempuh-h", String(box.height));
    if (outline !== undefined) drawOutline(outline, corners, box);
    context.stage.track(element, box);
  });
  const label =
    node.hotspotLabel === undefined ? [] : [html("span", { class: "qti-visually-hidden" }, node.hotspotLabel)];
  return { element, content: [...label, ...(outline === undefined ? [] : [outline])] };
}

/** Returns the box of an area in the units of the image, as {@link createArea} set it, or `undefined` while the size of the image is unknown. */
export function boxOf(area: HTMLElement): Box | undefined {
  const [x, y, width, height] = ["x", "y", "w", "h"].map((name) =>
    Number.parseFloat(area.style.getPropertyValue(`--tempuh-${name}`)),
  );
  return x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    [x, y, width, height].some(Number.isNaN)
    ? undefined
    : { x, y, width, height };
}
