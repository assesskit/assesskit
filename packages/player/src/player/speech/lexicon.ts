import { DataError } from "@assesskit/runtime/errors";
import { attributeOf, childElements, parseXml, textOf, XML_NAMESPACE, type XmlElement } from "@assesskit/runtime/xml";
import { checkArray, checkNonEmptyString, checkRecord, describe } from "../../checks.js";

/** The namespace of PLS (PLS 1.0 §4.1). */
const PLS_NAMESPACE = "http://www.w3.org/2005/01/pronunciation-lexicon";

/** How a word is said: by phonemes in an alphabet, or by other words (PLS 1.0 §4.6, §4.7). */
export type Pronunciation =
  /** The word is said as the phonemes `ph`, written in the `alphabet`. */
  | {
      /** Tells the two apart. */
      readonly kind: "phoneme";
      /** The alphabet of `ph`: the one of the `phoneme` element, else the default of the lexicon. */
      readonly alphabet: string;
      /** The phonemes. */
      readonly ph: string;
    }
  /** The word is said as the words `alias`. */
  | {
      /** Tells the two apart. */
      readonly kind: "alias";
      /** The words to say in its place. */
      readonly alias: string;
    };

/** A pronunciation lexicon: the words of one language that it says how to pronounce (PLS 1.0 §4). */
export interface Lexicon {
  /** The language the lexicon is relevant for, a BCP 47 tag (`xml:lang` of the `lexicon` element). */
  readonly language: string;
  /** The pronunciation of each grapheme, with runs of white space in the grapheme reduced to one space (PLS 1.0 Appendix C). */
  readonly entries: ReadonlyMap<string, Pronunciation>;
}

/** A piece of text that a lexicon gave a pronunciation: the words as they are written, and how to say them. */
export interface Pronounced {
  /** The text as written. */
  readonly text: string;
  /** How to say it. */
  readonly pronunciation: Pronunciation;
}

/** A word and how its pronunciations are listed: the first with `prefer="true"`, else the first (PLS 1.0 §4.9.2). */
interface Candidate {
  readonly pronunciation: Pronunciation;
  readonly preferred: boolean;
}

function pls(element: XmlElement, name: string): boolean {
  return element.namespace === PLS_NAMESPACE && element.name === name;
}

const collapse = (text: string): string => text.replace(/\s+/gu, " ").trim();

function readCandidates(lexeme: XmlElement, alphabet: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const child of childElements(lexeme)) {
    const preferred = attributeOf(child, "prefer") === "true";
    if (pls(child, "phoneme")) {
      const own = attributeOf(child, "alphabet") ?? alphabet;
      candidates.push({ pronunciation: { kind: "phoneme", alphabet: own, ph: textOf(child).trim() }, preferred });
    } else if (pls(child, "alias")) {
      candidates.push({ pronunciation: { kind: "alias", alias: collapse(textOf(child)) }, preferred });
    }
  }
  return candidates;
}

/** Checks the `lexicon` element and returns its default alphabet and its language (PLS 1.0 §4.1). */
function readHeader(root: XmlElement): { readonly alphabet: string; readonly language: string } {
  if (!pls(root, "lexicon")) {
    throw new DataError(`A lexicon must have the root element lexicon in the namespace ${PLS_NAMESPACE}.`);
  }
  if (attributeOf(root, "version") !== "1.0") throw new DataError('A lexicon must have version "1.0" (PLS 1.0 §4.1).');
  const alphabet = attributeOf(root, "alphabet");
  const language = attributeOf(root, "lang", XML_NAMESPACE);
  if (alphabet === undefined || language === undefined || language === "") {
    throw new DataError("A lexicon must have an alphabet and an xml:lang (PLS 1.0 §4.1).");
  }
  return { alphabet, language };
}

/**
 * Reads a PLS 1.0 document (PLS 1.0 §4). A lexeme has its graphemes' pronunciations: the first in document order that
 * has `prefer="true"`, else the first (PLS 1.0 §4.9.2). A grapheme in several lexemes takes them in document order
 * together. A lexeme with a `role` is left out, because roles select a pronunciation by the part of speech of the word
 * and the player knows none (PLS 1.0 §4.4).
 *
 * @param source - The document as text or bytes.
 * @throws `DataError` when the document is not a PLS 1.0 lexicon with an `alphabet` and an `xml:lang`, or `source` is
 * not text or bytes.
 * @throws `ReadError` when the document is not well-formed XML, and `SecurityError` when it exceeds a limit of the runtime's
 * XML reader.
 */
export function parseLexicon(source: string | Uint8Array): Lexicon {
  const root = parseXml(source);
  const { alphabet, language } = readHeader(root);
  const candidates = new Map<string, Candidate[]>();
  for (const lexeme of childElements(root).filter((child) => pls(child, "lexeme"))) {
    if (attributeOf(lexeme, "role") !== undefined) continue;
    const found = readCandidates(lexeme, alphabet);
    for (const grapheme of childElements(lexeme).filter((child) => pls(child, "grapheme"))) {
      const key = collapse(textOf(grapheme));
      if (key !== "") candidates.set(key, [...(candidates.get(key) ?? []), ...found]);
    }
  }
  const entries = new Map<string, Pronunciation>();
  for (const [grapheme, found] of candidates) {
    const chosen = found.find(({ preferred }) => preferred) ?? found[0];
    if (chosen !== undefined) entries.set(grapheme, chosen.pronunciation);
  }
  return { language, entries };
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
 * Looks up the words of a text in lexicons and splits the text where an entry matches. Matching follows the approach of PLS 1.0 Appendix C:
 * by whole tokens, longest sequence first, equal characters (so case and accents count), and runs of white space as one
 * space. A token is a run of characters between white space, and an entry may leave out the punctuation around it. The
 * first lexicon that has the words wins. Only lexicons of the language of the text apply, by the primary subtag.
 *
 * @param text - Text with single spaces between the words.
 * @param language - The language of the text, a BCP 47 tag.
 * @param lexicons - The lexicons to look in, in order of preference.
 * @returns The text in pieces: strings left as they are, and the parts that a lexicon pronounces.
 */
export function pronounce(
  text: string,
  language: string,
  lexicons: readonly Lexicon[],
): readonly (string | Pronounced)[] {
  const applicable = lexicons.filter((lexicon) => primaryLanguage(lexicon.language) === primaryLanguage(language));
  const longest = Math.max(
    0,
    ...applicable.flatMap(({ entries }) => [...entries.keys()].map((words) => words.split(" ").length)),
  );
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

/**
 * Checks the lexicons that a caller passes, as `parseLexicon` makes them.
 *
 * @throws `DataError` when they are not an array of lexicons.
 */
export function checkLexicons(lexicons: unknown): asserts lexicons is readonly Lexicon[] {
  checkArray(lexicons, "The option lexicons must be an array");
  for (const lexicon of lexicons) {
    checkRecord(lexicon, "A lexicon must be an object");
    checkNonEmptyString(lexicon.language, "The language of a lexicon");
    if (!(lexicon.entries instanceof Map)) {
      throw new DataError(`The entries of a lexicon must be a Map, found ${describe(lexicon.entries)}.`);
    }
  }
}
