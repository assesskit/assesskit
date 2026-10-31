import { html, uniqueId } from "../dom.js";
import type { OpenTool, ToolContext } from "./context.js";
import { createPanel } from "./panel.js";

/** The distance a key press or a button moves a tool in CSS pixels; with Shift, {@link FINE_MOVE_STEP}. */
const MOVE_STEP = 10;
const FINE_MOVE_STEP = 1;

/** The angle a key press or a button turns a tool in degrees; with Shift, {@link FINE_ROTATE_STEP}. */
const ROTATE_STEP = 5;
const FINE_ROTATE_STEP = 1;

/** The distance in CSS pixels of a tool from the top of the visible part of the item when it opens. */
const OPENING_MARGIN = 16;

/** The distance in CSS pixels that a tool keeps from a focused element it moves away from. */
const CLEARANCE = 8;

/** The keys that move a tool, as the direction of the move in x and y. */
const KEY_MOVES: ReadonlyMap<string, readonly [number, number]> = new Map([
  ["ArrowLeft", [-1, 0]],
  ["ArrowRight", [1, 0]],
  ["ArrowUp", [0, -1]],
  ["ArrowDown", [0, 1]],
]);

/** The keys that turn a tool, as the sense of the turn: -1 against the clock, 1 with it. */
const KEY_TURNS: ReadonlyMap<string, number> = new Map([
  ["PageUp", -1],
  ["PageDown", 1],
]);

/** A tool that the candidate places over the item and turns: the drawing, its size and the point it turns about. */
export interface PlacedToolSpec {
  /** The name of the tool. */
  readonly title: string;
  /** What the author says the tool offers, or `null`. */
  readonly description: string | null;
  /** The drawing of the tool. */
  readonly graphic: SVGSVGElement;
  /** The width of the drawing in CSS pixels. */
  readonly width: number;
  /** The height of the drawing in CSS pixels. */
  readonly height: number;
  /** The point of the drawing, in CSS pixels from its top left, that the tool is placed by and turns about. */
  readonly pivot: { readonly x: number; readonly y: number };
}

/** Turns an angle into the range from -180 up to 180 degrees. */
function normalizeAngle(angle: number): number {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

function clamp(value: number, least: number, greatest: number): number {
  return Math.min(Math.max(value, least), greatest);
}

/** Whether the tool lies over every sampled point of an element, which is then hidden by it (WCAG 2.4.11). */
function hides(tool: HTMLElement, element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const root = element.getRootNode();
  if (rect.width === 0 || rect.height === 0 || !(root instanceof Document || root instanceof ShadowRoot)) return false;
  const xs = [rect.left + 1, rect.left + rect.width / 2, rect.right - 1];
  const ys = [rect.top + 1, rect.top + rect.height / 2, rect.bottom - 1];
  return xs.every((x) =>
    ys.every((y) => {
      const hit = root.elementFromPoint(x, y);
      return hit !== null && tool.contains(hit);
    }),
  );
}

/**
 * Opens a tool that the candidate places over the item (the rule and the protractor). The tool moves and turns by
 * dragging, by the arrow keys and Page Up and Page Down on the tool, and by the buttons and the angle field of its panel,
 * so that no movement needs a drag (WCAG 2.5.7). It moves out of the way of an element that takes the focus and that it
 * would hide (WCAG 2.4.11).
 */
export function openPlacedTool(context: ToolContext, spec: PlacedToolSpec, close: () => void): OpenTool {
  const { messages, stage, layer } = context;
  const { title, description, graphic, width, height, pivot } = spec;
  const panel = createPanel(context, title, close);
  const hintId = uniqueId("ak-hint");
  graphic.setAttribute("aria-hidden", "true");
  const tool = html(
    "div",
    { class: "ak-placed", role: "group", tabindex: "0", "aria-label": title, "aria-describedby": hintId },
    graphic,
    html("span", { id: hintId, class: "ak-visually-hidden" }, messages.toolMoveHint),
  );
  tool.style.width = `${width}px`;
  tool.style.height = `${height}px`;
  tool.style.transformOrigin = `${pivot.x}px ${pivot.y}px`;
  layer.append(tool);

  const angleId = uniqueId("ak-angle");
  const angleField = html("input", { id: angleId, type: "number", min: "-180", max: "180", step: "1", value: "0" });
  let x = 0;
  let y = 0;
  let angle = 0;

  const show = (): void => {
    tool.style.transform = `translate(${x - pivot.x}px, ${y - pivot.y}px) rotate(${angle}deg)`;
  };
  const place = (toX: number, toY: number): void => {
    x = clamp(toX, 0, layer.clientWidth);
    y = clamp(toY, 0, layer.clientHeight);
    show();
  };
  const move = (dx: number, dy: number): void => place(x + dx, y + dy);
  const rotate = (degrees: number): void => {
    angle = normalizeAngle(angle + degrees);
    angleField.value = String(angle);
    show();
  };

  const visibleTop = Math.max(0, -layer.getBoundingClientRect().top);
  place(layer.clientWidth / 2 - width / 2 + pivot.x, visibleTop + OPENING_MARGIN + pivot.y);

  let drag: { pointerId: number; startX: number; startY: number; fromX: number; fromY: number } | null = null;
  const endDrag = (event: PointerEvent): void => {
    if (drag?.pointerId === event.pointerId) drag = null;
  };
  tool.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, fromX: x, fromY: y };
    tool.setPointerCapture(event.pointerId);
  });
  tool.addEventListener("pointermove", (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    place(drag.fromX + event.clientX - drag.startX, drag.fromY + event.clientY - drag.startY);
  });
  tool.addEventListener("pointerup", endDrag);
  tool.addEventListener("pointercancel", endDrag);
  tool.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const step = event.shiftKey ? FINE_MOVE_STEP : MOVE_STEP;
    const turn = event.shiftKey ? FINE_ROTATE_STEP : ROTATE_STEP;
    const direction = KEY_MOVES.get(event.key);
    const sense = KEY_TURNS.get(event.key);
    if (direction !== undefined) move(direction[0] * step, direction[1] * step);
    else if (sense !== undefined) rotate(sense * turn);
    else return;
    event.preventDefault();
  });

  const moveClear = (element: Element): void => {
    const toolRect = tool.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const below = rect.bottom + CLEARANCE - toolRect.top;
    const fitsBelow = toolRect.bottom + below <= layer.getBoundingClientRect().bottom;
    move(0, fitsBelow ? below : rect.top - CLEARANCE - toolRect.bottom);
  };
  const onFocusIn = (event: FocusEvent): void => {
    const { target } = event;
    if (target instanceof Element && !layer.contains(target) && hides(tool, target)) moveClear(target);
  };
  stage.addEventListener("focusin", onFocusIn);

  const control = (className: string, symbol: string, label: string, action: () => void): HTMLButtonElement => {
    const button = html("button", { type: "button", class: `ak-button ${className}`, "aria-label": label }, symbol);
    button.addEventListener("click", action);
    return button;
  };
  angleField.addEventListener("input", () => {
    if (!Number.isFinite(angleField.valueAsNumber)) return;
    angle = normalizeAngle(angleField.valueAsNumber);
    show();
  });
  angleField.addEventListener("change", () => {
    angleField.value = String(angle);
  });
  panel.body.append(
    ...(description === null ? [] : [html("p", {}, description)]),
    html("p", {}, messages.toolMoveHint),
    html(
      "div",
      { class: "ak-controls" },
      control("ak-rotate-left", "↺", messages.toolRotateLeft, () => rotate(-ROTATE_STEP)),
      control("ak-move-up", "↑", messages.toolMoveUp, () => move(0, -MOVE_STEP)),
      control("ak-rotate-right", "↻", messages.toolRotateRight, () => rotate(ROTATE_STEP)),
      control("ak-move-left", "←", messages.toolMoveLeft, () => move(-MOVE_STEP, 0)),
      control("ak-move-right", "→", messages.toolMoveRight, () => move(MOVE_STEP, 0)),
      control("ak-move-down", "↓", messages.toolMoveDown, () => move(0, MOVE_STEP)),
    ),
    html("div", { class: "ak-field" }, html("label", { for: angleId }, messages.toolAngle), angleField),
  );

  return {
    focus: () => tool.focus(),
    destroy: () => {
      stage.removeEventListener("focusin", onFocusIn);
      tool.remove();
      panel.remove();
    },
  };
}
