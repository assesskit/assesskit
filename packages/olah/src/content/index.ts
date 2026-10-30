/**
 * What an item shows: the visibility of feedback, template content and choices, printed variables with the C `printf`
 * formats, rubric views, catalogs and cards, and the hazards of a resource in the terms of a PNP.
 *
 * @module @luthfanwakan/olah/content
 */
export { type CardContent, catalogsFor, checkCatalog, selectCard } from "./catalog.js";
export { visibleModalFeedback, visibleTestFeedback } from "./feedback.js";
export {
  type DrdHazardTerm,
  HAZARD_TERMS,
  type HazardExposure,
  hazardExposure,
  type PnpHazardTerm,
} from "./hazards.js";
export { formatPrintedVariable } from "./printed-variable.js";
export { type ResolveContentOptions, resolveContent } from "./resolve.js";
export { rubricBlocksFor, type TestPosition, testRubricBlocks, VIEWS, type View } from "./rubric.js";
export type { ContentVariables } from "./variables.js";
export { isShown } from "./visibility.js";
