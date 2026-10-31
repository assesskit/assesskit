import { DataError } from "@assesskit/runtime/errors";
import { checkNonEmptyString, checkRecord, describe } from "../../checks.js";
import { languageOf } from "./language.js";
import { checkLexicons } from "./lexicon.js";
import type { SpeechOptions } from "./options.js";
import { Reader } from "./reader.js";
import type { SpeechRequest } from "./request.js";
import { checkSpeechSettings, restrictionsOf } from "./settings.js";
import { plainText, speakDocument } from "./ssml.js";

/**
 * Builds the request that reads the content of a range aloud, in reading order.
 *
 * @remarks
 * Content is left out when it is hidden (`hidden`, `aria-hidden="true"`, `qti-hidden`, or `display: none`), when
 * `data-qti-suppress-tts` is `computer-read-aloud` or `all`, when its `data-qti-a11y-content-role` is
 * `screen-reader-orientation`, and as the restriction types of the support say. `qti-visually-hidden` content is read,
 * because it is there for assistive technology. The reading uses the SSML elements of the content, the functions of
 * `data-ssml`, the pronunciations of the lexicons, the `alt` of images, the value of text fields, and expressions by their
 * speech or text alternative.
 *
 * @param range - The content to read, such as a content root, a paragraph, a selection or a word.
 * @param options - See {@link SpeechOptions}.
 * @returns The request, or `undefined` when there is nothing to say: no content, or only content that is left out. It is
 * also `undefined` for a candidate whose reading type is `screen-reader` (the default), who reads the page with the screen
 * reader, and for `word-by-word` when the range holds more than one word.
 * @throws `DataError` when `range` is not a range or an option is not valid.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, text to speech}
 */
export function buildSpeechRequest(range: Range, options: SpeechOptions): SpeechRequest | undefined {
  if (!(range instanceof Range)) throw new DataError(`The range must be a Range, found ${describe(range)}.`);
  checkRecord(options, "The options must be an object");
  checkSpeechSettings(options.settings);
  checkRecord(options.messages, "The option messages must be an object");
  checkNonEmptyString(options.messages.speechLink, "The message speechLink");
  checkNonEmptyString(options.language, "The option language");
  if (options.lexicons !== undefined) checkLexicons(options.lexicons);
  const { settings, language } = options;
  if ((settings.readingType ?? "screen-reader") !== "computer-read-aloud") return undefined;
  const reader = new Reader(range, options);
  const paragraphs = reader.read();
  if (paragraphs === undefined) return undefined;
  const text = plainText(paragraphs);
  if (text === "" || (restrictionsOf(settings).has("word-by-word") && reader.words > 1)) return undefined;
  const lang = reader.language ?? languageOf(range.commonAncestorContainer) ?? language;
  return {
    ssml: speakDocument(paragraphs, lang),
    text,
    lang,
    ...(settings.speechRate === undefined ? {} : { rate: settings.speechRate }),
    ...(settings.pitch === undefined ? {} : { pitch: settings.pitch }),
    ...(settings.volume === undefined ? {} : { volume: settings.volume }),
  };
}
