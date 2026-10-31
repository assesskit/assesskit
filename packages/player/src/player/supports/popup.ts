import { deepActiveElement } from "../internal.js";

/** The parts of a popup that {@link attachPopup} wires. */
export interface PopupParts {
  /** The element around the trigger and the popup; the pointer is over the popup while it is over this element. */
  readonly anchor: HTMLElement;
  /** The button that shows the popup. */
  readonly trigger: HTMLButtonElement;
  /** The popup, hidden at first; it is a descendant of the anchor. */
  readonly popup: HTMLElement;
  /** The button of the popup that dismisses it, for a candidate who cannot press Escape. */
  readonly close: HTMLButtonElement;
  /** Returns the box the popup stays inside: the host of the content root, which clips what lies outside it. */
  readonly boundary: () => DOMRect;
}

/**
 * Places a popup against the anchor and inside a boundary: against the lower edge of the anchor, or against the upper
 * edge when there is less room below than above, and shifted so that it does not leave the boundary.
 *
 * @remarks
 * It touches the anchor, so that the pointer can go from the trigger to the popup without leaving both.
 *
 * @see {@link https://www.w3.org/TR/WCAG22/#content-on-hover-or-focus | WCAG 2.2, content on hover or focus}
 */
function place({ anchor, popup, boundary }: Pick<PopupParts, "anchor" | "popup" | "boundary">): void {
  popup.style.maxWidth = "";
  popup.style.maxHeight = "";
  const area = boundary();
  const at = anchor.getBoundingClientRect();
  if (popup.offsetWidth > area.width) popup.style.maxWidth = `${area.width}px`;
  const width = popup.offsetWidth;
  const below = area.bottom - at.bottom;
  const above = at.top - area.top;
  const under = popup.offsetHeight <= below || below >= above;
  const room = under ? below : above;
  if (popup.offsetHeight > room) popup.style.maxHeight = `${Math.max(room, 0)}px`;
  const left = Math.min(Math.max(at.left, area.left), Math.max(area.right - width, area.left));
  popup.style.left = `${left - at.left}px`;
  popup.style.top = under ? `${at.height}px` : `${-popup.offsetHeight}px`;
}

/**
 * Makes a popup that meets the criterion for content on hover or focus.
 *
 * @remarks
 * It shows while the pointer is over the trigger or the popup, while the focus is in either, and after the trigger is
 * pressed. It is dismissible: Escape, whatever has the focus or the pointer, and the Close button hide it without moving
 * either; it shows again when the pointer and the focus have left and come back. It is hoverable: the pointer may go onto
 * it. It is persistent: it stays until the pointer and the focus have left, or the candidate dismisses it, and a press of
 * the trigger keeps it until then.
 *
 * @param parts - The elements to wire.
 * @returns A function that takes the listeners away.
 * @see {@link https://www.w3.org/TR/WCAG22/#content-on-hover-or-focus | WCAG 2.2, content on hover or focus}
 */
export function attachPopup(parts: PopupParts): () => void {
  const { anchor, trigger, popup, close } = parts;
  const ownerDocument = anchor.ownerDocument;
  let hover = false;
  let focus = false;
  let pinned = false;
  let dismissed = false;
  let shown = false;

  const dismiss = (): void => {
    dismissed = true;
    pinned = false;
    // The focus was in what goes; it goes to the trigger, which keeps the popup dismissed until it leaves.
    const active = deepActiveElement();
    if (active !== null && popup.contains(active)) trigger.focus();
    render();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") dismiss();
  };

  function render(): void {
    if (!hover && !focus) dismissed = false;
    const visible = !dismissed && (hover || focus || pinned);
    if (visible === shown) return;
    shown = visible;
    popup.hidden = !visible;
    trigger.setAttribute("aria-expanded", String(visible));
    if (visible) {
      place(parts);
      ownerDocument.addEventListener("keydown", onKey);
    } else {
      ownerDocument.removeEventListener("keydown", onKey);
    }
  }

  const onEnter = (): void => {
    hover = true;
    render();
  };
  const onLeave = (): void => {
    hover = false;
    render();
  };
  const onFocusIn = (): void => {
    focus = true;
    render();
  };
  const onFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return;
    focus = false;
    pinned = false;
    render();
  };
  const onTrigger = (): void => {
    if (pinned) {
      dismiss();
      return;
    }
    pinned = true;
    dismissed = false;
    render();
  };

  anchor.addEventListener("pointerenter", onEnter);
  anchor.addEventListener("pointerleave", onLeave);
  anchor.addEventListener("focusin", onFocusIn);
  anchor.addEventListener("focusout", onFocusOut);
  trigger.addEventListener("click", onTrigger);
  close.addEventListener("click", dismiss);
  return () => {
    ownerDocument.removeEventListener("keydown", onKey);
    anchor.removeEventListener("pointerenter", onEnter);
    anchor.removeEventListener("pointerleave", onLeave);
    anchor.removeEventListener("focusin", onFocusIn);
    anchor.removeEventListener("focusout", onFocusOut);
    trigger.removeEventListener("click", onTrigger);
    close.removeEventListener("click", dismiss);
  };
}
