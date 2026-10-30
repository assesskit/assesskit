import type { Point } from "@luthfanwakan/olah/values";
import { clampPoint, type Size } from "./geometry.js";
import { stageOf } from "./stage.js";

/**
 * How far an arrow key moves the crosshair: a twentieth of the smaller side of the image, so that a key press is a step
 * the candidate can see whatever the size of the image. Shift moves it by one unit of the image.
 */
const COARSE_DIVISOR = 20;
const FINE_STEP = 1;

/** The moves of the arrow keys, as steps along x and y. */
const ARROWS: ReadonlyMap<string, readonly [number, number]> = new Map([
  ["ArrowLeft", [-1, 0]],
  ["ArrowRight", [1, 0]],
  ["ArrowUp", [0, -1]],
  ["ArrowDown", [0, 1]],
]);

/** What a picker asks of the element it serves. */
export interface Picker {
  /** Whether the candidate can pick a point now. */
  active(): boolean;
  /** Takes the point that the candidate picked. */
  pick(point: Point): void;
}

/**
 * Lets the candidate pick a point of an image with one pointer or the keyboard (WCAG 2.2, 2.1.1, 2.5.1): a click on the
 * `.tempuh-surface` of the host picks the point under it, and with the focus on the surface a crosshair shows where the
 * arrow keys have moved to and Enter or Space picks that point. The crosshair is the `.tempuh-crosshair` of the host; it
 * shows while the surface has the focus.
 */
export function enablePicker(host: HTMLElement, picker: Picker): void {
  let cursor: Point | undefined;
  const surface = (): Element | null => host.querySelector(".tempuh-surface");
  const crosshair = (): HTMLElement | null => host.querySelector(".tempuh-crosshair");
  const stage = () => stageOf(surface()?.parentElement ?? null);

  const show = (visible: boolean): void => {
    const marker = crosshair();
    if (marker === null) return;
    marker.hidden = !visible || cursor === undefined;
    if (cursor !== undefined) {
      marker.style.setProperty("--tempuh-x", String(cursor[0]));
      marker.style.setProperty("--tempuh-y", String(cursor[1]));
    }
  };
  const centerOf = ({ width, height }: Size): Point => clampPoint([width / 2, height / 2], { width, height });

  host.addEventListener("click", (event) => {
    if (event.target !== surface() || !picker.active()) return;
    const point = stage()?.pointAt(event.clientX, event.clientY);
    if (point !== undefined) picker.pick(point);
  });
  host.addEventListener("focusin", (event) => {
    const size = stage()?.size;
    if (event.target !== surface() || size === undefined) return;
    cursor ??= centerOf(size);
    show(true);
  });
  host.addEventListener("focusout", (event) => {
    if (event.target === surface()) show(false);
  });
  host.addEventListener("keydown", (event) => {
    const size = stage()?.size;
    if (event.target !== surface() || size === undefined || !picker.active()) return;
    const arrow = ARROWS.get(event.key);
    if (arrow !== undefined) {
      const step = event.shiftKey
        ? FINE_STEP
        : Math.max(FINE_STEP, Math.round(Math.min(size.width, size.height) / COARSE_DIVISOR));
      const [x, y] = cursor ?? centerOf(size);
      cursor = clampPoint([x + arrow[0] * step, y + arrow[1] * step], size);
      show(true);
    } else if ((event.key === "Enter" || event.key === " ") && cursor !== undefined) {
      picker.pick(cursor);
    } else return;
    event.preventDefault();
  });
}
