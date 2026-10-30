/** The namespace of the `xml` prefix, which every document has bound (Namespaces in XML 1.0 §3). */
export const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

/** The namespace of the `xmlns` attributes that declare namespaces (Namespaces in XML 1.0 §3). */
export const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

/** The namespace of the attributes that schema-validated documents use, such as `xsi:schemaLocation` (XML Schema Part 1, 2.6). */
export const XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";

/** The namespace of XInclude (XInclude 1.0 §2). */
export const XINCLUDE_NAMESPACE = "http://www.w3.org/2001/XInclude";

/**
 * An attribute. Namespace declarations are attributes too: `xmlns="u"` has the namespace {@link XMLNS_NAMESPACE}, the
 * name `xmlns` and no prefix, and `xmlns:p="u"` has the name `p` and the prefix `xmlns`.
 */
export interface XmlAttribute {
  /** The namespace URI; the empty string for an attribute without a prefix. */
  readonly namespace: string;
  /** The local name. */
  readonly name: string;
  /** The prefix as written; absent when there is none. */
  readonly prefix?: string;
  /** The value, with entity and character references replaced and line ends and white space as the parser normalized them. */
  readonly value: string;
}

/** An element. */
export interface XmlElement {
  /** Tells an element from the other nodes. */
  readonly kind: "element";
  /** The namespace URI; the empty string for an element in no namespace. */
  readonly namespace: string;
  /** The local name. */
  readonly name: string;
  /** The prefix as written; absent when there is none. */
  readonly prefix?: string;
  /** The attributes in document order, including the namespace declarations. */
  readonly attributes: readonly XmlAttribute[];
  /** The child nodes in document order. */
  readonly children: readonly XmlNode[];
  /** The line of the start tag, from 1; set by {@link parseXml}. */
  readonly line?: number;
  /** The column of the start tag, from 1; set by {@link parseXml}. */
  readonly column?: number;
}

/** Text, a CDATA section or a comment. */
export interface XmlCharacterData {
  /** Tells the three apart from each other and from the other nodes. */
  readonly kind: "text" | "cdata" | "comment";
  /** The characters. */
  readonly value: string;
}

/** A processing instruction. */
export interface XmlInstruction {
  /** Tells a processing instruction from the other nodes. */
  readonly kind: "instruction";
  /** The target. */
  readonly target: string;
  /** The data after the target and the white space that follows it. */
  readonly data: string;
}

/** A node of the tree: an element, text, a CDATA section, a comment or a processing instruction. */
export type XmlNode = XmlElement | XmlCharacterData | XmlInstruction;
