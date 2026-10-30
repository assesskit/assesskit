import { describe } from "../checks.js";
import { DataError } from "../errors.js";

/** The digits of base 64, in order (RFC 4648 §4, Table 1). */
const DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** The code of the padding character `=` (RFC 4648 §4). */
const PADDING_CODE = 0x3d;
const BYTE_BITS = 8;
/** Each digit stands for 6 bits, and a group of 3 bytes gives 4 digits (RFC 4648 §4). */
const DIGIT_BITS = 6;
const DIGIT_MASK = 0b11_1111;
const GROUP_BYTES = 3;
const GROUP_DIGITS = 4;
/** The most character codes passed to `String.fromCharCode` at once, below every engine's limit on arguments. */
const CHUNK_SIZE = 0x2000;

/**
 * Checks that a value is bytes, such as the content of a file.
 *
 * @param label - Names the value in the error message, such as `The file settings`.
 * @throws `DataError` when it is not a `Uint8Array`.
 */
export function checkBytes(value: unknown, label: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) throw new DataError(`${label} must be a Uint8Array, found ${describe(value)}.`);
}

/** Returns the bytes in base 64 with padding (RFC 4648 §4), the encoding that CAT 1.0 uses for files (CAT §1.5). */
export function encodeBase64(bytes: Uint8Array): string {
  const codes = new Uint8Array(Math.ceil(bytes.length / GROUP_BYTES) * GROUP_DIGITS);
  let written = 0;
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << BYTE_BITS) | byte;
    bits += BYTE_BITS;
    while (bits >= DIGIT_BITS) {
      bits -= DIGIT_BITS;
      codes[written++] = DIGITS.charCodeAt((buffer >> bits) & DIGIT_MASK);
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) codes[written++] = DIGITS.charCodeAt((buffer << (DIGIT_BITS - bits)) & DIGIT_MASK);
  codes.fill(PADDING_CODE, written);
  let text = "";
  for (let start = 0; start < codes.length; start += CHUNK_SIZE) {
    text += String.fromCharCode(...codes.subarray(start, start + CHUNK_SIZE));
  }
  return text;
}
