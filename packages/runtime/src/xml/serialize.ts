import { isChar } from "xmlchars/xml/1.0/ed5.js";
import { NC_NAME_RE } from "xmlchars/xmlns/1.0/ed3.js";
import { checkArray, checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { XML_NAMESPACE, XMLNS_NAMESPACE, type XmlAttribute, type XmlElement, type XmlNode } from "./tree.js";

const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** What a text node escapes: `&` and `<`, `>` so that `]]>` never occurs, and the carriage return, which a parser would normalize. */
const TEXT_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ["\r", "&#13;"],
]);

/** What an attribute value escapes: the above, the quote, and the white space that a parser would normalize to a space. */
const ATTRIBUTE_ESCAPES: ReadonlyMap<string, string> = new Map([
  ...TEXT_ESCAPES,
  ['"', "&quot;"],
  ["\t", "&#9;"],
  ["\n", "&#10;"],
]);

/** The namespace that each prefix stands for; the empty prefix is the default namespace. */
type Scope = ReadonlyMap<string, string>;

/** The bindings in effect at the root: the `xml` prefix (Namespaces in XML 1.0 §3). */
const ROOT_SCOPE: Scope = new Map([["xml", XML_NAMESPACE]]);

function escapeWith(value: string, escapes: ReadonlyMap<string, string>): string {
  let escaped = "";
  for (const char of value) escaped += escapes.get(char) ?? char;
  return escaped;
}

function qualified(prefix: string | undefined, name: string): string {
  return prefix === undefined ? name : `${prefix}:${name}`;
}

/** Returns the prefix of a namespace declaration: `xmlns:p` declares `p`, and `xmlns` declares the default namespace. */
function declaredPrefix({ prefix, name }: XmlAttribute): string {
  return prefix === "xmlns" ? name : "";
}

function declaration(prefix: string, namespace: string): XmlAttribute {
  return prefix === ""
    ? { namespace: XMLNS_NAMESPACE, name: "xmlns", value: namespace }
    : { namespace: XMLNS_NAMESPACE, prefix: "xmlns", name: prefix, value: namespace };
}

/** Returns what is wrong with the namespace and prefix of an attribute, if anything (Namespaces in XML 1.0 §3, §6.1). */
function attributeProblem({ namespace, prefix, name }: XmlAttribute): string | undefined {
  if (namespace === XMLNS_NAMESPACE) {
    const valid = prefix === "xmlns" ? name !== "xmlns" : prefix === undefined && name === "xmlns";
    return valid ? undefined : "is not a namespace declaration, `xmlns` or `xmlns:prefix`";
  }
  if (namespace === "") return prefix === undefined ? undefined : "has a prefix but no namespace";
  if (prefix === undefined) return "is in a namespace but has no prefix";
  return (prefix === "xml") === (namespace === XML_NAMESPACE)
    ? undefined
    : 'uses the prefix "xml" and the XML namespace apart';
}

/** Writes a tree as text, checking each node as it goes. */
class Writer {
  private readonly parts: string[] = [DECLARATION];
  private readonly trail: string[] = [];

  get text(): string {
    return this.parts.join("");
  }

  private fail(message: string): DataError {
    return new DataError(this.trail.length === 0 ? message : `${message} It is in ${this.trail.join("/")}.`);
  }

  private checkName(name: unknown, label: string): asserts name is string {
    if (typeof name !== "string" || !NC_NAME_RE.test(name)) {
      throw this.fail(`${label} must be a name without a colon, found ${describe(name)}.`);
    }
  }

  private checkChars(value: unknown, label: string): asserts value is string {
    if (typeof value !== "string") throw this.fail(`${label} must be a string, found ${describe(value)}.`);
    for (const char of value) {
      const code = char.codePointAt(0) ?? 0;
      if (!isChar(code)) {
        const hex = code.toString(16).toUpperCase().padStart(4, "0");
        throw this.fail(`${label} has the character U+${hex}, which XML 1.0 does not allow.`);
      }
    }
  }

  private checkAttributes(attributes: readonly XmlAttribute[]): void {
    const names = new Set<string>();
    for (const attribute of attributes) {
      checkRecord(attribute, "An attribute must be an object");
      checkString(attribute.namespace, "The namespace of an attribute");
      this.checkName(attribute.name, "The name of an attribute");
      if (attribute.prefix !== undefined)
        this.checkName(attribute.prefix, `The prefix of the attribute ${attribute.name}`);
      const qualifiedName = qualified(attribute.prefix, attribute.name);
      this.checkChars(attribute.value, `The value of the attribute ${qualifiedName}`);
      const problem = attributeProblem(attribute);
      if (problem !== undefined) throw this.fail(`The attribute ${qualifiedName} ${problem}.`);
      if (names.has(qualifiedName)) throw this.fail(`The attribute ${qualifiedName} occurs twice.`);
      names.add(qualifiedName);
    }
  }

  /** Returns the scope inside an element, and the declarations to add so that its name and attributes resolve in it. */
  private bind(element: XmlElement, scope: Scope): { readonly inner: Scope; readonly added: readonly XmlAttribute[] } {
    const inner = new Map(scope);
    const declaredHere = new Set<string>();
    for (const attribute of element.attributes) {
      if (attribute.namespace !== XMLNS_NAMESPACE) continue;
      inner.set(declaredPrefix(attribute), attribute.value);
      declaredHere.add(declaredPrefix(attribute));
    }
    const added: XmlAttribute[] = [];
    const need = (prefix: string, namespace: string): void => {
      if ((inner.get(prefix) ?? "") === namespace) return;
      if (declaredHere.has(prefix))
        throw this.fail(`The prefix ${JSON.stringify(prefix)} stands for two namespaces on one element.`);
      inner.set(prefix, namespace);
      declaredHere.add(prefix);
      added.push(declaration(prefix, namespace));
    };
    need(element.prefix ?? "", element.namespace);
    for (const { namespace, prefix } of element.attributes) {
      if (namespace !== "" && namespace !== XMLNS_NAMESPACE && namespace !== XML_NAMESPACE)
        need(prefix ?? "", namespace);
    }
    return { inner, added };
  }

  private writeAttributes(attributes: readonly XmlAttribute[]): void {
    for (const { prefix, name, value } of attributes) {
      this.parts.push(` ${qualified(prefix, name)}="${escapeWith(value, ATTRIBUTE_ESCAPES)}"`);
    }
  }

  private writeElement(element: XmlElement, scope: Scope): void {
    const { namespace, name, prefix, attributes, children } = element;
    this.checkName(name, "The name of an element");
    this.trail.push(name);
    checkString(namespace, `The namespace of the element ${name}`);
    if (prefix !== undefined) this.checkName(prefix, `The prefix of the element ${name}`);
    if (namespace === "" && prefix !== undefined) throw this.fail(`The element ${name} has a prefix but no namespace.`);
    checkArray(attributes, `The attributes of the element ${name} must be an array`);
    checkArray(children, `The children of the element ${name} must be an array`);
    this.checkAttributes(attributes);
    const { inner, added } = this.bind(element, scope);
    this.parts.push(`<${qualified(prefix, name)}`);
    this.writeAttributes(attributes);
    this.writeAttributes(added);
    if (children.length === 0) {
      this.parts.push("/>");
    } else {
      this.parts.push(">");
      for (const child of children) this.writeNode(child, inner);
      this.parts.push(`</${qualified(prefix, name)}>`);
    }
    this.trail.pop();
  }

  private writeComment(value: unknown): void {
    this.checkChars(value, "A comment");
    if (value.includes("--") || value.endsWith("-"))
      throw this.fail('A comment must not contain "--" or end with "-".');
    this.parts.push(`<!--${value}-->`);
  }

  private writeInstruction(target: unknown, data: unknown): void {
    this.checkName(target, "The target of a processing instruction");
    this.checkChars(data, "The data of a processing instruction");
    if (target.toLowerCase() === "xml" || data.includes("?>")) {
      throw this.fail('A processing instruction must not have the target "xml" or contain "?>".');
    }
    this.parts.push(`<?${target}${data === "" ? "" : ` ${data}`}?>`);
  }

  writeNode(node: XmlNode, scope: Scope): void {
    checkRecord(node, "A node must be an object");
    switch (node.kind) {
      case "element":
        this.writeElement(node, scope);
        break;
      case "text":
        this.checkChars(node.value, "A text node");
        this.parts.push(escapeWith(node.value, TEXT_ESCAPES));
        break;
      case "cdata":
        this.checkChars(node.value, "A CDATA section");
        // A CDATA section cannot contain "]]>", so it is split in the middle of that sequence.
        this.parts.push(`<![CDATA[${node.value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`);
        break;
      case "comment":
        this.writeComment(node.value);
        break;
      case "instruction":
        this.writeInstruction(node.target, node.data);
        break;
      default:
        throw this.fail(
          `A node must have the kind "element", "text", "cdata", "comment" or "instruction", found ${describe(Reflect.get(node, "kind"))}.`,
        );
    }
  }
}

/**
 * Writes an element as an XML document in UTF-8: the declaration, then the tree. Text is written as the tree has it,
 * with no white space added and every character that the syntax needs escaped. A namespace that the tree uses
 * without declaring it is declared on the element that uses it.
 *
 * @throws `DataError` when the tree is not made of valid nodes, or has a name, character, prefix or attribute that XML
 * 1.0 or Namespaces in XML 1.0 do not allow.
 */
export function serializeXml(root: XmlElement): string {
  checkRecord(root, "The root must be an element");
  if (root.kind !== "element")
    throw new DataError(`The root must be an element, found a node of the kind ${describe(root.kind)}.`);
  const writer = new Writer();
  writer.writeNode(root, ROOT_SCOPE);
  return writer.text;
}
