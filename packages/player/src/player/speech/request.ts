import { checkNonEmptyString, checkRecord, checkString } from "@assesskit/runtime/checks";
import { checkSpeechRate, checkUnitInterval } from "./checks.js";

/**
 * What a voice says once: the content of a read-aloud request, in the forms that voices take.
 *
 * @remarks
 * A host's text-to-speech that takes SSML uses `ssml`; a voice that does not uses `text`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, speech rate, pitch and volume}
 */
export interface SpeechRequest {
  /**
   * The content as an SSML 1.1 document: the `speak` element in the language of the content, with the SSML and
   * `data-ssml` of the content, the pronunciations of the lexicons, and one `p` for each paragraph.
   */
  readonly ssml: string;
  /**
   * The same content as plain text for a voice that ignores SSML: the `alias` of each `sub` and each lexicon alias in
   * place of the text it replaces, and one line for each paragraph.
   *
   * @remarks
   * Phonemes, prosody and breaks are not in it.
   */
  readonly text: string;
  /** The language of the content, a BCP 47 tag. */
  readonly lang: string;
  /** The speaking rate in words per minute, when the candidate's support sets it; otherwise the voice's own. */
  readonly rate?: number;
  /** The pitch from 0 to 1, when the candidate's support sets it; otherwise the voice's own. */
  readonly pitch?: number;
  /** The volume from 0 to 1, when the candidate's support sets it; otherwise the voice's own. */
  readonly volume?: number;
}

/** The voice of the player: the host's text-to-speech, or the one the browser has ({@link createWebSpeech}). */
export interface SpeechHook {
  /**
   * Voices a request.
   *
   * @remarks
   * It stops what the voice is saying first.
   *
   * @param request - What to say.
   * @returns A promise that resolves when the request has been voiced or was stopped, and rejects when the voice fails.
   */
  speak(request: SpeechRequest): Promise<void>;
  /** Stops the voice. */
  stop(): void;
}

/**
 * Checks a request, as a host's voice gets it from the player or a test passes it from JavaScript or JSON.
 *
 * @param request - The value to check.
 * @throws `DataError` when a field is missing or has the wrong type or range.
 */
export function checkSpeechRequest(request: unknown): asserts request is SpeechRequest {
  checkRecord(request, "The speech request must be an object");
  const { ssml, text, lang, rate, pitch, volume } = request;
  checkString(ssml, "The ssml of a speech request");
  checkString(text, "The text of a speech request");
  checkNonEmptyString(lang, "The lang of a speech request");
  if (rate !== undefined) checkSpeechRate(rate, "The rate of a speech request");
  if (pitch !== undefined) checkUnitInterval(pitch, "The pitch of a speech request");
  if (volume !== undefined) checkUnitInterval(volume, "The volume of a speech request");
}
