import type { Messages } from "../../messages/index.js";
import type { Lexicon } from "./lexicon.js";
import type { SpeechSettings } from "./settings.js";

/** The options of {@link buildSpeechRequest}. */
export interface SpeechOptions {
  /** What the candidate's spoken support asks for. */
  readonly settings: SpeechSettings;
  /** The text of the interface that a request speaks: the word that marks a link. */
  readonly messages: Pick<Messages, "speechLink">;
  /** The language of the content that states none, a BCP 47 tag. */
  readonly language: string;
  /**
   * The pronunciation lexicons of the item, in order of preference.
   *
   * @defaultValue `[]`
   */
  readonly lexicons?: readonly Lexicon[];
}
