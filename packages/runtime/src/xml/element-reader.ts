import { checkArray, checkChoice, checkRecord, checkString, describe } from "../checks.js";
import { checkOptions } from "../checks-internal.js";
import { DataError, type ReadError } from "../errors.js";
import { isXmlLanguage } from "./language.js";
import { type ParseXmlOptions, parseXml } from "./parse.js";
import { createReadError, locateElement } from "./read-error.js";
import { XML_NAMESPACE, XMLNS_NAMESPACE, type XmlAttribute, type XmlElement, XSI_NAMESPACE } from "./tree.js";

/** What an {@link ElementReader} needs to know about the documents it reads. */
export interface ReaderRules {
  /** The module that reads, such as `results`: the rules of its issues are `assesskit/<module>/<name>`. */
  readonly module: string;
  /** The namespaces of the elements the schema defines, the schema's own first; elements in other namespaces are extensions. */
  readonly namespaces: readonly string[];
  /**
   * The path of the document in its package or directory, which the issues name. `open` sets it from its options.
   *
   * @defaultValue `undefined`
   */
  readonly path?: string;
}

/** The options of {@link createTermConverter}. */
export interface CreateTermConverterOptions {
  /**
   * Names the text in the message of the `DataError` that a wrong term gives.
   *
   * @defaultValue `"The text"`
   */
  readonly label?: string;
}

/**
 * Returns a conversion for `ElementReader.text` and `ElementReader.attribute`: the text must be one of some terms.
 *
 * @param terms - The terms.
 * @param options - See {@link CreateTermConverterOptions}.
 * @returns A function that returns its text when it is one of the terms.
 * @throws `DataError` from the returned function when the text is not one of the terms.
 */
export function createTermConverter<T extends string>(
  terms: readonly T[],
  options: CreateTermConverterOptions = {},
): (text: string) => T {
  checkOptions(options);
  const { label = "The text" } = options;
  return (text) => {
    checkChoice(text, label, terms);
    return text;
  };
}

const isBlank = (value: string): boolean => value.trim() === "";

/**
 * Reads one element of a document that is being mapped to a model: its attributes, its child elements in order, or its
 * text.
 *
 * @remarks
 * The reader reports what the model leaves unread, so that nothing in a document is dropped without notice, and it turns
 * each problem into a `ReadError` that names the element, its position and the rule. It is positioned on an element and
 * moves forward through its children: `take`, `takeAny`, `require`, `takeAll` and `takeForeign` consume the children
 * that follow, and `next` consumes the next child whatever it is. {@link ElementReader.done} fails when an attribute or a
 * child is left.
 */
export class ElementReader {
  /** The element this reader reads. */
  readonly element: XmlElement;
  private readonly rules: ReaderRules;
  private readonly trail: string;
  private readonly used = new Set<XmlAttribute>();
  private elements: readonly XmlElement[] | undefined;
  private position = 0;
  private textRead = false;

  /**
   * Starts reading an element.
   *
   * @param element - The element to read, from `parseXml` or built by the caller.
   * @param rules - See {@link ReaderRules}.
   * @param trail - The path of the parent elements, `/`-separated; empty for a root.
   * @throws `DataError` when `element` is not an element or the rules are not rules.
   */
  constructor(element: XmlElement, rules: ReaderRules, trail = "") {
    if (!(typeof element === "object" && element !== null && element.kind === "element")) {
      throw new DataError("The element to read must be an element of the tree that parseXml returns.");
    }
    checkRecord(rules, "The rules of a reader must be an object");
    checkString(rules.module, "The module of the rules of a reader");
    checkArray(rules.namespaces, "The namespaces of the rules of a reader must be an array");
    if (rules.path !== undefined) checkString(rules.path, "The path of the rules of a reader");
    this.element = element;
    this.rules = rules;
    this.trail = trail === "" ? element.name : `${trail}/${element.name}`;
  }

  /**
   * Opens a document for reading: text and bytes are parsed with {@link parseXml}, an element is taken as it is.
   *
   * @param input - The document.
   * @param rules - See {@link ReaderRules}.
   * @param what - Names the document in messages, such as `The results`.
   * @param options - The options of {@link parseXml}: `path` names the document in the issues, and `limits` apply to text
   * and bytes.
   * @defaultValue `{}`
   * @returns A reader positioned on the root element.
   * @throws `DataError` when `input` is none of these, or an option has the wrong type.
   * @throws `ReadError` and `SecurityError` as {@link parseXml} does.
   */
  static open(input: unknown, rules: ReaderRules, what: string, options: ParseXmlOptions = {}): ElementReader {
    checkOptions(options);
    const located = options.path === undefined ? rules : { ...rules, path: options.path };
    if (typeof input === "string" || input instanceof Uint8Array) {
      return new ElementReader(parseXml(input, options), located);
    }
    if (typeof input === "object" && input !== null && Reflect.get(input, "kind") === "element") {
      return new ElementReader(input as XmlElement, located);
    }
    throw new DataError(`${what} to read must be a string, a Uint8Array or an XmlElement, found ${describe(input)}.`);
  }

  /** The local name of the element. */
  get name(): string {
    return this.element.name;
  }

  /** The name of the element for a message: the local name, preceded by the namespace in braces when it is not the one of the rules. */
  get qualifiedName(): string {
    return this.labelOf(this.element);
  }

  /** Whether the element is in another namespace than the rules define: an extension. */
  get foreign(): boolean {
    return !this.isModel(this.element);
  }

  /**
   * Builds the `ReadError` for a problem at this element. Throw the result.
   *
   * @param rule - The rule that the element breaks, such as `missing-attribute`; the module of the rules goes before it.
   * @param message - A full sentence that says what is wrong and what is expected.
   * @param options - The `cause`: the error that this one reports.
   * @returns The error, with the position of the element.
   */
  fail(rule: string, message: string, options: ErrorOptions = {}): ReadError {
    return createReadError(`assesskit/${this.rules.module}/${rule}`, message, {
      location: locateElement(this.element, this.rules.path, { trail: this.trail }),
      ...options,
    });
  }

  /**
   * Runs a conversion that signals a bad value with a `DataError`, such as a function of `values`, and turns that error into a
   * `ReadError` at this element.
   *
   * @param rule - The rule that a bad value breaks, such as `invalid-value`.
   * @param run - The conversion.
   * @param lead - Text that opens the message of the `ReadError` before the message of the `DataError`.
   * @defaultValue `""`
   * @returns What `run` returns.
   * @throws `ReadError` when `run` throws a `DataError`; any other error passes through.
   */
  attempt<T>(rule: string, run: () => T, lead = ""): T {
    try {
      return run();
    } catch (error) {
      if (error instanceof DataError) throw this.fail(rule, `${lead}${error.message}`, { cause: error });
      throw error;
    }
  }

  private labelOf(element: XmlElement): string {
    if (this.rules.namespaces.includes(element.namespace)) return element.name;
    return element.namespace === "" ? `${element.name} in no namespace` : `{${element.namespace}}${element.name}`;
  }

  private attributeNamed(namespace: string, name: string): XmlAttribute | undefined {
    const found = this.element.attributes.find(
      (attribute) => attribute.namespace === namespace && attribute.name === name,
    );
    if (found !== undefined) this.used.add(found);
    return found;
  }

  private convert<T>(parse: (text: string) => T, text: string, rule: string, what: string): T {
    return this.attempt(rule, () => parse(text), `${what} is invalid. `);
  }

  /**
   * Returns the value of an attribute that is in no namespace, or `undefined` when the element has none.
   *
   * @param name - The local name of the attribute.
   * @returns The text of the attribute.
   */
  attribute(name: string): string | undefined;
  /**
   * Returns the value of an attribute that is in no namespace, converted, or `undefined` when the element has none.
   *
   * @param name - The local name of the attribute.
   * @param parse - Converts the text of the attribute, for instance with `parsePrimitive`. A `DataError` that it throws
   * becomes a `ReadError` that names the attribute.
   * @returns The converted value.
   * @throws `ReadError` when `parse` fails.
   */
  attribute<T>(name: string, parse: (text: string) => T): T | undefined;
  attribute<T>(name: string, parse?: (text: string) => T): string | T | undefined {
    const text = this.attributeNamed("", name)?.value;
    if (text === undefined || parse === undefined) return text;
    return this.convert(parse, text, "invalid-attribute", `The attribute ${name} of the element ${this.name}`);
  }

  /**
   * Returns the value of an attribute in no namespace.
   *
   * @param name - The local name of the attribute.
   * @returns The text of the attribute.
   * @throws `ReadError` when the element has none.
   */
  required(name: string): string;
  /**
   * Returns the value of an attribute in no namespace, converted as {@link ElementReader.attribute} does.
   *
   * @param name - The local name of the attribute.
   * @param parse - Converts the text of the attribute.
   * @returns The converted value.
   * @throws `ReadError` when the element has none or `parse` fails.
   */
  required<T>(name: string, parse: (text: string) => T): T;
  required<T>(name: string, parse?: (text: string) => T): string | T {
    const value = parse === undefined ? this.attribute(name) : this.attribute(name, parse);
    if (value === undefined) {
      throw this.fail("missing-attribute", `The element ${this.name} needs the attribute ${name}.`);
    }
    return value;
  }

  /**
   * Returns the value of an attribute that must be one of some terms, or `undefined` when the element has none.
   *
   * @param name - The local name of the attribute.
   * @param terms - The terms that the attribute may have.
   * @returns The term.
   * @throws `ReadError` when the value is another term.
   */
  term<T extends string>(name: string, terms: readonly T[]): T | undefined {
    return this.attribute(name, (text): T => {
      checkChoice(text, `The attribute ${name}`, terms);
      return text;
    });
  }

  /**
   * Returns the value of an attribute that must be one of some terms.
   *
   * @param name - The local name of the attribute.
   * @param terms - The terms that the attribute may have.
   * @returns The term.
   * @throws `ReadError` when the element has none or another term.
   */
  requiredTerm<T extends string>(name: string, terms: readonly T[]): T {
    const value = this.term(name, terms);
    if (value === undefined) {
      throw this.fail("missing-attribute", `The element ${this.name} needs the attribute ${name}.`);
    }
    return value;
  }

  /**
   * Returns the value of `xml:lang`, or `undefined` when the element has none.
   *
   * @returns The language tag, or the empty string that undoes an inherited language.
   * @throws `ReadError` when the value is not a language tag or empty.
   */
  language(): string | undefined {
    const text = this.attributeNamed(XML_NAMESPACE, "lang")?.value;
    if (text === undefined || isXmlLanguage(text)) return text;
    const message = `The attribute xml:lang of the element ${this.name} is invalid. The text ${describe(text)} is not a language tag such as en or pt-BR.`;
    throw this.fail("invalid-attribute", message);
  }

  /**
   * Returns the value of `xml:base`, or `undefined` when the element has none.
   *
   * @returns The base reference.
   */
  base(): string | undefined {
    return this.attributeNamed(XML_NAMESPACE, "base")?.value;
  }

  /**
   * Returns the value of `xml:lang`.
   *
   * @returns The language tag.
   * @throws `ReadError` when the element has none or an invalid one.
   */
  requiredLanguage(): string {
    const value = this.language();
    if (value === undefined) {
      throw this.fail("missing-attribute", `The element ${this.name} needs the attribute xml:lang.`);
    }
    return value;
  }

  /** The child elements, after checking that the element has no text other than white space. */
  private content(): readonly XmlElement[] {
    if (this.elements === undefined) {
      const stray = this.element.children.find(
        (child) => (child.kind === "text" || child.kind === "cdata") && !isBlank(child.value),
      );
      if (stray !== undefined) {
        throw this.fail("unexpected-text", `The element ${this.name} has text, but it contains elements only.`);
      }
      this.elements = this.element.children.filter((child) => child.kind === "element");
    }
    return this.elements;
  }

  private reader(element: XmlElement): ElementReader {
    return new ElementReader(element, this.rules, this.trail);
  }

  private isModel(element: XmlElement): boolean {
    return this.rules.namespaces.includes(element.namespace);
  }

  /**
   * Consumes the next child element.
   *
   * @returns A reader of the child, or `undefined` when none is left.
   * @throws `ReadError` when the element has text other than white space.
   */
  next(): ElementReader | undefined {
    const element = this.content()[this.position];
    if (element === undefined) return undefined;
    this.position += 1;
    return this.reader(element);
  }

  /**
   * Consumes the next child if it is one of the elements `names` of the namespace of the rules.
   *
   * @param names - The local names.
   * @returns A reader of the child, or `undefined` when the next child is another element or none is left.
   * @throws `ReadError` when the element has text other than white space.
   */
  takeAny(names: readonly string[]): ElementReader | undefined {
    const element = this.content()[this.position];
    if (element === undefined || !(this.isModel(element) && names.includes(element.name))) return undefined;
    this.position += 1;
    return this.reader(element);
  }

  /**
   * Consumes the next child if it is the element `name` of the namespace of the rules.
   *
   * @param name - The local name.
   * @returns A reader of the child, or `undefined` when the next child is another element or none is left.
   * @throws `ReadError` when the element has text other than white space.
   */
  take(name: string): ElementReader | undefined {
    return this.takeAny([name]);
  }

  /**
   * Consumes the next child, which must be the element `name`.
   *
   * @param name - The local name.
   * @returns A reader of the child.
   * @throws `ReadError` when the next child is another element or none is left.
   */
  require(name: string): ElementReader {
    const reader = this.take(name);
    if (reader === undefined) {
      const next = this.content()[this.position];
      const found = next === undefined ? "no more elements" : `the element ${this.labelOf(next)}`;
      throw this.fail("missing-element", `The element ${this.name} needs the element ${name}, found ${found}.`);
    }
    return reader;
  }

  /**
   * Consumes the run of children that are the element `name`.
   *
   * @param name - The local name.
   * @returns A reader of each child; an empty array when none follows.
   * @throws `ReadError` when the element has text other than white space.
   */
  takeAll(name: string): ElementReader[] {
    const readers: ElementReader[] = [];
    for (let reader = this.take(name); reader !== undefined; reader = this.take(name)) readers.push(reader);
    return readers;
  }

  /**
   * Returns the element of a reader as an extension: an element of another namespace than the schema's, which a model keeps
   * as it is. The schema's wildcards (`##other`) do not allow an element in no namespace.
   *
   * @returns The element.
   * @throws `ReadError` when the element is in no namespace.
   */
  extension(): XmlElement {
    if (this.element.namespace === "") {
      const message = `The element ${this.qualifiedName} is not an extension: an extension is in a namespace of its own.`;
      throw this.fail("unexpected-element", message);
    }
    return this.element;
  }

  /**
   * Consumes the run of children that are in another namespace, extensions that the model keeps as they are.
   *
   * @returns The extensions; an empty array when none follows.
   * @throws `ReadError` when one is in no namespace; see {@link extension}.
   */
  takeForeign(): XmlElement[] {
    const extensions: XmlElement[] = [];
    for (
      let element = this.content()[this.position];
      element !== undefined && !this.isModel(element);
      element = this.content()[this.position]
    ) {
      this.position += 1;
      extensions.push(this.reader(element).extension());
    }
    return extensions;
  }

  /**
   * Returns the text of the element: its text and CDATA sections joined, without comments and processing instructions.
   *
   * @returns The text.
   * @throws `ReadError` when the element has child elements.
   */
  text(): string;
  /**
   * Returns the text of the element, converted.
   *
   * @param parse - Converts the text, as for {@link ElementReader.attribute}.
   * @returns The converted value.
   * @throws `ReadError` when the element has child elements, or `parse` fails.
   */
  text<T>(parse: (text: string) => T): T;
  text<T>(parse?: (text: string) => T): string | T {
    this.textRead = true;
    let text = "";
    for (const child of this.element.children) {
      if (child.kind === "element") {
        const message = `The element ${this.name} has the element ${this.labelOf(child)}, but it contains text only.`;
        throw this.fail("unexpected-element", message);
      }
      if (child.kind === "text" || child.kind === "cdata") text += child.value;
    }
    return parse === undefined
      ? text
      : this.convert(parse, text, "invalid-text", `The text of the element ${this.name}`);
  }

  /**
   * Returns the text of an element that holds text only, converted, and finishes the element: `text(parse)` and `done()`.
   *
   * @param parse - Converts the text, as for {@link ElementReader.attribute}.
   * @returns The converted value.
   * @throws `ReadError` as `text` and `done` do.
   */
  leaf<T>(parse: (text: string) => T): T {
    const value = this.text(parse);
    this.done();
    return value;
  }

  /**
   * Finishes the element: it must have no attribute, no child element and no text left unread. Namespace declarations and the
   * attributes of `xsi:` are never unread.
   *
   * @throws `ReadError` for the first attribute or child element left.
   */
  done(): void {
    const stray = this.element.attributes.find(
      (attribute) =>
        !(this.used.has(attribute) || attribute.namespace === XMLNS_NAMESPACE || attribute.namespace === XSI_NAMESPACE),
    );
    if (stray !== undefined) {
      const name = stray.prefix === undefined ? stray.name : `${stray.prefix}:${stray.name}`;
      const message = `The element ${this.name} has the attribute ${name}, which the schema does not define for it.`;
      throw this.fail("unexpected-attribute", message);
    }
    const extra = this.textRead ? undefined : this.content()[this.position];
    if (extra !== undefined) {
      const message = `The element ${this.labelOf(extra)} is not allowed in ${this.name} at this place.`;
      throw this.reader(extra).fail("unexpected-element", message);
    }
  }
}
