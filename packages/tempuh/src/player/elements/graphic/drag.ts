import { DRAG_THRESHOLD } from "../board/view.js";

/** What a drag asks of the element it serves. */
export interface Dragging {
  /** Returns the element that a press on `target` drags, or `undefined` when `target` is no source or the candidate cannot answer. */
  source(target: Element): HTMLElement | undefined;
  /** Takes the end of a drag: the source, and where the pointer was released. */
  drop(source: HTMLElement, clientX: number, clientY: number): void;
}

/**
 * Lets the candidate drag the sources of the host with a mouse or a pen (WCAG 2.2, 2.5.7 asks for another way, which the
 * host gives): a press on a source that moves more than a few pixels carries the source with the pointer, and the release
 * calls `drop`. The drag can be aborted before the release with Escape, which WCAG 2.2, 2.5.2 asks for. A press that does
 * not move stays a click, and the click that ends a drag is not delivered.
 */
export function enableDragging(host: HTMLElement, dragging: Dragging): void {
  let press:
    | { readonly source: HTMLElement; readonly pointer: number; readonly x: number; readonly y: number }
    | undefined;
  let moved = false;
  let suppressClick = false;

  const end = (): void => {
    if (press === undefined) return;
    press.source.style.removeProperty("transform");
    press.source.classList.remove("tempuh-dragging");
    press = undefined;
    moved = false;
  };

  host.addEventListener("pointerdown", (event) => {
    suppressClick = false;
    const source =
      event.isPrimary && event.button === 0 && event.target instanceof Element
        ? dragging.source(event.target)
        : undefined;
    if (source === undefined) return;
    press = { source, pointer: event.pointerId, x: event.clientX, y: event.clientY };
    source.setPointerCapture(event.pointerId);
    // Cancelling the press keeps the browser from starting a drag of its own with a picture in the source, and from
    // moving the focus, which the source takes.
    event.preventDefault();
    source.focus({ preventScroll: true });
  });
  host.addEventListener("pointermove", (event) => {
    if (press === undefined || event.pointerId !== press.pointer) return;
    const [dx, dy] = [event.clientX - press.x, event.clientY - press.y];
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    moved = true;
    press.source.classList.add("tempuh-dragging");
    press.source.style.setProperty("transform", `translate(${dx}px, ${dy}px)`);
  });
  host.addEventListener("pointerup", (event) => {
    if (press === undefined || event.pointerId !== press.pointer) return;
    const { source } = press;
    const dropped = moved;
    end();
    if (!dropped) return;
    suppressClick = true;
    dragging.drop(source, event.clientX, event.clientY);
  });
  host.addEventListener("pointercancel", end);
  host.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && press !== undefined) end();
  });
  host.addEventListener(
    "click",
    (event) => {
      // A click from the keyboard has no detail; only the click that a pointer makes at the end of a drag is swallowed.
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
    },
    { capture: true },
  );
}
