const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;

/** A low surrogate: the second UTF-16 unit of a character outside the Basic Multilingual Plane, which has no column. */
const LOW_SURROGATE = /[\uDC00-\uDFFF]/;

const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * Converts offsets of a text into the line and column of the XML parser's reports, for offsets that grow.
 *
 * @remarks
 * Line ends are `\n`, `\r\n` and a lone `\r`, and columns count characters, not UTF-16 units. The locator moves forward
 * from the last offset it was asked for, so that reading all positions of a document costs one pass over its text. In a
 * text without a character outside the Basic Multilingual Plane, a column is a count of UTF-16 units, and the pass looks
 * for line ends with `indexOf` rather than at each unit.
 *
 * @see {@link https://www.w3.org/TR/xml/ | Extensible Markup Language (XML) 1.0, End-of-Line Handling}
 */
export class Locator {
  private readonly text: string;
  /** Whether the text has no low surrogate, so that a column is a count of UTF-16 units. */
  private readonly units: boolean;
  private index: number;
  private line = 1;
  private column = 1;
  /** The offset of the first unit of the current line. */
  private lineStart: number;
  /** The offset of the next `\n` and of the next `\r` at or after the last search, or the length of the text. */
  private lineFeed = -1;
  private carriageReturn = -1;

  /**
   * Starts at the beginning of a text.
   *
   * @param text - The text, which may start with a byte order mark; the mark has no column.
   */
  constructor(text: string) {
    this.text = text;
    this.index = text.startsWith("﻿") ? 1 : 0;
    this.lineStart = this.index;
    this.units = !LOW_SURROGATE.test(text);
  }

  /**
   * Returns the line and column of an offset.
   *
   * @param offset - An offset that is not before the one asked for last.
   * @returns The line and the column, both from 1.
   */
  at(offset: number): { readonly line: number; readonly column: number } {
    if (offset > this.index) {
      if (this.units) this.moveByLines(offset);
      else this.moveByUnits(offset);
    }
    return { line: this.line, column: this.column };
  }

  /** Moves to an offset one unit at a time, counting the characters of the line. */
  private moveByUnits(offset: number): void {
    const { text } = this;
    for (; this.index < offset; this.index++) {
      const code = text.charCodeAt(this.index);
      if (code === LINE_FEED || (code === CARRIAGE_RETURN && text.charCodeAt(this.index + 1) !== LINE_FEED)) {
        this.line++;
        this.column = 1;
      } else if (code !== CARRIAGE_RETURN && !isLowSurrogate(code)) {
        this.column++;
      }
    }
  }

  /**
   * Moves to an offset from one line end to the next. The column is the units since the start of the line, less a `\r`
   * just before the offset whose `\n` is at the offset, which belongs to the line end.
   */
  private moveByLines(offset: number): void {
    const { text } = this;
    let from = this.index;
    for (;;) {
      if (this.lineFeed < from) this.lineFeed = foundOrEnd(text.indexOf("\n", from), text);
      if (this.carriageReturn < from) this.carriageReturn = foundOrEnd(text.indexOf("\r", from), text);
      const end = Math.min(this.lineFeed, this.carriageReturn);
      if (end >= offset) break;
      from = end + 1;
      // The `\r` of `\r\n` ends no line: its `\n` does.
      if (end === this.carriageReturn && text.charCodeAt(from) === LINE_FEED) continue;
      this.line++;
      this.lineStart = from;
    }
    const lineEndStarts = text.charCodeAt(offset - 1) === CARRIAGE_RETURN && text.charCodeAt(offset) === LINE_FEED;
    this.index = offset;
    this.column = 1 + offset - this.lineStart - (lineEndStarts ? 1 : 0);
  }
}

/** The offset that `indexOf` found, or the length of the text when it found none. */
const foundOrEnd = (found: number, text: string): number => (found < 0 ? text.length : found);
