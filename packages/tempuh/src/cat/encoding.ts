import { DataError } from "../errors.js";

const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;

/** Returns the bytes as lowercase hexadecimal, two digits for each byte. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, "0")).join("");
}

/**
 * Decodes base64 text (RFC 4648 §4) to the file it encodes and reads the file as UTF-8 JSON.
 *
 * @param label - Names the file in the error message, such as `The section configuration`.
 * @throws `DataError` when the text is not base64, the bytes are not UTF-8, or the text is not JSON.
 */
export function readJson(encoded: string, label: string): unknown {
  const text = decodeText(decodeBase64(encoded, label), label);
  try {
    return JSON.parse(text);
  } catch {
    throw new DataError(`${label} must be JSON text, found text that is not.`);
  }
}

/**
 * Decodes base64 text (RFC 4648 §4) to the bytes of a file.
 *
 * @throws `DataError` when the text is not base64.
 */
export function decodeBase64(encoded: string, label: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new DataError(`${label} must be base64 text (RFC 4648), found text that is not.`);
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeText(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DataError(`${label} must be UTF-8 text, found bytes that are not.`);
  }
}
