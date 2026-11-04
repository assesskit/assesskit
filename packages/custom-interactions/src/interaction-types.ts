/** The name of an interaction of this package, which is also the id of its AMD module. */
export type InteractionName = "math-entry" | "stroke-writing";

/**
 * The `custom-interaction-type-identifier` of each interaction of this package, by its name.
 *
 * @remarks
 * Each is a Federated Content URN, as the QTI 3.0 Best Practices and Implementation Guide recommends, in the namespace of the
 * domain `assesskit.wakan.dev` for 2026. It is fixed: an item's QTI, and every hash of it, holds the identifier, and the
 * module registers the interaction under it.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc4198 | RFC 4198, A Uniform Resource Name (URN) Namespace for Federated Content}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
 */
export const INTERACTION_TYPES: Readonly<Record<InteractionName, string>> = {
  "math-entry": "urn:fdc:assesskit.wakan.dev:2026:math-entry",
  "stroke-writing": "urn:fdc:assesskit.wakan.dev:2026:stroke-writing",
};
