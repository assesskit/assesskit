import type { SaxesTagNS } from "saxes";
import { NC_NAME_RE } from "xmlchars/xmlns/1.0/ed3.js";
import { SecurityError } from "../errors.js";
import type { XmlLimits } from "./limits.js";
import { documentName, readError } from "./read-error.js";
import { XMLNS_NAMESPACE, type XmlAttribute, type XmlElement, type XmlNode } from "./tree.js";

/** An element that is still open: its tag, the children so far and the text not yet made a node. */
interface Frame {
  readonly head: Omit<XmlElement, "children">;
  readonly children: XmlNode[];
  text: string;
}

function toAttribute({ uri: namespace, local: name, prefix, value }: SaxesTagNS["attributes"][string]): XmlAttribute {
  return prefix === "" ? { namespace, name, value } : { namespace, name, prefix, value };
}

/**
 * Builds the tree from the events of the parser, and enforces the limits as the tree grows.
 *
 * @remarks
 * A `SecurityError` names the limit that a document exceeds. A `ReadError` reports a name or a namespace declaration that
 * the parser lets through and a tree could not keep.
 */
export class TreeBuilder {
  private readonly frames: Frame[] = [];
  private readonly limits: XmlLimits;
  private readonly path: string | undefined;
  private readonly name: string;
  private nodes = 0;
  private result: XmlElement | undefined;

  /**
   * Starts a tree.
   *
   * @param limits - The limits that the tree may not exceed.
   * @param path - The path of the document, which errors name.
   */
  constructor(limits: XmlLimits, path: string | undefined) {
    this.limits = limits;
    this.path = path;
    this.name = documentName(path);
  }

  /**
   * The root element, once it is closed.
   *
   * @throws `ReadError` when the document has no root element.
   */
  get root(): XmlElement {
    if (this.result === undefined) {
      throw readError("assesskit/xml/not-well-formed", `${this.name} has no root element.`);
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
    throw readError("assesskit/xml/not-well-formed", message, { path: this.path, line, column });
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
    throw readError("assesskit/xml/namespace", message, { path: this.path, line, column });
  }

  /**
   * Opens an element at the position of its start tag.
   *
   * @param tag - The start tag from the parser.
   * @param line - The line of the start tag.
   * @param column - The column of the start tag.
   * @throws `SecurityError` when the element exceeds `maxDepth`, `maxAttributes` or `maxNodes`.
   * @throws `ReadError` when a name or a namespace declaration is not one that a tree can keep.
   */
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

  /**
   * Appends characters to the open element; characters outside the root are white space that the tree leaves out.
   *
   * @param value - The characters.
   */
  text(value: string): void {
    const frame = this.frames.at(-1);
    if (frame !== undefined) frame.text += value;
  }

  /**
   * Appends a CDATA section, comment or processing instruction to the open element.
   *
   * @param node - The node.
   * @throws `SecurityError` when the tree exceeds `maxNodes`.
   */
  node(node: XmlNode): void {
    if (this.frames.length === 0) return;
    this.flush();
    this.add(node);
  }

  /**
   * Closes the open element and appends it to its parent, or makes it the root.
   *
   * @throws `SecurityError` when the tree exceeds `maxNodes`.
   */
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
