import type { Lexicon, Pronunciation } from "./lexicon.js";

/** A piece of text that a lexicon gave a pronunciation: the words as they are written, and how to say them. */
export interface Pronounced {
  /** The text as written. */
  readonly text: string;
  /** How to say it. */
  readonly pronunciation: Pronunciation;
}
/** Returns the primary subtag of a language tag, in lower case. */
const primaryLanguage = (tag: string): string => tag.split("-")[0]?.toLowerCase() ?? "";
/** Matches the punctuation around a word, which a lexicon entry may leave out. */
const OUTER_PUNCTUATION = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su;
/** A token of a text: a run of characters between white space. */
interface Token {
  readonly start: number;
  readonly end: number;
}
/** A stretch of the text that a lexicon pronounces, and how many tokens it covers. */
interface Match {
  readonly start: number;
  readonly end: number;
  readonly tokens: number;
  readonly pronounced: Pronounced;
}
function lookup(lexicons: readonly Lexicon[], words: string): Pronunciation | undefined {
  for (const { entries } of lexicons) {
    const pronunciation = entries.get(words);
    if (pronunciation !== undefined) return pronunciation;
  }
  return undefined;
}
/** Finds the longest sequence of tokens from `index` on that a lexicon has, as written or without the punctuation around it. */
function matchAt(
  text: string,
  tokens: readonly Token[],
  index: number,
  lexicons: readonly Lexicon[],
  longest: number,
): Match | undefined {
  const first = tokens[index];
  if (first === undefined) return undefined;
  for (let count = Math.min(longest, tokens.length - index); count >= 1; count--) {
    const end = tokens[index + count - 1]?.end ?? first.end;
    const [, before = "", , after = ""] = OUTER_PUNCTUATION.exec(text.slice(first.start, end)) ?? [];
    const spans = [
      { start: first.start, end },
      { start: first.start + before.length, end: end - after.length },
    ];
    for (const span of spans) {
      const words = text.slice(span.start, span.end);
      const pronunciation = words === "" ? undefined : lookup(lexicons, words);
      if (pronunciation !== undefined) return { ...span, tokens: count, pronounced: { text: words, pronunciation } };
    }
  }
  return undefined;
}
/**
 * Looks up the words of a text in lexicons and splits the text where an entry matches.
 *
 * @remarks
 * Matching follows the approach of the informative appendix of PLS 1.0: by whole tokens, longest sequence first, equal
 * characters (so case and accents count), and runs of white space as one space. A token is a run of characters between
 * white space, and an entry may leave out the punctuation around it. The first lexicon that has the words wins. Only
 * lexicons of the language of the text apply, by the primary subtag.
 *
 * @param text - Text with single spaces between the words.
 * @param language - The language of the text, a BCP 47 tag.
 * @param lexicons - The lexicons to look in, in order of preference.
 * @returns The text in pieces: strings left as they are, and the parts that a lexicon pronounces.
 * @see {@link https://www.w3.org/TR/pronunciation-lexicon/ | Pronunciation Lexicon Specification 1.0, matching}
 */
export function pronounce(
  text: string,
  language: string,
  lexicons: readonly Lexicon[],
): readonly (string | Pronounced)[] {
  const applicable = lexicons.filter((lexicon) => primaryLanguage(lexicon.language) === primaryLanguage(language));
  let longest = 0;
  for (const { entries } of applicable) {
    for (const words of entries.keys()) longest = Math.max(longest, words.split(" ").length);
  }
  if (longest === 0) return [text];
  const tokens = [...text.matchAll(/\S+/gu)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const pieces: (string | Pronounced)[] = [];
  let copied = 0;
  for (let index = 0; index < tokens.length; ) {
    const match = matchAt(text, tokens, index, applicable, longest);
    if (match === undefined) {
      index++;
      continue;
    }
    if (match.start > copied) pieces.push(text.slice(copied, match.start));
    pieces.push(match.pronounced);
    copied = match.end;
    index += match.tokens;
  }
  if (copied < text.length) pieces.push(text.slice(copied));
  return pieces;
}
