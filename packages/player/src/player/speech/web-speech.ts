import { AssesskitError } from "@assesskit/runtime/errors";
import { checkSpeechRequest, type SpeechHook } from "./request.js";

/**
 * The words per minute that PNP takes as the speaking rate when none is set.
 *
 * @remarks
 * The rate 1 of Web Speech is the voice's own.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, speech rate}
 */
const DEFAULT_WORDS_PER_MINUTE = 180;

/**
 * The range of `SpeechSynthesisUtterance.rate`.
 *
 * @see {@link https://webaudio.github.io/web-speech-api/#dom-speechsynthesisutterance-rate | Web Speech API, rate}
 */
const MIN_RATE = 0.1;
const MAX_RATE = 10;

/**
 * The pitch of the Web Speech API runs from 0 to 2, and PNP's from 0 to 1 with 0.5 as the default, so the scale is 2.
 *
 * @see {@link https://webaudio.github.io/web-speech-api/#dom-speechsynthesisutterance-pitch | Web Speech API, pitch}
 */
const PITCH_SCALE = 2;

/**
 * The errors of an utterance that a stop causes: not failures.
 *
 * @see {@link https://webaudio.github.io/web-speech-api/#speechsynthesiserrorevent | Web Speech API, error events}
 */
const STOPPED = ["canceled", "interrupted"];

/**
 * Creates the voice that the browser has, the Web Speech API.
 *
 * @remarks
 * It speaks `request.text`, in which the `alias` of each `sub` and each lexicon alias stands in for the text it replaces,
 * because a Web Speech voice ignores SSML: phonemes, prosody, breaks and a different voice for links are lost, and a
 * host's text-to-speech that takes SSML keeps them. It maps the rate in words per minute to the voice's rate by 180 words
 * per minute as 1, the pitch by 2, and takes the volume as it is; a field the request lacks stays the voice's own.
 *
 * @returns A hook whose `speak` rejects with `DataError` for a request that is not one, and with `AssesskitError` when
 * the voice fails.
 */
export function webSpeech(): SpeechHook {
  return {
    speak: async (request) => {
      checkSpeechRequest(request);
      await new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(request.text);
        utterance.lang = request.lang;
        if (request.rate !== undefined) {
          utterance.rate = Math.min(MAX_RATE, Math.max(MIN_RATE, request.rate / DEFAULT_WORDS_PER_MINUTE));
        }
        if (request.pitch !== undefined) utterance.pitch = request.pitch * PITCH_SCALE;
        if (request.volume !== undefined) utterance.volume = request.volume;
        utterance.onend = () => resolve();
        utterance.onerror = (event) =>
          STOPPED.includes(event.error) ? resolve() : reject(new AssesskitError(`The voice failed: ${event.error}.`));
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      });
    },
    stop: () => window.speechSynthesis.cancel(),
  };
}
