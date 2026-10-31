/**
 * Converts offsets of a text into the line and column of the XML parser's reports, for offsets that grow.
 *
 * @remarks
 * Line ends are `\n`, `\r\n` and a lone `\r`, and columns count characters, not UTF-16 units. The locator moves forward
 * from the last offset it was asked for, so that reading all positions of a document costs one pass over its text.
 *
 * @see {@link https://www.w3.org/TR/xml/ | Extensible Markup Language (XML) 1.0, End-of-Line Handling}
 */
export class Locator {
  private readonly text: string;
  private index: number;
  private line = 1;
  private column = 1;

  /**
   * Starts at the beginning of a text.
   *
   * @param text - The text, which may start with a byte order mark; the mark has no column.
   */
  constructor(text: string) {
    this.text = text;
    this.index = text.startsWith("﻿") ? 1 : 0;
  }

  /**
   * Returns the line and column of an offset.
   *
   * @param offset - An offset that is not before the one asked for last.
   * @returns The line and the column, both from 1.
   */
  at(offset: number): { readonly line: number; readonly column: number } {
    for (; this.index < offset; this.index++)
      this.advance(this.text.charCodeAt(this.index), this.text.charCodeAt(this.index + 1));
    return { line: this.line, column: this.column };
  }

  private advance(code: number, next: number): void {
    const carriageReturn = 13;
    const lineFeed = 10;
    const lowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;
    if (code === lineFeed || (code === carriageReturn && next !== lineFeed)) {
      this.line++;
      this.column = 1;
    } else if (code !== carriageReturn && !lowSurrogate(code)) {
      this.column++;
    }
  }
}
