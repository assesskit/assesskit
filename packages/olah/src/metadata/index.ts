/**
 * QTI metadata, IEEE LOM, curriculum standards metadata and the accessibility description of resources, read and
 * written as the metadata of a resource in a content package, and the metadata derived from an item.
 *
 * @module @luthfanwakan/olah/metadata
 */
export {
  ACCESS_MODES,
  type AccessForAllResource,
  type AccessMode,
  ADAPTATION_DETAILS,
  ADAPTATION_MEDIA_TYPES,
  ADAPTATION_TYPES,
  type AdaptationDetail,
  type AdaptationMediaType,
  type AdaptationType,
  API_INTEROPERABLE,
  type ApiInteroperable,
  COMPLEXITY_OF_ADAPTATION,
  CONTROL_FLEXIBILITY,
  type ComplexityOfAdaptation,
  type ControlFlexibility,
  DISPLAY_TRANSFORMABILITY,
  type DisplayTransformability,
  DRD_HAZARDS,
  type DrdHazard,
  type Hazard,
  readAccessForAllResource,
  writeAccessForAllResource,
} from "./access-for-all.js";
export {
  type CurriculumStandards,
  type CurriculumStandardsSet,
  type GuidSet,
  type LabelledGuid,
  readCurriculumStandardsSet,
  writeCurriculumStandardsSet,
} from "./curriculum-standards.js";
export { deriveQtiMetadata } from "./derive.js";
export { type LomGeneral, type LomString, lomGeneral } from "./lom.js";
export {
  CP_NAMESPACE,
  CSM_NAMESPACE,
  DRD_NAMESPACE,
  LOM_NAMESPACE,
  QTI_METADATA_NAMESPACE,
} from "./namespaces.js";
export {
  checkQtiMetadata,
  FEEDBACK_TYPES,
  type FeedbackType,
  INTERACTION_TYPES,
  type InteractionType,
  type PciContext,
  type QtiMetadata,
  readQtiMetadata,
  SCORING_MODES,
  type ScoringMode,
  writeQtiMetadata,
} from "./qti-metadata.js";
export { type ResourceMetadata, readResourceMetadata, writeResourceMetadata } from "./resource-metadata.js";
export type { ExtensionTerm } from "./text.js";
