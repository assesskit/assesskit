/**
 * Portable custom interactions for QTI 3.0 items: the type identifier of each, under which its AMD module registers it, and
 * the module of a character that stroke writing loads. `@assesskit/custom-interactions/node` reads the module files that an
 * item's package carries.
 *
 * @module @assesskit/custom-interactions
 */
export { type InteractionName, PCI_TYPE_IDENTIFIERS } from "./interaction-types.js";
export { type CharacterStrokes, writeCharacterModule } from "./write-character-module.js";
