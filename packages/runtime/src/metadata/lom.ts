import { attributeOf, childElements, textOf, XML_NAMESPACE, type XmlElement } from "../xml/index.js";
import { LOM_NAMESPACE } from "./namespaces.js";

/** A string of a LOM `LangString`, with the language it is in. */
export interface LomString {
  /** The language, from the attribute `language` or `xml:lang`; absent when the string has none. */
  readonly language?: string;
  /** The text. */
  readonly text: string;
}

/** The parts of the LOM category `general` that the runtime types. */
export interface LomGeneral {
  /** The `entry` of each `identifier` in document order; an identifier without an entry is left out. */
  readonly identifiers: readonly string[];
  /** The strings of `title`. */
  readonly titles: readonly LomString[];
}

function lomChildren(parent: XmlElement, name: string): readonly XmlElement[] {
  return childElements(parent).filter((child) => child.namespace === LOM_NAMESPACE && child.name === name);
}

/**
 * Returns the identifiers and the title of the category `general` of a `lom` element. The rest of the LOM stays in the
 * element: the runtime types no other part of it.
 *
 * @param lom - A `lom` element in the LOM namespace.
 * @returns Empty lists when the element has no `general`.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/md-bind/ | QTI 3.0 Metadata Binding}
 */
export function lomGeneral(lom: XmlElement): LomGeneral {
  const [general] = lomChildren(lom, "general");
  if (general === undefined) return { identifiers: [], titles: [] };
  const [title] = lomChildren(general, "title");
  return {
    identifiers: lomChildren(general, "identifier").flatMap((identifier) =>
      lomChildren(identifier, "entry").map(textOf),
    ),
    titles: (title === undefined ? [] : lomChildren(title, "string")).map((string) => ({
      language: attributeOf(string, "language") ?? attributeOf(string, "lang", XML_NAMESPACE),
      text: textOf(string),
    })),
  };
}
