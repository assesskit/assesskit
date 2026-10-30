/**
 * Computer adaptive testing (CAT 1.0): the port to a CAT engine, the models of its requests and responses, the section
 * data of an adaptive section, the check of its item pool and the metadata file for the engine.
 *
 * @module @luthfanwakan/olah/cat
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
export { isSessionEnd } from "./item-stage.js";
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
export type { CatPort } from "./port.js";
export { type SectionFiles, sectionData } from "./section-data.js";
