/**
 * Computer adaptive testing (CAT 1.0): the port to a CAT engine, the models of its requests and responses, the JSON
 * form of the assessment result and the item stage in the public binding, the section data of an adaptive section, the
 * check of its item pool and the metadata file for the engine.
 *
 * @module @assesskit/runtime/cat
 */

export {
  type BuildCatMetadataOptions,
  buildCatMetadata,
  type CatExternalMetadata,
  type CatItemMetadata,
  type CatMetadata,
  type CatMetadataFile,
  type CatPoolItem,
} from "./item-metadata.js";
export { isSessionEnd, readItemStage } from "./item-stage.js";
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
export { readResultsJson } from "./result-json-read.js";
export { writeResultsJson } from "./result-json-write.js";
export { buildSectionData, type SectionFiles } from "./section-data.js";
export { validatePool } from "./validate-pool.js";
