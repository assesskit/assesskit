import { SaxesParser, type SaxesTagNS } from "saxes";
import { NC_NAME_RE } from "xmlchars/xmlns/1.0/ed3.js";
import { checkOptions, checkString, describe } from "../checks.js";
import { AssesskitError, DataError, type ReadError, SecurityError } from "../errors.js";
import { decodeXml } from "./encoding.js";
import { resolveXmlLimits, type XmlLimits } from "./limits.js";
import { Locator } from "./locator.js";
import { documentName, readError } from "./read-error.js";
import { XMLNS_NAMESPACE, type XmlAttribute, type XmlElement, type XmlNode } from "./tree.js";

/** Options of {@link parseXml}. */
export interface ParseXmlOptions {
  /** The path of the document in its package or directory; errors and issues name the document by it. */
  readonly path?: string;
  /** Limits that replace the defaults, field by field. Default: {@link DEFAULT_XML_LIMITS}. */
  readonly limits?: Partial<XmlLimits>;
}

/** The rule for well-formed documents (XML 1.0 §2.1). */
const WELL_FORMED = "XML 1.0 §2.1";
/** The rule for the XML declaration (XML 1.0 §2.8). */
const XML_DECLARATION = "XML 1.0 §2.8";
/** The rule for the characters of a document (XML 1.0 §2.2). */
const CHARACTERS = "XML 1.0 §2.2";
/** The rule for qualified names (Namespaces in XML 1.0 §3). */
const QUALIFIED_NAMES = "Namespaces in XML 1.0 §3";
/** The rule for the names of namespaces (Namespaces in XML 1.0 §2.2, which makes them URI references). */
const NAMESPACE_NAMES = "Namespaces in XML 1.0 §2.2";
/** A surrogate that is not half of a pair, which is no character, so that no text that has one is a document. */
const LONE_SURROGATE = /\p{Cs}/u;

/** An element that is still open: its tag, the children so far and the text not yet made a node. */
interface Frame {
  readonly head: Omit<XmlElement, "children">;
  readonly children: XmlNode[];
  text: string;
}

function toAttribute({ uri: namespace, local: name, prefix, value }: SaxesTagNS["attributes"][string]): XmlAttribute {
  return prefix === "" ? { namespace, name, value } : { namespace, name, prefix, value };
}

/** Builds the tree from the events of the parser, and enforces the limits as the tree grows. */
class TreeBuilder {
  private readonly frames: Frame[] = [];
  private readonly limits: XmlLimits;
  private readonly path: string | undefined;
  private readonly name: string;
  private nodes = 0;
  private result: XmlElement | undefined;

  constructor(limits: XmlLimits, path: string | undefined) {
    this.limits = limits;
    this.path = path;
    this.name = documentName(path);
  }

  /** The root element, once it is closed. */
  get root(): XmlElement {
    if (this.result === undefined) {
      throw readError("assesskit/xml/not-well-formed", `${this.name} has no root element.`, WELL_FORMED);
    }
    return this.result;
  }

  private exceeded(limit: keyof XmlLimits, what: string): SecurityError {
    const value = this.limits[limit];
    return new SecurityError(`${this.name} ${what} the limit ${limit} of ${value}.`, limit, value);
  }

  private count(): void {
    if (++this.nodes > this.limits.maxNodes) throw this.exceeded("maxNodes", "has more nodes than");
  }

  private add(node: XmlNode): void {
    this.count();
    this.frames.at(-1)?.children.push(node);
  }

  private flush(): void {
    const frame = this.frames.at(-1);
    if (frame === undefined || frame.text === "") return;
    this.add({ kind: "text", value: frame.text });
    frame.text = "";
  }

  /**
   * Checks that the prefix and the local part of each name of the tag are names without a colon, which the parser does
   * not: it takes `p:1` for a qualified name, and a tree with it cannot be written.
   */
  private checkNames(
    tag: SaxesTagNS,
    attributes: readonly SaxesTagNS["attributes"][string][],
    line: number,
    column: number,
  ): void {
    const unqualified = [tag, ...attributes].find(
      ({ prefix, local }) => !NC_NAME_RE.test(local) || (prefix !== "" && !NC_NAME_RE.test(prefix)),
    );
    if (unqualified === undefined) return;
    const written = unqualified.prefix === "" ? unqualified.local : `${unqualified.prefix}:${unqualified.local}`;
    const message = `${this.name} has the name ${JSON.stringify(written)}, which is not a qualified name: the parts around its colon must be names without a colon.`;
    throw readError("assesskit/xml/not-well-formed", message, QUALIFIED_NAMES, { path: this.path, line, column });
  }

  /**
   * Checks that no namespace declaration has white space at its start or end. The parser strips it from the namespace of
   * the elements and keeps it in the declaration, so that the two would differ.
   */
  private checkNamespaces(attributes: readonly SaxesTagNS["attributes"][string][], line: number, column: number): void {
    const padded = attributes.find(({ uri, value }) => uri === XMLNS_NAMESPACE && value !== value.trim());
    if (padded === undefined) return;
    const declaration = padded.prefix === "" ? padded.local : `${padded.prefix}:${padded.local}`;
    const message = `${this.name} declares the namespace ${JSON.stringify(padded.value)} in ${declaration}, which has white space at its start or end; a namespace name is a URI reference and has none.`;
    throw readError("assesskit/xml/namespace", message, NAMESPACE_NAMES, { path: this.path, line, column });
  }

  /** Opens an element at the position of its start tag. */
  open(tag: SaxesTagNS, line: number, column: number): void {
    this.flush();
    if (this.frames.length >= this.limits.maxDepth) throw this.exceeded("maxDepth", "nests elements deeper than");
    const attributes = Object.values(tag.attributes);
    if (attributes.length > this.limits.maxAttributes) {
      throw this.exceeded("maxAttributes", "has an element with more attributes than");
    }
    this.checkNames(tag, attributes, line, column);
    this.checkNamespaces(attributes, line, column);
    this.count();
    const head: Frame["head"] = {
      kind: "element",
      namespace: tag.uri,
      name: tag.local,
      ...(tag.prefix === "" ? {} : { prefix: tag.prefix }),
      attributes: attributes.map(toAttribute),
      line,
      column,
    };
    this.frames.push({ head, children: [], text: "" });
  }

  /** Appends characters to the open element; characters outside the root are white space that the tree leaves out. */
  text(value: string): void {
    const frame = this.frames.at(-1);
    if (frame !== undefined) frame.text += value;
  }

  /** Appends a CDATA section, comment or processing instruction to the open element. */
  node(node: XmlNode): void {
    if (this.frames.length === 0) return;
    this.flush();
    this.add(node);
  }

  /** Closes the open element and appends it to its parent, or makes it the root. */
  close(): void {
    this.flush();
    const frame = this.frames.pop();
    if (frame === undefined) return;
    const element: XmlElement = { ...frame.head, children: frame.children };
    const parent = this.frames.at(-1);
    if (parent === undefined) this.result = element;
    else parent.children.push(element);
  }
}

/** Returns whether the UTF-8 encoding of a string has more bytes than a limit; a string has at least as many bytes as it has UTF-16 code units. */
function exceedsBytes(text: string, limit: number): boolean {
  return text.length > limit || new TextEncoder().encode(text).byteLength > limit;
}

/** The position that a parser has reached: the line from 1 and the column of the character it read last. */
interface Position {
  readonly line: number;
  readonly column: number;
}

/** Turns an error of the parser into a `ReadError` at the position the parser had reached. */
function notWellFormed(error: Error, parser: Position, path: string | undefined): ReadError {
  const prefix = `${parser.line}:${parser.column}: `;
  const reason = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
  const message = `${documentName(path)} is not well-formed: ${reason}${reason.endsWith(".") ? "" : "."}`;
  return readError("assesskit/xml/not-well-formed", message, WELL_FORMED, {
    path,
    line: parser.line,
    column: Math.max(1, parser.column),
  });
}

/** Feeds the text to a parser whose events build the tree, and returns the root. */
function parseText(text: string, limits: XmlLimits, path: string | undefined): XmlElement {
  const name = documentName(path);
  const builder = new TreeBuilder(limits, path);
  const parser = new SaxesParser({ xmlns: true, position: true });
  const locator = new Locator(text);
  // The parser takes a high surrogate for half of a pair without looking at what follows it.
  const lone = text.search(LONE_SURROGATE);
  if (lone >= 0) {
    const code = (text.codePointAt(lone) ?? 0).toString(16).toUpperCase();
    const message = `${name} is not well-formed: it has the lone surrogate U+${code}, which is not a character.`;
    throw readError("assesskit/xml/not-well-formed", message, CHARACTERS, { path, ...locator.at(lone) });
  }
  let start = { line: 1, column: 1 };
  parser.on("xmldecl", ({ version }) => {
    if (version !== "1.0") {
      const message = `${name} declares XML version ${describe(version)}, but the runtime reads XML 1.0.`;
      throw readError("assesskit/xml/version", message, XML_DECLARATION, {
        path,
        line: parser.line,
        column: parser.column,
      });
    }
  });
  // A DOCTYPE can declare entities that expand without bound or read files (BPIG §6.7).
  parser.on("doctype", () => {
    const message = `${name} has a DOCTYPE declaration, which the runtime rejects so that no entity is declared or read.`;
    throw new SecurityError(message, "doctype", 0);
  });
  // The parser reports a start tag after the name and the character that follows it, which may be a line end; the
  // tag starts at the nearest "<" before that character.
  parser.on("opentagstart", () => {
    start = locator.at(text.lastIndexOf("<", parser.position - 1));
  });
  parser.on("opentag", (tag) => builder.open(tag, start.line, start.column));
  parser.on("closetag", () => builder.close());
  parser.on("text", (value) => builder.text(value));
  parser.on("cdata", (value) => builder.node({ kind: "cdata", value }));
  parser.on("comment", (value) => builder.node({ kind: "comment", value }));
  parser.on("processinginstruction", ({ target, body }) => builder.node({ kind: "instruction", target, data: body }));
  try {
    parser.write(text).close();
  } catch (error) {
    if (error instanceof AssesskitError || !(error instanceof Error)) throw error;
    throw notWellFormed(error, parser, path);
  }
  return builder.root;
}

/**
 * Parses an XML document into an immutable tree.
 *
 * Bytes are decoded by the rules of XML 1.0 §4.3.3: a UTF-8 or UTF-16 byte order mark decides; otherwise the declared
 * encoding is used when `TextDecoder` supports it, and UTF-8 when there is no declaration. A string is taken as it is.
 * Only the five predefined entities and character references exist. The tree keeps every element, text, CDATA section,
 * comment and processing instruction inside the root, with namespace declarations as attributes; it leaves out the
 * XML declaration and what precedes and follows the root.
 *
 * @param input - The document as text or bytes.
 * @param options - See {@link ParseXmlOptions}.
 * @returns The root element.
 * @throws `DataError` when an argument has the wrong type or a limit is not a positive integer.
 * @throws `ReadError` when the document is not well-formed, has a lone surrogate, a namespace declaration with white
 * space at its start or end, or a qualified name whose parts are not names without a colon, declares XML 1.1, or is in
 * an unsupported or contradicting encoding.
 * @throws `SecurityError` when the document has a DOCTYPE or exceeds `maxBytes`, `maxDepth`, `maxAttributes` or `maxNodes`.
 */
export function parseXml(input: string | Uint8Array, options: ParseXmlOptions = {}): XmlElement {
  checkOptions(options);
  const { path, limits = {} } = options;
  if (path !== undefined) checkString(path, "The option path");
  if (!(typeof input === "string" || input instanceof Uint8Array)) {
    throw new DataError(`The XML input must be a string or a Uint8Array, found ${describe(input)}.`);
  }
  const resolved = resolveXmlLimits(limits);
  const { maxBytes } = resolved;
  if (typeof input === "string" ? exceedsBytes(input, maxBytes) : input.byteLength > maxBytes) {
    throw new SecurityError(
      `${documentName(path)} is larger than the limit maxBytes of ${maxBytes}.`,
      "maxBytes",
      maxBytes,
    );
  }
  return parseText(typeof input === "string" ? input : decodeXml(input, path), resolved, path);
}
