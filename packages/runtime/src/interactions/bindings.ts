import { BASE_TYPES, type BaseType, CARDINALITIES, type Cardinality } from "../values/index.js";
import type { Binding, InteractionKind } from "./descriptor.js";

/** The base types of a response to a text interaction that is not a record (INFO §2.4.2.2, §2.4.2.3). */
export const TEXT_BASE_TYPES: readonly BaseType[] = ["float", "integer", "string"];

/** Returns the binding of one cardinality to the given base types. */
export function bind(cardinality: Cardinality, ...baseTypes: readonly BaseType[]): Binding {
  return { cardinality, baseTypes };
}

/**
 * Returns the bindings of an interaction that selects, pairs or marks values of one base type: a container always fits,
 * and a single value fits only when at most one value can be given (INFO §5.30.2: "if max-choices is greater than 1 (or
 * 0) then the interaction must be bound to a response with multiple cardinality").
 */
export function containerBindings(baseType: BaseType, mayBeSingle: boolean): readonly Binding[] {
  return mayBeSingle ? [bind("single", baseType), bind("multiple", baseType)] : [bind("multiple", baseType)];
}

/** Returns the bindings of an interaction that the specification does not bind: every cardinality with every base type. */
export function anyBindings(): readonly Binding[] {
  return CARDINALITIES.map((cardinality) => bind(cardinality, ...(cardinality === "record" ? [] : BASE_TYPES)));
}

/** The kind of every interaction, which JSON that names an interaction is checked against. */
export const INTERACTION_KINDS: ReadonlySet<string> = new Set(
  Object.keys({
    "associate-interaction": true,
    "choice-interaction": true,
    "custom-interaction": true,
    "drawing-interaction": true,
    "end-attempt-interaction": true,
    "extended-text-interaction": true,
    "gap-match-interaction": true,
    "graphic-associate-interaction": true,
    "graphic-gap-match-interaction": true,
    "graphic-order-interaction": true,
    "hotspot-interaction": true,
    "hottext-interaction": true,
    "inline-choice-interaction": true,
    "match-interaction": true,
    "media-interaction": true,
    "order-interaction": true,
    "portable-custom-interaction": true,
    "position-object-interaction": true,
    "select-point-interaction": true,
    "slider-interaction": true,
    "text-entry-interaction": true,
    "upload-interaction": true,
  } satisfies Record<InteractionKind, true>),
);
