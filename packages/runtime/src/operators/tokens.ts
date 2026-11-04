import { DataError } from "../errors.js";

/**
 * A token of the subset: a number, with its decimal mark written `.` and its digit groups joined; one Latin letter; a command,
 * written without its backslash (`frac`, or `{` for `\{`); or one symbol.
 */
export interface Token {
  readonly type: "number" | "letter" | "command" | "symbol";
  readonly text: string;
  /** Where the token starts in the text, so that a word of letters is told from letters apart. */
  readonly start: number;
  readonly end: number;
}

/** The mark between the whole and the fractional digits of a number. */
export type DecimalSeparator = "." | ",";

/** The characters outside ASCII that the subset reads, as the token each stands for. */
const UNICODE: ReadonlyMap<string, Pick<Token, "type" | "text">> = new Map([
  ["\u2212", { type: "symbol", text: "-" }],
  ["\u00d7", { type: "command", text: "times" }],
  ["\u00b7", { type: "command", text: "cdot" }],
  ["\u00f7", { type: "command", text: "div" }],
  ["\u03c0", { type: "command", text: "pi" }],
  ["\u2264", { type: "command", text: "le" }],
  ["\u2265", { type: "command", text: "ge" }],
  ["\u2260", { type: "command", text: "ne" }],
  ["\u00b0", { type: "command", text: "degree" }],
]);

/** The symbols of the subset. */
const SYMBOLS = new Set(["+", "-", "*", "/", "^", "_", "(", ")", "[", "]", "{", "}", "|", "=", "<", ">", ",", ";"]);

/** The spacing commands, which the reader skips. `\,` between digits groups them instead. */
const SPACING = new Set([",", ";", ":", "!", "quad", "qquad"]);

/** Unicode White_Space, which the reader skips. */
const WHITE_SPACE = /[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;

const DIGIT = /[0-9]/;
const LETTER = /[A-Za-z]/;

/** Whether the text holds a digit at an index. */
function digitAt(text: string, index: number): boolean {
  return DIGIT.test(text.charAt(index));
}

/**
 * Splits a line into tokens in one pass.
 *
 * @throws `DataError` for a character or a lone backslash that the subset does not read.
 */
export function tokenize(text: string, separator: DecimalSeparator): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text.charAt(index);
    if (WHITE_SPACE.test(character) || character === "~") {
      index += 1;
    } else if (DIGIT.test(character) || (separator === "." && character === "." && digitAt(text, index + 1))) {
      const token = readNumber(text, index, separator);
      tokens.push(token);
      index = token.end;
    } else if (character === "\\") {
      index = readCommand(text, index, tokens);
    } else if (LETTER.test(character)) {
      tokens.push({ type: "letter", text: character, start: index, end: index + 1 });
      index += 1;
    } else {
      tokens.push(readSymbol(text, index));
      index += 1;
    }
  }
  return tokens;
}

/** Reads a command after its backslash, and adds it unless it is spacing. */
function readCommand(text: string, start: number, tokens: Token[]): number {
  let end = start + 1;
  while (end < text.length && LETTER.test(text.charAt(end))) end += 1;
  if (end === start + 1) {
    if (end >= text.length) throw new DataError(`The expression ends with a lone backslash at ${start}.`);
    end += 1;
  }
  const name = text.slice(start + 1, end);
  if (!SPACING.has(name)) tokens.push({ type: "command", text: name, start, end });
  return end;
}

/** Reads one symbol, or a character outside ASCII that stands for a token. */
function readSymbol(text: string, start: number): Token {
  const character = text.charAt(start);
  const mapped = UNICODE.get(character);
  if (mapped !== undefined) return { ...mapped, start, end: start + 1 };
  if (SYMBOLS.has(character)) return { type: "symbol", text: character, start, end: start + 1 };
  throw new DataError(`The character ${JSON.stringify(character)} at ${start} is not part of the expression subset.`);
}

/**
 * Reads a number: digits with at most one decimal mark, which is `.`, or with the separator `,` a comma between digits or
 * MathLive's `{,}`; `\,` between digits groups them.
 */
function readNumber(text: string, start: number, separator: DecimalSeparator): Token {
  let digits = "";
  let marked = false;
  let index = start;
  for (;;) {
    while (digitAt(text, index)) {
      digits += text.charAt(index);
      index += 1;
    }
    const mark = marked ? 0 : decimalMarkAt(text, index, separator, digits !== "");
    if (mark > 0 && digitAt(text, index + mark)) {
      digits += ".";
      marked = true;
      index += mark;
    } else if (text.startsWith("\\,", index) && digits !== "" && digitAt(text, index + 2)) {
      index += 2;
    } else {
      return { type: "number", text: digits, start, end: index };
    }
  }
}

/** The length of a decimal mark at an index, or 0 for none. A comma is a mark only after a digit. */
function decimalMarkAt(text: string, index: number, separator: DecimalSeparator, afterDigit: boolean): number {
  if (separator === ".") return text.charAt(index) === "." ? 1 : 0;
  if (!afterDigit) return 0;
  if (text.charAt(index) === ",") return 1;
  return text.startsWith("{,}", index) ? 3 : 0;
}
