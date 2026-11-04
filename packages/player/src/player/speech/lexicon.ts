import { checkArray, checkNonEmptyString, checkRecord, describe } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import {
  collectText,
  findAttribute,
  listChildElements,
  parseXml,
  XML_NAMESPACE,
  type XmlElement,
} from "@assesskit/runtime/xml";

/**
 * The namespace of PLS.
 *
 * @see {@link https://www.w3.org/TR/pronunciation-lexicon/ | Pronunciation Lexicon Specification 1.0, the lexicon element}
 */
const PLS_NAMESPACE = "http://www.w3.org/2005/01/pronunciation-lexicon";

/**
 * How a word is said: by phonemes in an alphabet, or by other words.
 *
 * @see {@link https://www.w3.org/TR/pronunciation-lexicon/ | Pronunciation Lexicon Specification 1.0, phoneme and alias}
 */
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

/**
 * A pronunciation lexicon: the words of one language that it says how to pronounce.
 *
 * @see {@link https://www.w3.org/TR/pronunciation-lexicon/ | Pronunciation Lexicon Specification 1.0, the lexicon element}
 */
export interface Lexicon {
  /** The language the lexicon is relevant for, a BCP 47 tag (`xml:lang` of the `lexicon` element). */
  readonly language: string;
  /** The pronunciation of each grapheme, with runs of white space in the grapheme reduced to one space. */
  readonly entries: ReadonlyMap<string, Pronunciation>;
}

/**
 * A word and how its pronunciations are listed: the first with `prefer="true"`, else the first.
 *
 * @see {@link https://www.w3.org/TR/pronunciation-lexicon/ | Pronunciation Lexicon Specification 1.0, the phoneme and alias elements}
 */
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
  for (const child of listChildElements(lexeme)) {
    const preferred = findAttribute(child, "prefer") === "true";
    if (pls(child, "phoneme")) {
      const own = findAttribute(child, "alphabet") ?? alphabet;
      candidates.push({ pronunciation: { kind: "phoneme", alphabet: own, ph: collectText(child).trim() }, preferred });
    } else if (pls(child, "alias")) {
      candidates.push({ pronunciation: { kind: "alias", alias: collapse(collectText(child)) }, preferred });
    }
  }
  return candidates;
}

/** Checks the `lexicon` element and returns its default alphabet and its language. */
function readHeader(root: XmlElement): { readonly alphabet: string; readonly language: string } {
  if (!pls(root, "lexicon")) {
    throw new DataError(`A lexicon must have the root element lexicon in the namespace ${PLS_NAMESPACE}.`);
  }
  if (findAttribute(root, "version") !== "1.0") throw new DataError('A lexicon must have version "1.0".');
  const alphabet = findAttribute(root, "alphabet");
  const language = findAttribute(root, "lang", { namespace: XML_NAMESPACE });
  if (alphabet === undefined || language === undefined || language === "") {
    throw new DataError("A lexicon must have an alphabet and an xml:lang.");
  }
  return { alphabet, language };
}

/**
 * Reads a PLS 1.0 document.
 *
 * @remarks
 * A lexeme has its graphemes' pronunciations: the first in document order that has `prefer="true"`, else the first. A
 * grapheme in several lexemes takes them in document order together. A lexeme with a `role` is left out, because roles
 * select a pronunciation by the part of speech of the word and the player knows none.
 *
 * @param source - The document as text or bytes.
 * @returns The lexicon.
 * @throws `DataError` when the document is not a PLS 1.0 lexicon with an `alphabet` and an `xml:lang`, or `source` is not
 * text or bytes.
 * @throws `ReadError` when the document is not well-formed XML, and `SecurityError` when it exceeds a limit of the
 * runtime's XML reader.
 * @see {@link https://www.w3.org/TR/pronunciation-lexicon/ | Pronunciation Lexicon Specification 1.0}
 */
export function readLexicon(source: string | Uint8Array): Lexicon {
  const root = parseXml(source);
  const { alphabet, language } = readHeader(root);
  const candidates = new Map<string, Candidate[]>();
  for (const lexeme of listChildElements(root).filter((child) => pls(child, "lexeme"))) {
    if (findAttribute(lexeme, "role") !== undefined) continue;
    const found = readCandidates(lexeme, alphabet);
    for (const grapheme of listChildElements(lexeme).filter((child) => pls(child, "grapheme"))) {
      const key = collapse(collectText(grapheme));
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

/**
 * Checks the lexicons that a caller passes, as `readLexicon` makes them.
 *
 * @param lexicons - The value to check.
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
