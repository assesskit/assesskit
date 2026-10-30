import type { SupportView } from "@luthfanwakan/olah/delivery";
import type { ReadingType, TypingEcho } from "@luthfanwakan/olah/pnp";
import {
  checkArray,
  checkFunction,
  checkNonEmptyString,
  checkProperties,
  checkRecord,
  describe,
} from "../../checks.js";
import { DataError } from "../../errors.js";
import type { Messages } from "../../messages/index.js";
import { checkMessages } from "../content/options.js";
import { html } from "../dom.js";
import type { ContentRoot } from "../roots/index.js";
import {
  applyReadingType,
  buildSpeechRequest,
  echoTyping,
  type Lexicon,
  type SpeechHook,
  type SpeechRequest,
  type SpeechSettings,
} from "../speech/index.js";
import { checkLexicons } from "../speech/lexicon.js";
import { checkSpeechSettings } from "../speech/settings.js";
import { activeSupport, checkSupportViews } from "./check.js";
import { adoptSupportStyles } from "./styles.js";

/** The options of {@link mountSpoken}. */
export interface SpokenOptions {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of content that states none, a BCP 47 tag. */
  readonly language: string;
  /** The voice that reads: the host's text-to-speech, or `webSpeech()`. */
  readonly voice: SpeechHook;
  /** The pronunciation lexicons of the item, in order of preference; `setLexicons` replaces them. Default: none. */
  readonly lexicons?: readonly Lexicon[];
}

/** The reading aloud of a content root. */
export interface Spoken {
  /**
   * Applies the spoken support to the content the root shows now, in place of what an earlier call applied. Call it
   * after `show` of the root resolves, and again when the supports change.
   *
   * For the reading type `screen-reader`, which is also the default, the content leaves the accessible structure where
   * `data-qti-suppress-tts` asks, and the candidate's screen reader reads the page. For `computer-read-aloud` it also
   * shows the controls that read the content with the voice and echoes what the candidate types, as the support asks.
   *
   * @throws `DataError` when `supports` is not a list of olah's `SupportView`s.
   */
  update(supports: readonly SupportView[]): void;
  /**
   * Replaces the pronunciation lexicons that the next reading uses, in order of preference, such as those of the next item.
   *
   * @throws `DataError` when `lexicons` is not a list of lexicons that `parseLexicon` made.
   */
  setLexicons(lexicons: readonly Lexicon[]): void;
  /** Stops the voice and takes the controls and the echo away. */
  destroy(): void;
}

/** The fields whose typing the voice echoes. */
const TEXT_FIELDS =
  'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="tel"], input[type="url"], input[type="email"]';

/** A word that the voice reads: its range and the request that reads it. */
interface Word {
  readonly range: Range;
  readonly request: SpeechRequest;
}

/** Returns the words of the content in reading order that the voice reads: runs of characters that are not white space. */
function readableWords(content: Node, read: (range: Range) => SpeechRequest | undefined): Word[] {
  const words: Word[] = [];
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    for (const match of node.data.matchAll(/\S+/gu)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const request = read(range);
      if (request !== undefined) words.push({ range, request });
    }
  }
  return words;
}

/**
 * Reads the spoken support of the list: its settings with the reading type, which is `screen-reader` when the support
 * names none (BPIG §5.2.1.1), or `undefined` when the support is off.
 *
 * @throws `DataError` when the settings are out of the range of reading aloud, such as a pitch above 1.
 */
function spokenOf(
  supports: readonly SupportView[],
): (SpeechSettings & { readonly readingType: ReadingType }) | undefined {
  checkSupportViews(supports, "The list of supports");
  const support = activeSupport(supports, "spoken");
  if (support === undefined) return undefined;
  const given = support.settings?.name === "spoken" ? support.settings : undefined;
  const settings = { ...given, readingType: given?.readingType ?? "screen-reader" };
  checkSpeechSettings(settings);
  return settings;
}

function checkSpokenOptions(host: unknown, root: unknown, options: unknown): asserts options is SpokenOptions {
  if (!(host instanceof HTMLElement && host.isConnected)) {
    throw new DataError(`The host must be an element in a document, found ${describe(host)}.`);
  }
  checkRecord(root, "The content root must be an object");
  if (!(root.root instanceof ShadowRoot)) {
    throw new DataError(`The root of the content root must be a shadow root, found ${describe(root.root)}.`);
  }
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", ["messages", "language", "voice", "lexicons"]);
  checkMessages(options.messages);
  checkNonEmptyString(options.language, "The option language");
  checkRecord(options.voice, "The option voice must be an object");
  checkFunction(options.voice.speak, "The method speak of the option voice must be a function");
  checkFunction(options.voice.stop, "The method stop of the option voice must be a function");
  if (options.lexicons !== undefined) checkArray(options.lexicons, "The option lexicons must be an array");
}

/**
 * Mounts the reading aloud of a content root (tempuh design §2.7, BPIG §5.2.1). The controls go into `host`: a button that
 * reads the content, one that stops the voice, and, when the restriction type is `word-by-word`, buttons that read the
 * word before and the word after the one read last. The candidate chooses the word with them, because a selection inside
 * a shadow root cannot be read in every browser.
 *
 * @param host - The element that gets the controls, in a document or a shadow root.
 * @param root - The content root whose content is read.
 * @param options - See {@link SpokenOptions}.
 * @throws `DataError` when `host`, `root` or an option is not valid.
 */
export function mountSpoken(host: HTMLElement, root: ContentRoot, options: SpokenOptions): Spoken {
  checkSpokenOptions(host, root, options);
  const { messages, language, voice } = options;
  let lexicons = options.lexicons ?? [];
  const scope = root.root;
  const release = adoptSupportStyles(host);
  const status = html("output", { class: "tempuh-read-aloud-word" });
  const group = html("div", { class: "tempuh-read-aloud", role: "group", "aria-label": messages.supportSpoken });
  group.hidden = true;
  host.append(group);
  let settings: SpeechSettings = {};
  const echoes: (() => void)[] = [];
  let cursor = -1;
  let built: "none" | "whole" | "word" = "none";

  const content = (): Node => scope.querySelector(".tempuh-content") ?? scope;
  const read = (range: Range): SpeechRequest | undefined =>
    buildSpeechRequest(range, { settings, messages, language, lexicons });

  const say = async (request: SpeechRequest): Promise<void> => {
    try {
      await voice.speak(request);
    } catch (error) {
      status.textContent = messages.readAloudFailed;
      reportError(error);
    }
  };

  const readAll = (): void => {
    const range = document.createRange();
    range.selectNodeContents(content());
    const request = read(range);
    status.textContent = request === undefined ? messages.readAloudNothing : "";
    if (request !== undefined) void say(request);
  };

  const readWord = (step: -1 | 0 | 1): void => {
    const next = step === 0 ? Math.max(cursor, 0) : cursor + step;
    const word = readableWords(content(), read)[next];
    if (word === undefined) {
      status.textContent = messages.readAloudNothing;
      return;
    }
    cursor = next;
    status.textContent = word.range.toString();
    void say(word.request);
  };

  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const control = html("button", { type: "button", class: "tempuh-support-button" }, label);
    control.addEventListener("click", onClick);
    return control;
  };

  const build = (wordByWord: boolean): void => {
    const words = wordByWord
      ? [
          button(messages.readAloudPreviousWord, () => readWord(-1)),
          button(messages.readAloudNextWord, () => readWord(1)),
        ]
      : [];
    group.replaceChildren(
      button(messages.readAloud, wordByWord ? () => readWord(0) : readAll),
      ...words,
      button(messages.readAloudStop, () => voice.stop()),
      status,
    );
    built = wordByWord ? "word" : "whole";
  };

  const stopEchoes = (): void => {
    for (const stop of echoes.splice(0)) stop();
  };

  const clear = (): void => {
    stopEchoes();
    if (built !== "none") voice.stop();
    group.hidden = true;
    group.replaceChildren();
    status.textContent = "";
    cursor = -1;
    built = "none";
  };

  const echoTypedText = (echo: TypingEcho | undefined): void => {
    if (echo === undefined || echo === "none") return;
    for (const field of scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(TEXT_FIELDS)) {
      echoes.push(echoTyping(field, { hook: voice, echo, messages, language }));
    }
  };

  return {
    update(supports) {
      const spoken = spokenOf(supports);
      applyReadingType(scope, spoken?.readingType);
      stopEchoes();
      if (spoken?.readingType !== "computer-read-aloud") {
        clear();
        return;
      }
      settings = spoken;
      const wordByWord = (spoken.restrictionTypes ?? []).includes("word-by-word");
      if (built !== (wordByWord ? "word" : "whole")) {
        clear();
        build(wordByWord);
      }
      cursor = -1;
      group.hidden = false;
      echoTypedText(spoken.typingEcho);
    },
    setLexicons(next) {
      checkLexicons(next);
      lexicons = next;
    },
    destroy() {
      clear();
      applyReadingType(scope, undefined);
      group.remove();
      release();
    },
  };
}
