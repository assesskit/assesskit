const UUID_BYTES = 16;
// RFC 9562 §4.1 and §4.2: the high four bits of byte 6 are the version, 0101 for version 5, and the high two bits of byte 8
// are the variant, 10.
const VERSION_BYTE = 6;
const VERSION_KEEP = 0x0f;
const VERSION_5 = 0x50;
const VARIANT_BYTE = 8;
const VARIANT_KEEP = 0x3f;
const VARIANT_RFC = 0x80;

/**
 * The namespace of the identifiers that tempuh mints: the name-based UUID of the address of this folder in the URL
 * namespace (RFC 9562 §6.6). Changing it changes every identifier, so it never changes.
 */
export const CALIPER_NAMESPACE = "e77b625a-3ddd-5fa9-be27-44f813a9600d";

function parseUuid(uuid: string): Uint8Array {
  const hex = uuid.replaceAll("-", "");
  return Uint8Array.from({ length: UUID_BYTES }, (_, at) => Number.parseInt(hex.slice(at * 2, at * 2 + 2), 16));
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Returns the name-based UUID of version 5 (RFC 9562 §5.5): the SHA-1 of the namespace and the UTF-8 bytes of the name,
 * cut to 128 bits, with the version and the variant set.
 *
 * @param namespace - The UUID of the namespace, in its textual form.
 * @param name - The name.
 */
export async function uuidV5(namespace: string, name: string): Promise<string> {
  const text = new TextEncoder().encode(name);
  const input = new Uint8Array(UUID_BYTES + text.length);
  input.set(parseUuid(namespace));
  input.set(text, UUID_BYTES);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  return formatUuid(
    Uint8Array.from(digest.subarray(0, UUID_BYTES), (byte, at) => {
      if (at === VERSION_BYTE) return (byte & VERSION_KEEP) | VERSION_5;
      if (at === VARIANT_BYTE) return (byte & VARIANT_KEEP) | VARIANT_RFC;
      return byte;
    }),
  );
}

/**
 * Returns the URN `urn:uuid:<UUID>` of the name that the parts make: the JSON text of the array, so that no two lists of
 * parts make one name. The same parts always give the same URN.
 *
 * @param parts - What identifies the thing, such as the kind of entity and the session it belongs to.
 */
export async function mintUrn(parts: readonly (string | number)[]): Promise<string> {
  return `urn:uuid:${await uuidV5(CALIPER_NAMESPACE, JSON.stringify(parts))}`;
}
