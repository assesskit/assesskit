/**
 * Helpers of speech that other folders of the player and its tests use.
 *
 * @remarks
 * The package does not export them.
 *
 * @module
 */
export { applyDataSsml, readDataSsml } from "./data-ssml.js";
export { checkLexicons } from "./lexicon.js";
export { type Pronounced, pronounce } from "./pronounce.js";
export { checkSpeechRequest } from "./request.js";
export { checkSpeechSettings } from "./settings.js";
export { plainText, speakDocument, ssmlElement, xmlSafe } from "./ssml.js";
