/** The name of an interaction of this package, which is also the id of its AMD module. */
export type InteractionName = "math-entry";

/**
 * The `custom-interaction-type-identifier` of each interaction of this package, by its name.
 *
 * @remarks
 * Each is a `urn:uuid:` that names no brand, so that it stays the same under any name that the content or the package is
 * published under; an item's QTI, and every hash of it, holds the identifier. The module registers the interaction under it.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc9562 | RFC 9562, Universally Unique IDentifiers}
 */
export const INTERACTION_TYPES: Readonly<Record<InteractionName, string>> = {
  "math-entry": "urn:uuid:d8feb3d2-0816-4d3b-a66a-9e4461e2c156",
};
