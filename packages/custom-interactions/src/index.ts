/**
 * Portable custom interactions for QTI 3.0 items: the type identifier of each, under which its AMD module registers it, and
 * the module of a character that stroke writing loads. `@assesskit/custom-interactions/node` reads the module files that an
 * item's package carries. It also exports `CallOptions` of `@assesskit/runtime`, which that reader's declaration names, so that a
 * program that installs this package imports it from here.
 *
 * @module @assesskit/custom-interactions
 */
export type { CallOptions } from "@assesskit/runtime/checks";
export { type InteractionName, PCI_TYPE_IDENTIFIERS } from "./interaction-types.js";
export { type CharacterStrokes, writeCharacterModule } from "./write-character-module.js";
