import { v5 } from "uuid";

/**
 * The namespace of the identifiers that tempuh mints: the name-based UUID of the address of this folder in the URL
 * namespace (RFC 9562 §6.6). Changing it changes every identifier, so it never changes.
 */
export const CALIPER_NAMESPACE = "e77b625a-3ddd-5fa9-be27-44f813a9600d";

/**
 * Returns the URN `urn:uuid:<UUID>` of the name that the parts make: the JSON text of the array, so that no two lists of
 * parts make one name. The same parts always give the same URN.
 *
 * @param parts - What identifies the thing, such as the kind of entity and the session it belongs to.
 */
export function mintUrn(parts: readonly (string | number)[]): string {
  return `urn:uuid:${v5(JSON.stringify(parts), CALIPER_NAMESPACE)}`;
}
