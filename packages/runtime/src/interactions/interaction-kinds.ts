import type { InteractionKind } from "./descriptor.js";

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
