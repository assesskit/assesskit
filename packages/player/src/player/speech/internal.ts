/**
 * What other folders of the player and its tests use of speech: the reading of a range, the typing echo and the reading
 * type, which `mountSpoken` applies.
 *
 * @remarks
 * The package does not export them.
 *
 * @module
 */
export { applyDataSsml, readDataSsml } from "./data-ssml.js";
export { checkLexicons } from "./lexicon.js";
export type { SpeechOptions } from "./options.js";
export { type Pronounced, pronounce } from "./pronounce.js";
export { buildSpeechRequest } from "./reading.js";
export { applyReadingType } from "./reading-type.js";
export { checkSpeechRequest } from "./request.js";
export { checkSpeechSettings } from "./settings.js";
export { plainText, speakDocument, ssmlElement, xmlSafe } from "./ssml.js";
export { echoTyping } from "./typing-echo.js";
