const ALPHABET = /^[A-Za-z0-9_-]*$/u;

/** Encodes bytes as base64url without padding (RFC 4648 §5), the form of the parts of a JWT (RFC 7515 §2). */
export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Encodes text as the base64url of its UTF-8 bytes. */
export function encodeTextBase64Url(text: string): string {
  return encodeBase64Url(new TextEncoder().encode(text));
}

/** Decodes base64url without padding. Returns `undefined` when the text has a character outside the alphabet or an impossible length. */
export function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!ALPHABET.test(text) || text.length % 4 === 1) return undefined;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
