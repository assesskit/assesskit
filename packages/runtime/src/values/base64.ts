import { checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";

/** The digits of base 64, in order (RFC 4648 §4, Table 1). */
const BASE64_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** The digits of base 64 with a URL and filename safe alphabet (RFC 4648 §5, Table 2). */
const BASE64URL_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** The code of the padding character `=` (RFC 4648 §4). */
const PADDING_CODE = 0x3d;
/** The most padding characters that end a text: a group of 4 digits holds at least one byte (RFC 4648 §4). */
const MAX_PADDING = 2;
const BYTE_BITS = 8;
const BYTE_MASK = 0xff;
/** Each digit stands for 6 bits, and a group of 3 bytes gives 4 digits (RFC 4648 §4). */
const DIGIT_BITS = 6;
const DIGIT_MASK = 0b11_1111;
const GROUP_BYTES = 3;
const GROUP_DIGITS = 4;
/** The most character codes passed to `String.fromCharCode` at once, below every engine's limit on arguments. */
const CHUNK_SIZE = 0x2000;
/** The size of the table of digit values: every digit is ASCII. */
const ASCII_CODES = 0x80;
/** Marks a character that is not a digit in the table of digit values. */
const NOT_A_DIGIT = -1;

/** An alphabet of RFC 4648 with its table of digit values, and whether its texts end in padding. */
interface Alphabet {
  readonly digits: string;
  readonly values: Int8Array;
  readonly padded: boolean;
}

function alphabet(digits: string, padded: boolean): Alphabet {
  const values = new Int8Array(ASCII_CODES).fill(NOT_A_DIGIT);
  for (let value = 0; value < digits.length; value += 1) values[digits.charCodeAt(value)] = value;
  return { digits, values, padded };
}

const BASE64 = alphabet(BASE64_DIGITS, true);
const BASE64URL = alphabet(BASE64URL_DIGITS, false);

/**
 * Checks that a value is bytes, such as the content of a file.
 *
 * @param label - Names the value in the error message, such as `The file settings`.
 * @throws `DataError` when it is not a `Uint8Array`.
 */
export function checkBytes(value: unknown, label: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) throw new DataError(`${label} must be a Uint8Array, found ${describe(value)}.`);
}

function encode(bytes: Uint8Array, { digits, padded }: Alphabet): string {
  const length = padded
    ? Math.ceil(bytes.length / GROUP_BYTES) * GROUP_DIGITS
    : Math.ceil((bytes.length * BYTE_BITS) / DIGIT_BITS);
  const codes = new Uint8Array(length);
  let written = 0;
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << BYTE_BITS) | byte;
    bits += BYTE_BITS;
    while (bits >= DIGIT_BITS) {
      bits -= DIGIT_BITS;
      codes[written++] = digits.charCodeAt((buffer >> bits) & DIGIT_MASK);
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) codes[written++] = digits.charCodeAt((buffer << (DIGIT_BITS - bits)) & DIGIT_MASK);
  codes.fill(PADDING_CODE, written);
  let text = "";
  for (let start = 0; start < codes.length; start += CHUNK_SIZE) {
    text += String.fromCharCode(...codes.subarray(start, start + CHUNK_SIZE));
  }
  return text;
}

/** Returns the length of a text without its padding, or `undefined` when the padding is not that of the alphabet. */
function lengthWithoutPadding(text: string, padded: boolean): number | undefined {
  if (!padded) return text.length;
  if (text.length % GROUP_DIGITS !== 0) return undefined;
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === PADDING_CODE) end -= 1;
  return text.length - end > MAX_PADDING ? undefined : end;
}

function decode(text: string, { values, padded }: Alphabet): Uint8Array<ArrayBuffer> | undefined {
  const end = lengthWithoutPadding(text, padded);
  if (end === undefined) return undefined;
  const bytes = new Uint8Array(Math.floor((end * DIGIT_BITS) / BYTE_BITS));
  let written = 0;
  let buffer = 0;
  let bits = 0;
  for (let position = 0; position < end; position += 1) {
    const value = values[text.charCodeAt(position)] ?? NOT_A_DIGIT;
    if (value === NOT_A_DIGIT) return undefined;
    buffer = (buffer << DIGIT_BITS) | value;
    bits += DIGIT_BITS;
    if (bits >= BYTE_BITS) {
      bits -= BYTE_BITS;
      bytes[written++] = (buffer >> bits) & BYTE_MASK;
      buffer &= (1 << bits) - 1;
    }
  }
  // RFC 4648 §3.5: the bits after the last byte are zero, and a lone digit stands for no byte.
  return bits >= DIGIT_BITS || buffer !== 0 ? undefined : bytes;
}

/**
 * Returns the bytes in base 64 with padding (RFC 4648 §4), the encoding that CAT 1.0 uses for files (CAT §1.5).
 *
 * @throws `DataError` when the bytes are not a `Uint8Array`.
 */
export function encodeBase64(bytes: Uint8Array): string {
  checkBytes(bytes, "The bytes to encode");
  return encode(bytes, BASE64);
}

/**
 * Returns the bytes that a text in base 64 with padding encodes (RFC 4648 §4), or `undefined` when the text is not that
 * encoding of any bytes: it has a character outside the alphabet, wrong padding, or bits after the last byte that are not
 * zero.
 *
 * Only the canonical encoding decodes (RFC 4648 §3.5), so that `encodeBase64` of the result is the text. A decoder that
 * ignores the bits that stand for no byte accepts several spellings of the same bytes, which a bookkeeping by the text of
 * a token, such as a log or a cache, could not tell apart.
 *
 * @throws `DataError` when the text is not a string.
 */
export function decodeBase64(text: string): Uint8Array<ArrayBuffer> | undefined {
  checkString(text, "The text to decode");
  return decode(text, BASE64);
}

/**
 * Returns the bytes in base 64 with the URL and filename safe alphabet, without padding (RFC 4648 §5), as the parts of a
 * JWT are (RFC 7515 §2).
 *
 * @throws `DataError` when the bytes are not a `Uint8Array`.
 */
export function encodeBase64Url(bytes: Uint8Array): string {
  checkBytes(bytes, "The bytes to encode");
  return encode(bytes, BASE64URL);
}

/**
 * Returns the bytes that a text in base64url without padding encodes (RFC 4648 §5), or `undefined` when the text is not
 * that encoding of any bytes, by the rule of {@link decodeBase64}.
 *
 * @throws `DataError` when the text is not a string.
 */
export function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  checkString(text, "The text to decode");
  return decode(text, BASE64URL);
}
