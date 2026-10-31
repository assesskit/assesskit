import type { HotspotInteraction } from "@assesskit/runtime/asi";
import type { Point } from "@assesskit/runtime/values";
import { type BodyRenderer, DECLARED_HEIGHT, DECLARED_WIDTH } from "../../content/index.js";
import { html } from "../../dom.js";
import { pointAt, type Size } from "./geometry.js";

/**
 * The smallest side of a target in CSS pixels (WCAG 2.2, 2.5.8); `--ak-target-size` in `player.css` has the same value.
 */
const TARGET_SIZE = 24;

/** The attribute that marks a tracked element whose drawn size is below {@link TARGET_SIZE}, which `player.css` enlarges. */
const SMALL = "data-ak-small";

/**
 * The image of an interaction with the layer that lies over it. Everything that the candidate points at is in the layer,
 * and its position is measured in the units of the image, whatever the scale at which the image is drawn.
 */
export interface Stage {
  /** The layer over the image, which has the drawn size of the image. */
  readonly layer: HTMLElement;
  /** The size of the image in its own units, or `undefined` while an image without a declared size loads. */
  readonly size: Size | undefined;
  /** Calls the listener with the size of the image as soon as it is known, which may be at once. */
  whenSized(listener: (size: Size) => void): void;
  /**
   * Watches an element in the layer whose box in the units of the image is `box`: while it is drawn smaller than
   * {@link TARGET_SIZE} on either side, it has the attribute `data-ak-small`, and the stylesheet gives it a target of
   * the minimum size (WCAG 2.2, 2.5.8).
   */
  track(element: HTMLElement, box: Size): void;
  /** Stops watching an element that left the layer. */
  untrack(element: HTMLElement): void;
  /** Returns the point of the image under a position on the screen, or `undefined` when the position is off the image or the size is unknown. */
  pointAt(clientX: number, clientY: number): Point | undefined;
}

/** The stages by their layers, so that an element finds the stage of its layer. */
const STAGES = new WeakMap<Element, Stage>();

/** Returns the stage that watches a layer, or `undefined` when none does. */
export function stageOf(layer: Element | null): Stage | undefined {
  return layer === null ? undefined : STAGES.get(layer);
}

/** Returns the size the author gave the image, which the renderer keeps in attributes. */
function declaredSize(image: HTMLImageElement | null): Size | undefined {
  const width = Number(image?.getAttribute(DECLARED_WIDTH));
  const height = Number(image?.getAttribute(DECLARED_HEIGHT));
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/** Returns the size of an image in its own units: the size the author declared, else the natural size of the file once it has loaded. */
export function imageSize(image: HTMLImageElement | null): Size | undefined {
  const declared = declaredSize(image);
  if (declared !== undefined || image === null) return declared;
  return image.naturalWidth > 0 && image.naturalHeight > 0
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : undefined;
}

/**
 * Watches the image in `host` and the `layer` that lies over it. The size of the image is the one the author declared with
 * `width` and `height`; without them it is the natural size of the file, once it has loaded.
 *
 * @param host - The element that holds the image the renderer built, directly or in a `picture`.
 * @param layer - The element over the image, a child of `host` or of an element in it.
 */
export function watchStage(host: HTMLElement, layer: HTMLElement): Stage {
  const image = host.querySelector<HTMLImageElement>(":scope > img, :scope > picture img");
  const listeners: ((size: Size) => void)[] = [];
  const tracked = new Map<HTMLElement, Size>();
  let size: Size | undefined;
  let scale: number | undefined;

  const refresh = (): void => {
    if (size === undefined || scale === undefined) return;
    layer.style.setProperty("--ak-scale", String(scale));
    for (const [element, box] of tracked) {
      element.toggleAttribute(SMALL, box.width * scale < TARGET_SIZE || box.height * scale < TARGET_SIZE);
    }
  };
  const know = (known: Size): void => {
    size = known;
    layer.style.setProperty("--ak-image-width", String(known.width));
    layer.style.setProperty("--ak-image-height", String(known.height));
    for (const listener of listeners.splice(0)) listener(known);
    refresh();
  };
  const measure = (): void => {
    const measured = imageSize(image);
    if (size === undefined && measured !== undefined) know(measured);
  };
  measure();
  image?.addEventListener("load", measure, { once: true });
  new ResizeObserver(([entry]) => {
    if (entry === undefined || size === undefined) return;
    scale = entry.contentRect.width / size.width;
    refresh();
  }).observe(layer);

  const stage: Stage = {
    layer,
    get size() {
      return size;
    },
    whenSized(listener) {
      if (size === undefined) listeners.push(listener);
      else listener(size);
    },
    track(element, box) {
      tracked.set(element, box);
      refresh();
    },
    untrack(element) {
      tracked.delete(element);
    },
    pointAt(clientX, clientY) {
      if (size === undefined) return undefined;
      const { left, top, width, height } = layer.getBoundingClientRect();
      const inside = clientX >= left && clientX <= left + width && clientY >= top && clientY <= top + height;
      if (!inside) return undefined;
      return pointAt({ x: left, y: top, width, height }, size, clientX, clientY);
    },
  };
  STAGES.set(layer, stage);
  return stage;
}

/** The image of a graphic interaction: an `object`, an `img` or a `picture`. */
export type StageImage = HotspotInteraction["image"];

/**
 * Builds the stage of an interaction around its image: an element that holds the image the renderer built for it, and the
 * layer over it, to which the interaction adds what the candidate points at.
 */
export function createStage(
  image: StageImage,
  renderer: BodyRenderer,
): { readonly element: HTMLElement; readonly stage: Stage } {
  const layer = html("div", { class: "ak-layer" });
  const element = html("div", { class: "ak-stage" }, ...renderer.nodes([image]), layer);
  return { element, stage: watchStage(element, layer) };
}
