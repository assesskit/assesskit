/** A word of the text of a part: a stretch of one text node. */
export interface Word {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

/** A rectangle in CSS pixels, from the top left of the layer that lies over the item. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The elements whose text is no word: controls, which the candidate fills in or presses, and what is no text. */
const SKIPPED = "input, textarea, select, button, script, style, template, noscript";

/**
 * Han, Hiragana and Katakana characters, which stand alone as words: these scripts write no space between words and
 * `Intl.Segmenter` is outside the browser baseline.
 */
const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";

/** A word is a run of characters that are no space, or one CJK character. */
const WORD = new RegExp(`[${CJK}]|[^\\s${CJK}]+`, "gu");

/**
 * Finds the words of the text below an element, in document order.
 *
 * @remarks
 * A word never spans two text nodes. A script that writes its words with no space, Thai for one, has whole phrases for words.
 *
 * @param part - The element whose text it reads.
 * @param skip - An element inside `part` whose text is left out, such as the layer of the tools.
 * @returns The words.
 */
export function wordsOf(part: Element, skip: Element): Word[] {
  const words: Word[] = [];
  const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      skip.contains(node) || node.parentElement?.closest(SKIPPED) != null
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node instanceof Text; node = walker.nextNode()) {
    for (const match of node.data.matchAll(WORD)) {
      words.push({ node, start: match.index, end: match.index + match[0].length });
    }
  }
  return words;
}

/**
 * Measures where each word is on the page.
 *
 * @param words - The words.
 * @param origin - The rectangle of the layer, which the boxes are measured from.
 * @returns For each word its boxes, one for each line it takes, and none for a word that is not on the screen.
 */
export function measure(words: readonly Word[], origin: DOMRect): Box[][] {
  const range = document.createRange();
  return words.map(({ node, start, end }) => {
    range.setStart(node, start);
    range.setEnd(node, end);
    return [...range.getClientRects()]
      .filter(({ width, height }) => width > 0 && height > 0)
      .map(({ left, top, width, height }) => ({ left: left - origin.left, top: top - origin.top, width, height }));
  });
}

/**
 * Groups the words on the screen into lines, in reading order.
 *
 * @remarks
 * A word whose middle lies within the height of the line before it is on that line, so that a superscript does not make a
 * line of its own.
 *
 * @param boxes - The boxes of the words, from {@link measure}.
 * @returns The indexes of the words of each line.
 */
export function linesOf(boxes: readonly (readonly Box[])[]): number[][] {
  const lines: { top: number; bottom: number; words: number[] }[] = [];
  for (const [index, [box]] of boxes.entries()) {
    if (box === undefined) continue;
    const middle = box.top + box.height / 2;
    const line = lines.at(-1);
    if (line !== undefined && middle >= line.top && middle < line.bottom) {
      line.top = Math.min(line.top, box.top);
      line.bottom = Math.max(line.bottom, box.top + box.height);
      line.words.push(index);
    } else {
      lines.push({ top: box.top, bottom: box.top + box.height, words: [index] });
    }
  }
  return lines.map(({ words }) => words);
}

/**
 * Finds the word at a point.
 *
 * @param boxes - The boxes of the words, from {@link measure}.
 * @param x - The distance from the left of the layer.
 * @param y - The distance from the top of the layer.
 * @returns The index of the word, or `undefined` when the point is on no word.
 */
export function wordAt(boxes: readonly (readonly Box[])[], x: number, y: number): number | undefined {
  const index = boxes.findIndex((each) =>
    each.some(({ left, top, width, height }) => x >= left && x < left + width && y >= top && y < top + height),
  );
  return index < 0 ? undefined : index;
}

/**
 * Joins the boxes of a run of words into one box for each line, so that a mark is a band and not a rectangle for each word.
 *
 * @param boxes - The boxes of the words, from {@link measure}.
 * @param first - The index of the first word of the run.
 * @param last - The index of the last word of the run.
 * @returns The boxes, from the first line to the last.
 */
export function joinLines(boxes: readonly (readonly Box[])[], first: number, last: number): Box[] {
  const joined: Box[] = [];
  for (const box of boxes.slice(first, last + 1).flat()) {
    const line = joined.at(-1);
    if (line !== undefined && Math.abs(line.top - box.top) < line.height / 2 && box.left >= line.left) {
      joined[joined.length - 1] = { ...line, width: Math.max(line.width, box.left + box.width - line.left) };
    } else {
      joined.push(box);
    }
  }
  return joined;
}
