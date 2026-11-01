import { html, uniqueId } from "../internal.js";
import type { OpenTool, ToolContext } from "./context.js";
import { createPanel } from "./panel.js";
import { type Box, joinLines, linesOf, measure, type Word, wordAt, wordsOf } from "./word-layout.js";

/** The parts of the content root that have text of their own: the stimuli, which items may share, and the item. */
const PARTS = ".ak-stimulus, .ak-body";

/** What a press is for when it lands on one of these: the control, not a mark. */
const CONTROLS = "a, button, input, select, textarea, label, summary, [contenteditable]";

/** A part of the content with its words, where they are on the page, and their lines. */
interface Part {
  /** Names the part in the memory of the tools: the item, or a stimulus. */
  readonly key: string;
  readonly element: Element;
  readonly words: readonly Word[];
  readonly boxes: readonly (readonly Box[])[];
  readonly lines: readonly (readonly number[])[];
}

/** A word of a part. */
interface Spot {
  readonly part: number;
  readonly word: number;
}

const NO_MARKS: ReadonlySet<number> = new Set();

const same = (a: Spot | undefined, b: Spot | undefined): boolean =>
  a !== undefined && b !== undefined && a.part === b.part && a.word === b.word;

/** Returns the runs of consecutive indexes of a set, as `[first, last]`, from the lowest. */
function runsOf(indexes: ReadonlySet<number>): [number, number][] {
  const runs: [number, number][] = [];
  for (const index of [...indexes].sort((a, b) => a - b)) {
    const run = runs.at(-1);
    if (run !== undefined && run[1] === index - 1) run[1] = index;
    else runs.push([index, index]);
  }
  return runs;
}

/** Returns the parts of the content in the stage; a stage with no stimulus and no item of the root is one part. */
function partElements(stage: HTMLElement): Element[] {
  const found = [...stage.querySelectorAll(PARTS)];
  return found.length === 0 ? [stage] : found;
}

/** Returns a band of a mark at a box. */
function band({ left, top, width, height }: Box, className: string): HTMLElement {
  const element = html("div", { class: className });
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  return element;
}

/**
 * Opens the highlighter: the candidate marks the words of the item's text, which stay in the mount by item and by stimulus.
 *
 * @remarks
 * A text selection in a shadow root cannot be read in every browser of the baseline, so the highlighter works on words. A
 * press on a word marks it or takes its mark away, and a drag over words marks them. A caret in the layer is focusable:
 * the arrow keys move it by word and by line, Shift with an arrow extends from where it was, Enter marks the words it
 * covers, and Escape lets go of the extension. A mark is a band in the layer, drawn again when the stage changes size; it
 * never changes the DOM of the item. The panel lists the marks with their text, so that they have a form that is not visual.
 *
 * @param context - What the tool needs from the mount.
 * @param close - Called when the candidate closes its panel.
 * @returns The open tool.
 * @see {@link https://www.w3.org/TR/WCAG22/#dragging-movements | WCAG 2.2, dragging movements}
 */
export function openHighlighter(context: ToolContext, close: () => void): OpenTool {
  const { messages, stage, layer, memory } = context;
  const panel = createPanel(context, messages.toolHighlighter, close);
  const hintId = uniqueId("ak-highlighter-hint");
  const hint = html("span", { id: hintId, class: "ak-visually-hidden" }, messages.toolHighlighterHint);
  const status = html("p", { role: "status", class: "ak-visually-hidden" });
  const caret = html("div", {
    class: "ak-caret",
    role: "application",
    tabindex: "0",
    "aria-label": messages.toolHighlighter,
    "aria-describedby": hintId,
  });
  const bands = html("div", { class: "ak-marks" });
  const surface = html("div", { class: "ak-highlights" }, bands, caret, hint, status);
  layer.append(surface);
  const empty = html("p", {}, messages.toolNoMarks);
  const list = html("ul", { "aria-label": messages.toolMarks });
  const clear = html("button", { type: "button", class: "ak-button" }, messages.toolClearMarks);
  panel.body.append(html("p", {}, messages.toolHighlighterHint), empty, list, clear);

  let parts: Part[] = [];
  let order: Spot[] = [];
  let rows: Spot[][] = [];
  let shown: readonly Element[] = [];
  let spot: Spot | undefined;
  let anchor: Spot | undefined;
  let drag: { readonly id: number; readonly start: Spot; moved: boolean } | undefined;
  const abort = new AbortController();
  const { signal } = abort;

  const marked = (part: Part): ReadonlySet<number> => memory.words.get(part.key) ?? NO_MARKS;
  const marksOf = (part: Part): Set<number> => {
    const set = memory.words.get(part.key) ?? new Set<number>();
    memory.words.set(part.key, set);
    return set;
  };
  const textOf = (part: Part, first: number, last: number): string =>
    part.words
      .slice(first, last + 1)
      .map(({ node, start, end }) => node.data.slice(start, end))
      .join(" ");

  /** Finds the words again, where they are now. */
  const layout = (): void => {
    const origin = layer.getBoundingClientRect();
    const { item, stimuli } = context.content();
    let stimulus = 0;
    parts = partElements(stage).map((element) => {
      let key = item;
      if (element.classList.contains("ak-stimulus")) {
        key = stimuli[stimulus] ?? `stimulus ${stimulus}`;
        stimulus += 1;
      }
      const words = wordsOf(element, layer);
      const boxes = measure(words, origin);
      return { key, element, words, boxes, lines: linesOf(boxes) };
    });
    rows = parts.flatMap((part, index) => part.lines.map((line) => line.map((word) => ({ part: index, word }))));
    order = rows.flat();
  };

  const draw = (): void => {
    const pending =
      anchor !== undefined && spot !== undefined && anchor.part === spot.part
        ? joinLines(parts[spot.part]?.boxes ?? [], Math.min(anchor.word, spot.word), Math.max(anchor.word, spot.word))
        : [];
    bands.replaceChildren(
      ...parts.flatMap((part) =>
        runsOf(marked(part)).flatMap(([first, last]) =>
          joinLines(part.boxes, first, last).map((box) => band(box, "ak-mark")),
        ),
      ),
      ...pending.map((box) => band(box, "ak-mark ak-mark-pending")),
    );
    const box = spot === undefined ? undefined : parts[spot.part]?.boxes[spot.word]?.[0];
    caret.hidden = box === undefined;
    if (box !== undefined) {
      caret.style.left = `${box.left}px`;
      caret.style.top = `${box.top}px`;
      caret.style.width = `${box.width}px`;
      caret.style.height = `${box.height}px`;
    }
  };

  const say = (text: string): void => {
    status.textContent = text;
  };

  /** Marks the words from `first` to `last` of a part, or takes their marks away. */
  const apply = (part: Part, first: number, last: number, on: boolean): void => {
    const set = marksOf(part);
    for (let index = first; index <= last; index += 1) {
      if (on) set.add(index);
      else set.delete(index);
    }
    if (set.size === 0) memory.words.delete(part.key);
    say(`${textOf(part, first, last)} ${on ? messages.toolMarkSet : messages.toolMarkCleared}`);
  };

  const renderList = (): void => {
    const runs = parts.flatMap((part) => runsOf(marked(part)).map(([first, last]) => ({ part, first, last })));
    list.replaceChildren(
      ...runs.map(({ part, first, last }) => {
        const text = textOf(part, first, last);
        const remove = html(
          "button",
          { type: "button", class: "ak-button", "aria-label": `${messages.toolRemoveMark} ${text}` },
          messages.toolRemoveMark,
        );
        const item = html("li", { class: "ak-mark-item" }, html("span", {}, text), remove);
        remove.addEventListener(
          "click",
          () => {
            const at = [...list.children].indexOf(item);
            apply(part, first, last, false);
            draw();
            renderList();
            const buttons = list.querySelectorAll("button");
            (buttons[at] ?? buttons[at - 1] ?? caret).focus();
          },
          { signal },
        );
        return item;
      }),
    );
    empty.hidden = runs.length > 0;
    list.hidden = runs.length === 0;
    clear.disabled = runs.length === 0;
  };

  /** Takes the marks away from words that the content no longer has. */
  const prune = (): void => {
    for (const part of parts) {
      const set = memory.words.get(part.key);
      for (const index of set ?? NO_MARKS) if (index >= part.words.length) set?.delete(index);
      if (set?.size === 0) memory.words.delete(part.key);
    }
  };

  const refresh = (): void => {
    layout();
    prune();
    shown = parts.map(({ element }) => element);
    if (spot === undefined || !order.some((each) => same(each, spot))) spot = order[0];
    anchor = undefined;
    draw();
    renderList();
  };

  const pointSpot = (x: number, y: number, only?: number): Spot | undefined => {
    const origin = layer.getBoundingClientRect();
    for (const [index, part] of parts.entries()) {
      if (only !== undefined && index !== only) continue;
      const word = wordAt(part.boxes, x - origin.left, y - origin.top);
      if (word !== undefined) return { part: index, word };
    }
    return undefined;
  };

  const centerOf = ({ part, word }: Spot): number => {
    const box = parts[part]?.boxes[word]?.[0];
    return box === undefined ? 0 : box.left + box.width / 2;
  };
  /** Returns the word that a key goes to from a word: the next or previous one, or the one nearest below or above. */
  const neighbor = (key: string, from: Spot): Spot | undefined => {
    const at = order.findIndex((each) => same(each, from));
    if (key === "ArrowRight") return order[at + 1];
    if (key === "ArrowLeft") return order[at - 1];
    if (key !== "ArrowDown" && key !== "ArrowUp") return undefined;
    const row = rows[rows.findIndex((each) => each.some((one) => same(one, from))) + (key === "ArrowDown" ? 1 : -1)];
    const x = centerOf(from);
    return row?.reduce((best, each) => (Math.abs(centerOf(each) - x) < Math.abs(centerOf(best) - x) ? each : best));
  };

  const go = (to: Spot, extend: boolean): void => {
    if (extend) {
      anchor ??= spot;
      // An extension stays in the part where it began.
      if (anchor !== undefined && anchor.part !== to.part) return;
    } else {
      anchor = undefined;
    }
    spot = to;
    draw();
    const part = parts[to.part];
    if (part !== undefined)
      say(`${textOf(part, to.word, to.word)}${marked(part).has(to.word) ? `, ${messages.toolMarkSet}` : ""}`);
    caret.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  /** Marks the words from the anchor to the caret, or takes their marks away when each one is marked. */
  const mark = (): void => {
    const part = spot === undefined ? undefined : parts[spot.part];
    const from = anchor ?? spot;
    if (spot === undefined || part === undefined || from === undefined || from.part !== spot.part) return;
    const [first, last] = [Math.min(from.word, spot.word), Math.max(from.word, spot.word)];
    const set = marked(part);
    const all = Array.from({ length: last - first + 1 }, (_, offset) => first + offset).every((index) =>
      set.has(index),
    );
    apply(part, first, last, !all);
    anchor = undefined;
    draw();
    renderList();
  };

  caret.addEventListener(
    "keydown",
    (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey || spot === undefined) return;
      layout();
      if (event.key === "Escape" && anchor !== undefined) {
        event.preventDefault();
        anchor = undefined;
        draw();
      } else if (event.key === "Enter") {
        event.preventDefault();
        mark();
      } else if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        const next = neighbor(event.key, spot);
        if (next !== undefined) go(next, event.shiftKey);
      }
    },
    { signal },
  );

  stage.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || !event.isPrimary || drag !== undefined) return;
      if (event.target instanceof Element && event.target.closest(CONTROLS) !== null) return;
      layout();
      const start = pointSpot(event.clientX, event.clientY);
      if (start === undefined) {
        draw();
        return;
      }
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, start, moved: false };
      spot = start;
      anchor = undefined;
      draw();
    },
    { signal },
  );
  stage.addEventListener(
    "pointermove",
    (event) => {
      if (drag?.id !== event.pointerId) return;
      const over = pointSpot(event.clientX, event.clientY, drag.start.part);
      if (over === undefined || same(over, spot)) return;
      drag.moved = true;
      anchor = drag.start;
      spot = over;
      draw();
    },
    { signal },
  );
  const release = (event: PointerEvent, finished: boolean): void => {
    if (drag?.id !== event.pointerId) return;
    const part = parts[drag.start.part];
    if (finished && part !== undefined && spot !== undefined) {
      const [first, last] = [Math.min(drag.start.word, spot.word), Math.max(drag.start.word, spot.word)];
      apply(part, first, last, drag.moved || !marked(part).has(first));
    }
    drag = undefined;
    anchor = undefined;
    draw();
    renderList();
  };
  stage.addEventListener("pointerup", (event) => release(event, true), { signal });
  stage.addEventListener("pointercancel", (event) => release(event, false), { signal });

  clear.addEventListener(
    "click",
    () => {
      for (const part of parts) memory.words.delete(part.key);
      say(messages.toolMarkCleared);
      draw();
      renderList();
      caret.focus();
    },
    { signal },
  );

  const resizes = new ResizeObserver(() => {
    // Content that was drawn since the last `refresh` belongs to names that the mount has not been given yet: no mark of the
    // content before lies over it.
    const now = partElements(stage);
    if (now.length !== shown.length || now.some((element, index) => element !== shown[index])) {
      bands.replaceChildren();
      caret.hidden = true;
      return;
    }
    layout();
    draw();
  });
  resizes.observe(stage);
  refresh();

  return {
    focus: () => (caret.hidden ? panel : caret).focus(),
    refresh,
    destroy: () => {
      abort.abort();
      resizes.disconnect();
      surface.remove();
      panel.remove();
    },
  };
}
