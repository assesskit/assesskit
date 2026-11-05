import { base64, base64urlnopad } from "@scure/base";
import { checkString } from "../checks.js";
import { checkBytes } from "../checks-internal.js";

/** Returns the bytes of a text, or `undefined` when the codec refuses it. */
function decode(text: string, codec: typeof base64): Uint8Array<ArrayBuffer> | undefined {
  try {
    return codec.decode(text) as Uint8Array<ArrayBuffer>;
  } catch {
    return undefined;
  }
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
  return base64.encode(bytes);
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
  return decode(text, base64);
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
  return decode(text, base64urlnopad);
}
