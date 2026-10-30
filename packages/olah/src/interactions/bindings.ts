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

/** The section of the information model that states the binding of each interaction. */
export const BINDING_SOURCES: Readonly<Record<InteractionKind, string>> = {
  "associate-interaction": "INFO §2.4.1.3",
  "choice-interaction": "INFO §2.4.1.1",
  "custom-interaction": "INFO §2.4.4.5",
  "drawing-interaction": "INFO §2.4.4.3",
  "end-attempt-interaction": "INFO §2.4.5",
  "extended-text-interaction": "INFO §2.4.2.3",
  "gap-match-interaction": "INFO §2.4.1.5",
  "graphic-associate-interaction": "INFO §2.4.3.3",
  "graphic-gap-match-interaction": "INFO §2.4.3.4",
  "graphic-order-interaction": "INFO §2.4.3.2",
  "hotspot-interaction": "INFO §2.4.3.1",
  "hottext-interaction": "INFO §2.4.2.4",
  "inline-choice-interaction": "INFO §2.4.2.1",
  "match-interaction": "INFO §2.4.1.4",
  "media-interaction": "INFO §2.4.4.2",
  "order-interaction": "INFO §2.4.1.2",
  "portable-custom-interaction": "INFO §2.4.4.6",
  "position-object-interaction": "INFO §2.4.3.6",
  "select-point-interaction": "INFO §2.4.3.5",
  "slider-interaction": "INFO §2.4.4.1",
  "text-entry-interaction": "INFO §2.4.2.2",
  "upload-interaction": "INFO §2.4.4.4",
};
