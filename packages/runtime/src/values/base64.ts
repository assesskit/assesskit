import { checkBytes, checkString } from "../checks.js";

/** The digits of base 64, in order. */
const BASE64_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** The digits of base 64 with the URL and filename safe alphabet. */
const BASE64URL_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** The code of the padding character `=`. */
const PADDING_CODE = 0x3d;
/** The most padding characters that end a text: a group of 4 digits holds at least one byte. */
const MAX_PADDING = 2;
const BYTE_BITS = 8;
const BYTE_MASK = 0xff;
/** Each digit stands for 6 bits, and a group of 3 bytes gives 4 digits. */
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
  // The canonical encoding: the bits after the last byte are zero, and a lone digit stands for no byte.
  return bits >= DIGIT_BITS || buffer !== 0 ? undefined : bytes;
}

/**
 * Writes bytes in base 64 with padding, the encoding that CAT 1.0 uses for files.
 *
 * @param bytes - The bytes.
 * @returns The text.
 * @throws `DataError` when `bytes` is not a `Uint8Array`.
 * @see {@link https://www.rfc-editor.org/rfc/rfc4648#section-4 | RFC 4648, base 64}
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export function encodeBase64(bytes: Uint8Array): string {
  checkBytes(bytes, "The bytes to encode");
  return encode(bytes, BASE64);
}

/**
 * Reads a text in base 64 with padding.
 *
 * @remarks
 * Only the canonical encoding decodes, so that {@link encodeBase64} of the result is the text. A decoder that ignores the
 * bits that stand for no byte accepts several spellings of the same bytes, which a bookkeeping by the text of a token,
 * such as a log or a cache, could not tell apart.
 *
 * @param text - The text.
 * @returns The bytes, or `undefined` when the text is not the encoding of any bytes: it has a character outside the
 * alphabet, wrong padding, or bits after the last byte that are not zero.
 * @throws `DataError` when `text` is not a string.
 * @see {@link https://www.rfc-editor.org/rfc/rfc4648#section-4 | RFC 4648, base 64}
 * @see {@link https://www.rfc-editor.org/rfc/rfc4648#section-3.5 | RFC 4648, canonical encoding}
 */
export function decodeBase64(text: string): Uint8Array<ArrayBuffer> | undefined {
  checkString(text, "The text to decode");
  return decode(text, BASE64);
}

/**
 * Writes bytes in base 64 with the URL and filename safe alphabet, without padding, as the parts of a JWT are.
 *
 * @param bytes - The bytes.
 * @returns The text.
 * @throws `DataError` when `bytes` is not a `Uint8Array`.
 * @see {@link https://www.rfc-editor.org/rfc/rfc4648#section-5 | RFC 4648, base 64 with a URL and filename safe alphabet}
 * @see {@link https://www.rfc-editor.org/rfc/rfc7515#section-2 | RFC 7515, JSON Web Signature terminology}
 */
export function encodeBase64Url(bytes: Uint8Array): string {
  checkBytes(bytes, "The bytes to encode");
  return encode(bytes, BASE64URL);
}

/**
 * Reads a text in base64url without padding, by the rule of {@link decodeBase64}.
 *
 * @param text - The text.
 * @returns The bytes, or `undefined` when the text is not the encoding of any bytes.
 * @throws `DataError` when `text` is not a string.
 * @see {@link https://www.rfc-editor.org/rfc/rfc4648#section-5 | RFC 4648, base 64 with a URL and filename safe alphabet}
 */
export function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  checkString(text, "The text to decode");
  return decode(text, BASE64URL);
}
