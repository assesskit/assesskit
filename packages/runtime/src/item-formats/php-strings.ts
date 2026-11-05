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

/** PHP's `substr` from a start within the text, with a negative length counted from the end, as the importer calls it. */
export function phpSubstr(text: string, start: number, length: number): string {
  const to = length < 0 ? text.length + length : start + length;
  return to <= start ? "" : text.slice(start, to);
}

/** PHP's `substr_replace` of one string from a start within it, with a negative length counted from the end. */
export function phpSubstrReplace(text: string, replacement: string, start: number, length: number): string {
  const to = length < 0 ? Math.max(text.length + length, start) : Math.min(start + length, text.length);
  return text.slice(0, start) + replacement + text.slice(to);
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

/** The value of each character of base64's alphabet by its code, -1 for any other below 128. */
const BASE64_VALUES = Int8Array.from({ length: 128 }, (_, code) =>
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(String.fromCharCode(code)),
);

/**
 * PHP's `base64_decode` without its strict mode: it skips each character outside base64's alphabet, padding included, and
 * leaves out the bits of a last group too short for a byte.
 */
export function phpBase64Decode(text: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let length = 0;
  let bits = 0;
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const value = BASE64_VALUES[text.charCodeAt(index)] ?? -1;
    if (value < 0) continue;
    bits = ((bits << 6) | value) & 0x3fff;
    count += 6;
    if (count >= 8) {
      count -= 8;
      bytes[length] = bits >> count;
      length += 1;
    }
  }
  return bytes.slice(0, length);
}
