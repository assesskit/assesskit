/**
 * Writers and readers between QTI items and two other platforms' item formats, GIFT and Moodle XML: each question type that
 * holds an interaction converts, with its credits and feedback as Moodle scores them, and what does not convert is listed
 * with its reason.
 *
 * @module @assesskit/runtime/item-formats
 */
export { readGift } from "./gift-parse.js";
export { writeGift } from "./gift-write.js";
export { DEFAULT_ITEM_FORMAT_LIMITS, type ItemFormatLimits } from "./limits.js";
export type {
  BankItem,
  ConversionLoss,
  ExportedItems,
  ImportedItems,
  LossReason,
  ReadItemsOptions,
  TrueFalseLabels,
  WriteItemsOptions,
  WriteMoodleXmlOptions,
} from "./model.js";
export { readMoodleXml } from "./moodle-xml-read.js";
export { writeMoodleXml } from "./moodle-xml-write.js";
