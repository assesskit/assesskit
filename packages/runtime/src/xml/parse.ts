import { type EventNameToHandler, SaxesParser } from "saxes";
import { checkString, describe } from "../checks.js";
import { checkOptions } from "../checks-internal.js";
import { AssesskitError, DataError, type ReadError, SecurityError } from "../errors.js";
import { decodeXml } from "./encoding.js";
import { resolveXmlLimits, type XmlLimits } from "./limits.js";
import { Locator } from "./locator.js";
import { createReadError, documentName } from "./read-error.js";
import type { XmlElement } from "./tree.js";
import { TreeBuilder } from "./tree-builder.js";

/** Options of {@link parseXml}. */
export interface ParseXmlOptions {
  /**
   * The path of the document in its package or directory; errors and issues name the document by it.
   *
   * @defaultValue `undefined`, which names the document "The document"
   */
  readonly path?: string;
  /**
   * Limits that replace the defaults, field by field.
   *
   * @defaultValue `{}`, which keeps {@link DEFAULT_XML_LIMITS}
   */
  readonly limits?: Partial<XmlLimits>;
}

/** Returns whether the UTF-8 encoding of a string has more bytes than a limit; a string has at least as many bytes as UTF-16 code units. */
function exceedsBytes(text: string, limit: number): boolean {
  return text.length > limit || new TextEncoder().encode(text).byteLength > limit;
}

/** The position that a parser has reached: the line from 1 and the column of the character it read last. */
interface Position {
  readonly line: number;
  readonly column: number;
}

/** A surrogate that is not half of a pair, which is no character, so that no text that has one is a document. */
const LONE_SURROGATE = /\p{Cs}/u;

/** Turns an error of the parser into a `ReadError` at the position the parser had reached. */
function notWellFormed(error: Error, parser: Position, path: string | undefined): ReadError {
  const prefix = `${parser.line}:${parser.column}: `;
  const reason = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
  const message = `${documentName(path)} is not well-formed: ${reason}${reason.endsWith(".") ? "" : "."}`;
  return createReadError("assesskit/xml/not-well-formed", message, {
    location: {
      path,
      line: parser.line,
      column: Math.max(1, parser.column),
    },
  });
}

/** The options of the parser: names resolve to namespaces, and the parser tracks the line and column of its errors. */
const PARSER_OPTIONS = { xmlns: true, position: true } as const;

type Parser = SaxesParser<typeof PARSER_OPTIONS>;

/** The events that the tree is built from, each with its handler. */
type Handlers = {
  readonly [TEvent in
    | "xmldecl"
    | "doctype"
    | "opentagstart"
    | "opentag"
    | "closetag"
    | "text"
    | "cdata"
    | "comment"
    | "processinginstruction"]: EventNameToHandler<typeof PARSER_OPTIONS, TEvent>;
};

/**
 * Sets the handlers of a parser. `SaxesParser.on` stores a handler in a field whose name it computes, and from the seventh
 * on V8 keeps the fields of the parser in a dictionary, which makes parsing five times slower. Storing by the name of the
 * field keeps the parser as fast as it is with fewer handlers.
 */
function listen(parser: Parser, handlers: Handlers): void {
  // biome-ignore-start lint/complexity/useLiteralKeys: the fields of the handlers are private to the parser
  parser["xmldeclHandler"] = handlers.xmldecl;
  parser["doctypeHandler"] = handlers.doctype;
  parser["openTagStartHandler"] = handlers.opentagstart;
  parser["openTagHandler"] = handlers.opentag;
  parser["closeTagHandler"] = handlers.closetag;
  parser["textHandler"] = handlers.text;
  parser["cdataHandler"] = handlers.cdata;
  parser["commentHandler"] = handlers.comment;
  parser["piHandler"] = handlers.processinginstruction;
  // biome-ignore-end lint/complexity/useLiteralKeys: the fields of the handlers are private to the parser
}

/** Feeds the text to a parser whose events build the tree, and returns the root. */
function parseText(text: string, limits: XmlLimits, path: string | undefined): XmlElement {
  const name = documentName(path);
  const builder = new TreeBuilder(limits, path);
  const parser = new SaxesParser(PARSER_OPTIONS);
  const locator = new Locator(text);
  // The parser takes a high surrogate for half of a pair without looking at what follows it.
  const lone = text.search(LONE_SURROGATE);
  if (lone >= 0) {
    const code = (text.codePointAt(lone) ?? 0).toString(16).toUpperCase();
    const message = `${name} is not well-formed: it has the lone surrogate U+${code}, which is not a character.`;
    throw createReadError("assesskit/xml/not-well-formed", message, { location: { path, ...locator.at(lone) } });
  }
  let start = { line: 1, column: 1 };
  listen(parser, {
    xmldecl: ({ version }) => {
      if (version !== "1.0") {
        const message = `${name} declares XML version ${describe(version)}, but the runtime reads XML 1.0.`;
        throw createReadError("assesskit/xml/version", message, {
          location: {
            path,
            line: parser.line,
            column: parser.column,
          },
        });
      }
    },
    // A DOCTYPE can declare entities that expand without bound or read files.
    doctype: () => {
      const message = `${name} has a DOCTYPE declaration, which the runtime rejects so that no entity is declared or read.`;
      throw new SecurityError(message, "doctype", 0);
    },
    // The parser reports a start tag after the name and the character that follows it, which may be a line end; the
    // tag starts at the nearest "<" before that character.
    opentagstart: () => {
      start = locator.at(text.lastIndexOf("<", parser.position - 1));
    },
    opentag: (tag) => builder.open(tag, start.line, start.column),
    closetag: () => builder.close(),
    text: (value) => builder.text(value),
    cdata: (value) => builder.node({ kind: "cdata", value }),
    comment: (value) => builder.node({ kind: "comment", value }),
    processinginstruction: ({ target, body }) => builder.node({ kind: "instruction", target, data: body }),
  });
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
 * @remarks
 * Bytes are decoded by the rules of XML 1.0: a UTF-8 or UTF-16 byte order mark decides; otherwise the declared encoding
 * is used when `TextDecoder` supports it, and UTF-8 when there is no declaration. A string is taken as it is. Only the
 * five predefined entities and character references exist. The tree keeps every element, text, CDATA section, comment
 * and processing instruction inside the root, with namespace declarations as attributes; it leaves out the XML
 * declaration and what precedes and follows the root.
 *
 * @param input - The document as text or bytes.
 * @param options - See {@link ParseXmlOptions}.
 * @returns The root element.
 * @throws `DataError` when an argument has the wrong type or a limit is not a positive integer.
 * @throws `ReadError` when the document is not well-formed, has a lone surrogate, a namespace declaration with white
 * space at its start or end, or a qualified name whose parts are not names without a colon, declares XML 1.1, or is in
 * an unsupported or contradicting encoding.
 * @throws `SecurityError` when the document has a DOCTYPE or exceeds `maxBytes`, `maxDepth`, `maxAttributes` or `maxNodes`.
 * @see {@link https://www.w3.org/TR/xml/ | Extensible Markup Language (XML) 1.0}
 * @see {@link https://www.w3.org/TR/xml-names/ | Namespaces in XML 1.0}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, XML security}
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
