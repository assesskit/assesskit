import { html } from "../dom.js";
import type { OpenTool, ToolContext } from "./context.js";
import { createPanel } from "./panel.js";

/** The space in CSS pixels the band keeps above and below its line. */
const BAND_PADDING = 2;

/** A line of text, from the top of the layer. */
interface Line {
  readonly top: number;
  readonly height: number;
}

/**
 * Finds the lines of text in the stage, from the rectangles that its text nodes occupy. Rectangles that share a stretch
 * of height are one line, so that a superscript or a formula does not make a line of its own.
 */
function textLines(stage: HTMLElement, layer: HTMLElement): readonly Line[] {
  const rects: DOMRect[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      layer.contains(node) || node.textContent?.trim() === "" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    range.selectNodeContents(node);
    rects.push(...[...range.getClientRects()].filter(({ width, height }) => width > 0 && height > 0));
  }
  const lines: { top: number; bottom: number }[] = [];
  for (const rect of rects.sort((a, b) => a.top - b.top)) {
    const line = lines.at(-1);
    if (line !== undefined && (rect.top + rect.bottom) / 2 < line.bottom) {
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom });
    }
  }
  const origin = layer.getBoundingClientRect().top;
  return lines.map(({ top, bottom }) => ({ top: top - origin, height: bottom - top }));
}

/** Returns the index of the line whose top is nearest to `top`, or 0 when there are none. */
function nearestLine(lines: readonly Line[], top: number): number {
  let nearest = 0;
  for (const [index, line] of lines.entries()) {
    if (Math.abs(line.top - top) < Math.abs((lines[nearest]?.top ?? 0) - top)) nearest = index;
  }
  return nearest;
}

/**
 * Opens the line reader ([CERT] A-27): a band of the color of the profile over one line of the item's text at a time. The
 * band moves line by line with the arrow keys on it, Home and End, and the buttons of its panel. It lets all the text
 * show through and takes no pointer events, so that it hides no element that has the focus (WCAG 2.4.11).
 *
 * @param highlightColor - The color as `#RGB` or `#RRGGBB`, or `null` for the stylesheet's own.
 */
export function openLineReader(context: ToolContext, highlightColor: string | null, close: () => void): OpenTool {
  const { messages, stage, layer } = context;
  const panel = createPanel(context, messages.toolLineReader, close);
  const band = html("div", {
    class: "ak-line-reader",
    role: "slider",
    tabindex: "0",
    "aria-label": messages.toolLineReader,
    "aria-orientation": "vertical",
    "aria-valuemin": "1",
  });
  if (highlightColor !== null) band.style.setProperty("--ak-line-color", highlightColor);
  layer.append(band);
  const noText = html("p", {}, messages.toolNoText);
  let lines: readonly Line[] = [];
  let index = 0;
  let top: number | null = null;

  const render = (): void => {
    const line = lines[index];
    band.hidden = line === undefined;
    noText.hidden = line !== undefined;
    if (line === undefined) return;
    top = line.top;
    band.style.top = `${line.top - BAND_PADDING}px`;
    band.style.height = `${line.height + 2 * BAND_PADDING}px`;
    band.setAttribute("aria-valuemax", String(lines.length));
    band.setAttribute("aria-valuenow", String(index + 1));
    band.setAttribute("aria-valuetext", `${messages.toolLine} ${index + 1} ${messages.toolLineOf} ${lines.length}`);
  };
  // Finds the lines again and keeps the band on the line nearest to where it was; at first, the first line in view.
  const refresh = (): void => {
    lines = textLines(stage, layer);
    const visibleTop = Math.max(0, -layer.getBoundingClientRect().top);
    index =
      top === null
        ? Math.max(
            0,
            lines.findIndex((line) => line.top + line.height > visibleTop),
          )
        : nearestLine(lines, top);
    render();
  };
  const moveTo = (to: (current: number, last: number) => number): void => {
    refresh();
    if (lines.length === 0) return;
    index = to(index, lines.length - 1);
    render();
    band.scrollIntoView({ block: "nearest" });
  };
  const previous = (): void => moveTo((current) => Math.max(0, current - 1));
  const next = (): void => moveTo((current, last) => Math.min(last, current + 1));

  const keys = new Map<string, () => void>([
    ["ArrowUp", previous],
    ["ArrowDown", next],
    ["Home", () => moveTo(() => 0)],
    ["End", () => moveTo((_, last) => last)],
  ]);
  band.addEventListener("keydown", (event) => {
    const action = keys.get(event.key);
    if (action === undefined || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    action();
  });

  const control = (label: string, action: () => void): HTMLButtonElement => {
    const button = html("button", { type: "button", class: "ak-button" }, label);
    button.addEventListener("click", action);
    return button;
  };
  panel.body.append(
    noText,
    html(
      "div",
      { class: "ak-row" },
      control(messages.toolPreviousLine, previous),
      control(messages.toolNextLine, next),
    ),
  );

  const resizes = new ResizeObserver(refresh);
  // A change of the text, or of the classes and styles that wrap it, moves the lines. The band's own changes do not.
  const changes = new MutationObserver((records) => {
    if (records.some(({ target }) => !layer.contains(target))) refresh();
  });
  resizes.observe(stage);
  changes.observe(stage, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  refresh();

  return {
    focus: () => band.focus(),
    destroy: () => {
      resizes.disconnect();
      changes.disconnect();
      band.remove();
      panel.remove();
    },
  };
}
