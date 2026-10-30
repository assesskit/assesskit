import type { TypingEcho } from "@luthfanwakan/olah/pnp";
import { PNP_TYPING_ECHOES } from "@luthfanwakan/olah/pnp";
import { checkFunction, checkNonEmptyString, checkRecord } from "../../checks.js";
import { DataError } from "../../errors.js";
import type { Messages } from "../../messages/index.js";
import { checkTerm } from "./checks.js";
import { languageOf } from "./language.js";
import type { SpeechHook, SpeechRequest } from "./request.js";
import { speakDocument, ssmlElement } from "./ssml.js";

/** The end of a text when it ends with a word: letters, marks and numbers. */
const WORD_END = /[\p{L}\p{M}\p{N}]+$/u;

/** A character that is part of a word. */
const WORD_CHARACTER = /^[\p{L}\p{M}\p{N}]$/u;

/** The options of {@link echoTyping}. */
export interface TypingEchoOptions {
  /** The voice that speaks. */
  readonly hook: SpeechHook;
  /** What is repeated while the candidate types (BPIG §5.2.1.3). */
  readonly echo: TypingEcho;
  /** The text of the interface: the word for a space. */
  readonly messages: Pick<Messages, "typingSpace">;
  /** The language of the field when it and its ancestors state none, a BCP 47 tag. */
  readonly language: string;
}

/** Makes the request that says a character, spelled out in SSML, or a word. */
function requestFor(text: string, language: string, character: boolean): SpeechRequest {
  const content = character ? ssmlElement("say-as", { "interpret-as": "characters" }, [text]) : text;
  return { ssml: speakDocument([ssmlElement("p", {}, [content])], language), text, lang: language };
}

/** Returns the word that a typed character ended, or `undefined` when it ended none. */
function endedWord(field: HTMLInputElement | HTMLTextAreaElement, typed: string): string | undefined {
  if (WORD_CHARACTER.test(typed)) return undefined;
  const caret = field.selectionStart ?? field.value.length;
  return WORD_END.exec(field.value.slice(0, Math.max(0, caret - typed.length)))?.[0];
}

/** What the echo says for a typed character: a word, or the character, which SSML spells out. */
interface Echoed {
  readonly text: string;
  readonly character: boolean;
}

/** Decides what the echo says: the word that the character ended, else the character, else nothing. */
function echoed(echo: TypingEcho, typed: string, word: string | undefined, space: string): Echoed | undefined {
  if (echo === "none") return undefined;
  if (word !== undefined && echo !== "characters") return { text: word, character: false };
  if (echo === "words") return undefined;
  return typed === " " ? { text: space, character: false } : { text: typed, character: true };
}

/**
 * Repeats what the candidate types in a text field, as the typing echo of the support says (BPIG §5.2.1.3). `characters`
 * says each character as it is typed, with the word for a space. `words` says each word when a character that is not
 * part of a word ends it. `characters-and-words` says each character, and the word instead of the character that ends
 * it. `none` says nothing. Only typed characters are echoed, not deleted or pasted text, and not a prediction that the
 * keyboard inserts as several characters.
 *
 * @param field - A text input or a text area.
 * @returns A function that stops the echo.
 * @throws `DataError` when the field is not a text input or a text area, or an option is not valid.
 */
export function echoTyping(field: HTMLInputElement | HTMLTextAreaElement, options: TypingEchoOptions): () => void {
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
    throw new DataError("The field must be an input or a textarea.");
  }
  checkRecord(options, "The options must be an object");
  checkRecord(options.hook, "The option hook must be an object");
  checkFunction(options.hook.speak, "The method speak of the option hook must be a function");
  checkTerm(options.echo, PNP_TYPING_ECHOES, "The option echo");
  checkRecord(options.messages, "The option messages must be an object");
  checkNonEmptyString(options.messages.typingSpace, "The message typingSpace");
  checkNonEmptyString(options.language, "The option language");
  const { hook, echo, messages, language } = options;
  const lang = languageOf(field) ?? language;
  // A voice that fails must not get in the way of typing, so the promise of a request is not awaited.
  const say = (request: SpeechRequest): void => void hook.speak(request).catch(() => undefined);

  const onInput = (event: Event): void => {
    if (!(event instanceof InputEvent) || event.inputType !== "insertText" || event.data === null) return;
    // A prediction or an autocompletion inserts several characters at once, which the candidate did not type.
    if (Array.from(event.data).length !== 1) return;
    const said = echoed(echo, event.data, endedWord(field, event.data), messages.typingSpace);
    if (said !== undefined) say(requestFor(said.text, lang, said.character));
  };
  field.addEventListener("input", onInput);
  return () => field.removeEventListener("input", onInput);
}
