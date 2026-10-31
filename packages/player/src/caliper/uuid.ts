import { v5 } from "uuid";

/**
 * The namespace of the identifiers that the player mints: the name-based UUID of the address of this folder in the URL
 * namespace. Changing it changes every identifier, so it never changes.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc9562#section-5.5 | RFC 9562, UUID version 5}
 */
export const CALIPER_NAMESPACE = "4bcd2e8b-df2f-56d9-b6c1-d17e5077c977";

/**
 * Returns the URN `urn:uuid:<UUID>` of the name that the parts make: the JSON text of the array, so that no two lists of
 * parts make one name. The same parts always give the same URN.
 *
 * @param parts - What identifies the thing, such as the kind of entity and the session it belongs to.
 * @returns The URN.
 */
export function mintUrn(parts: readonly (string | number)[]): string {
  return `urn:uuid:${v5(JSON.stringify(parts), CALIPER_NAMESPACE)}`;
}
