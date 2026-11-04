// The string functions of PHP that Moodle's GIFT importer calls, with PHP's edge cases, so that the reader splits a file
// where Moodle does. They work on UTF-16 code units; the importer finds ASCII marks only, at the same characters as PHP's
// byte offsets.

/** The characters that PHP's `trim` removes. */
const TRIMMED = " \t\n\r\0\v";

/** PHP's `trim`. */
export function phpTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && TRIMMED.includes(text.charAt(start))) start += 1;
  while (end > start && TRIMMED.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(start, end);
}

/** PHP's `empty` of a string: the empty string and `"0"`. */
export function phpEmpty(text: string | undefined): boolean {
  return text === undefined || text === "" || text === "0";
}

/** PHP's `substr`, with a negative start or length counted from the end and an empty result past the end. */
export function phpSubstr(text: string, start: number, length?: number): string {
  const from = start < 0 ? Math.max(text.length + start, 0) : start;
  if (from > text.length) return "";
  if (length === undefined) return text.slice(from);
  const to = length < 0 ? text.length + length : from + length;
  return to <= from ? "" : text.slice(from, to);
}

/** PHP's `substr_replace` of one string. */
export function phpSubstrReplace(text: string, replacement: string, start: number, length: number): string {
  const from = start < 0 ? Math.max(text.length + start, 0) : Math.min(start, text.length);
  const to = length < 0 ? Math.max(text.length + length, from) : Math.min(from + length, text.length);
  return text.slice(0, from) + replacement + text.slice(to);
}

/** PHP's `explode` with a limit: at most `limit` parts, the last holding the rest. */
export function phpExplode(separator: string, text: string, limit = Number.POSITIVE_INFINITY): string[] {
  const parts: string[] = [];
  let from = 0;
  while (parts.length < limit - 1) {
    const at = text.indexOf(separator, from);
    if (at < 0) break;
    parts.push(text.slice(from, at));
    from = at + separator.length;
  }
  parts.push(text.slice(from));
  return parts;
}

/** The form of a numeric string of PHP 8: white space, a sign, digits with a point, an exponent, white space. */
const NUMERIC = /^[ \t\n\r\v\f]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[ \t\n\r\v\f]*$/;

/** PHP's `is_numeric` of a string. */
export function phpIsNumeric(text: string): boolean {
  return NUMERIC.test(text);
}

/** The number of a numeric string, as PHP's arithmetic reads it. */
export function phpNumber(text: string): number {
  return Number(text.trim());
}
