/**
 * Computer adaptive testing (CAT 1.0): the port to a CAT engine, the models of its requests and responses, the JSON
 * form of the assessment result and the item stage in the public binding, the section data of an adaptive section, the
 * check of its item pool and the metadata file for the engine.
 *
 * @module @assesskit/runtime/cat
 */
export { checkPool } from "./check-pool.js";
export {
  type CatExternalMetadata,
  type CatItemMetadata,
  type CatMetadata,
  type CatMetadataFile,
  type CatMetadataOptions,
  type CatPoolItem,
  catMetadata,
} from "./item-metadata.js";
export { isSessionEnd, itemStageFromJson } from "./item-stage.js";
export type {
  CatResponse,
  CreateSectionResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  GetSectionResponse,
  ItemStage,
  PriorDataEntry,
  SectionData,
  SubmitResultsRequest,
  SubmitResultsResponse,
} from "./model.js";
export type { CatPort, CatSessionPort } from "./port.js";
export { assessmentResultFromJson } from "./result-json-read.js";
export { assessmentResultToJson } from "./result-json-write.js";
export { type SectionFiles, sectionData } from "./section-data.js";
