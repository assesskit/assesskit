import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SaxesParser } from "saxes";
import type {
  AcceptDef,
  AttributeDef,
  AttributeType,
  ContentDef,
  SlotDef,
  StringFormat,
  TypeDef,
  Wildcard,
  // biome-ignore lint/style/noRestrictedImports: A type-only import, erased before Node runs the script; the table types are not part of the public API.
} from "../packages/olah/src/asi/table.ts";
import { loadList, schemaDirectory } from "./schemas.ts";

/** An element of the schema, without its annotations. */
export interface XsdNode {
  /** The local name, such as `complexType`. */
  readonly name: string;
  /** The attributes by name. */
  readonly attributes: ReadonlyMap<string, string>;
  /** The child elements in document order. */
  readonly children: XsdNode[];
}

/** The generated table. */
export interface Table {
  /** The types by name, sorted. */
  readonly types: ReadonlyMap<string, TypeDef>;
  /** The elements that are documents: element name to type name. */
  readonly roots: ReadonlyMap<string, string>;
}

const SCHEMA_FILE = "imsqti_asiv3p0p1_v1p0.xsd";
const TARGET = "packages/olah/src/asi/element-table.ts";
const UNBOUNDED = Number.POSITIVE_INFINITY;

/** The elements that are documents: every element that the schema declares at the top level and that is not HTML. */
const ROOT_ELEMENTS = [
  "qti-assessment-item",
  "qti-assessment-section",
  "qti-assessment-stimulus",
  "qti-assessment-test",
  "qti-outcome-declaration",
  "qti-outcome-processing",
  "qti-response-processing",
];

/** The property of an element in a slot when the rule (the element name in camel case, plural for a list) is not right. */
const ELEMENT_PROPERTIES: ReadonlyMap<string, string> = new Map([
  ["qti-assessment-stimulus-ref", "stimulusRefs"],
  ["qti-companion-materials-info", "companionMaterials"],
  ["qti-item-body", "body"],
  ["qti-modal-feedback", "modalFeedback"],
  ["qti-rubric-block", "rubricBlocks"],
  ["qti-stimulus-body", "body"],
  ["qti-test-feedback", "testFeedback"],
]);

/** The property of a slot that accepts several elements and that no rule names, by the type it is in and its first element. */
const SLOT_PROPERTIES: ReadonlyMap<string, string> = new Map([
  ["AssessmentSection/qti-assessment-item-ref", "children"],
  ["OutcomeDeclaration/qti-match-table", "lookupTable"],
  ["Protractor/qti-increment-si", "increment"],
  ["Rule/qti-rule-system-si", "ruleSystem"],
  ["TestPart/qti-assessment-section", "sections"],
]);

/** The types that hold one expression which is not an operand: a condition, a value or a constraint. */
const EXPRESSION_PROPERTIES: ReadonlyMap<string, string> = new Map([
  ["BranchRule", "expression"],
  ["LookupOutcomeValue", "expression"],
  ["OutcomeIf", "condition"],
  ["ResponseIf", "condition"],
  ["SetValue", "expression"],
  ["TemplateConstraint", "expression"],
  ["TemplateDefault", "expression"],
  ["TemplateIf", "condition"],
]);

/** An element that every list of expressions accepts, and one that only the numeric lists accept. */
const EXPRESSION_MARKERS = new Set(["qti-and", "qti-sum"]);

/** An element that every list of rules accepts: one that sets an outcome and one that sets a template variable. */
const RULE_MARKERS = new Set(["qti-set-outcome-value", "qti-set-template-value"]);

/** The types that are named after a built-in or a simple type of the schema. */
const SIMPLE_TYPE_NAMES: ReadonlyMap<string, string> = new Map([
  ["xs:anyURI", "AnyUri"],
  ["xs:integer", "Integer"],
  ["xs:normalizedString", "NormalizedString"],
  ["xs:string", "String"],
]);

/** The formats of the string types of the schema that restrict by pattern. */
const STRING_FORMATS: ReadonlyMap<string, StringFormat | undefined> = new Map([
  ["CoordsDType", "coords"],
  ["EncVariableStringDType", undefined],
  ["FileHrefDType", "uri"],
  ["IdentifierDType", "identifier"],
  ["LengthDType", "length"],
  ["MimeTypeDType", "mime-type"],
  ["SupportExtStringDType", undefined],
  ["URLDType", "uri"],
  ["UniqueIdentifierDType", "id"],
  ["UniqueIdentifierRefDType", "idref"],
  ["UseExtensionStringDType", undefined],
  ["VariableStringDType", "identifier"],
]);

/** The attributes of the XML namespace that the schema refers to: the language, and the base for relative references. */
const XML_ATTRIBUTES: ReadonlyMap<string, AttributeType> = new Map([
  ["xml:base", { kind: "string", format: "uri" }],
  ["xml:lang", { kind: "string", format: "language" }],
]);

const BUILTINS: ReadonlyMap<string, AttributeType> = new Map([
  ["xs:anyURI", { kind: "string", format: "uri" }],
  ["xs:boolean", { kind: "boolean" }],
  ["xs:decimal", { kind: "string", format: "decimal" }],
  ["xs:double", { kind: "double" }],
  ["xs:ID", { kind: "string", format: "id" }],
  ["xs:IDREF", { kind: "string", format: "idref" }],
  ["xs:IDREFS", { kind: "list", item: { kind: "string", format: "idref" } }],
  ["xs:int", { kind: "integer" }],
  ["xs:integer", { kind: "integer" }],
  ["xs:NCName", { kind: "string", format: "identifier" }],
  ["xs:nonNegativeInteger", { kind: "integer", minimum: 0 }],
  ["xs:normalizedString", { kind: "string" }],
  ["xs:string", { kind: "string" }],
]);

/** Reads a schema into a tree without annotations. */
export function parseSchema(text: string): XsdNode {
  const parser = new SaxesParser();
  const stack: XsdNode[] = [];
  let root: XsdNode | undefined;
  let skipped = 0;
  parser.on("opentag", (tag) => {
    const local = tag.name.slice(tag.name.indexOf(":") + 1);
    if (skipped > 0 || local === "annotation") {
      skipped++;
      return;
    }
    const node: XsdNode = { name: local, attributes: new Map(Object.entries(tag.attributes)), children: [] };
    stack.at(-1)?.children.push(node);
    stack.push(node);
  });
  parser.on("closetag", () => {
    if (skipped > 0) skipped--;
    else root = stack.pop();
  });
  parser.write(text).close();
  if (root === undefined) throw new Error("The schema has no root element.");
  return root;
}

function attribute(node: XsdNode, name: string): string | undefined {
  return node.attributes.get(name);
}

function required(node: XsdNode, name: string): string {
  const value = attribute(node, name);
  if (value === undefined) throw new Error(`A ${node.name} has no ${name} attribute.`);
  return value;
}

function child(node: XsdNode, ...names: string[]): XsdNode | undefined {
  return node.children.find((candidate) => names.includes(candidate.name));
}

/** Returns the minimum and maximum number of occurrences of a particle; the maximum of an unbounded one is infinite. */
function occurrences(node: XsdNode): { readonly min: number; readonly max: number } {
  const max = attribute(node, "maxOccurs") ?? "1";
  return { min: Number(attribute(node, "minOccurs") ?? "1"), max: max === "unbounded" ? UNBOUNDED : Number(max) };
}

function camelCase(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function pascalCase(name: string): string {
  const camel = camelCase(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function plural(word: string): string {
  return word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`;
}

/** A particle of a content model, read from the schema. */
type Particle =
  | {
      readonly kind: "element";
      readonly element: string;
      readonly declaration: XsdNode | undefined;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "sequence";
      readonly items: readonly Particle[];
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "choice";
      readonly items: readonly Particle[];
      readonly min: number;
      readonly max: number;
    }
  | { readonly kind: "wildcard"; readonly wildcard: Wildcard };

/** What a complex type declares, with the declarations of the types it extends. */
interface Declaration {
  readonly attributes: AttributeDef[];
  attributeWildcard?: Wildcard;
  readonly particles: Particle[];
  text?: AttributeType;
  mixed: boolean;
}

/** The slots of a particle, and the wildcard it holds, if any. */
interface Collected {
  readonly slots: SlotDef[];
  readonly wildcard?: Wildcard;
}

const XINCLUDE = "xi:include";

/** Reads the schema into a table of element types. */
class TableBuilder {
  private readonly complexTypes = new Map<string, XsdNode>();
  private readonly simpleTypes = new Map<string, XsdNode>();
  private readonly attributeGroups = new Map<string, XsdNode>();
  private readonly groups = new Map<string, XsdNode>();
  private readonly elements = new Map<string, XsdNode>();
  private readonly html = new Set<string>();
  private readonly built = new Map<string, TypeDef>();

  constructor(schema: XsdNode) {
    for (const node of schema.children) {
      const name = attribute(node, "name");
      if (name === undefined) continue;
      const registry = {
        complexType: this.complexTypes,
        simpleType: this.simpleTypes,
        attributeGroup: this.attributeGroups,
        group: this.groups,
        element: this.elements,
      }[node.name];
      registry?.set(name, node);
      if (node.name === "element" && !name.startsWith("qti-")) this.html.add(name);
    }
  }

  build(roots: readonly string[]): Table {
    const rootTypes = new Map<string, string>();
    for (const root of roots) {
      const declaration = this.elements.get(root);
      if (declaration === undefined) throw new Error(`The schema declares no element ${root}.`);
      rootTypes.set(root, this.typeOf(declaration));
    }
    const sorted = [...this.built].sort(([a], [b]) => (a < b ? -1 : 1));
    return { types: new Map(sorted), roots: rootTypes };
  }

  /** Returns the name of the type of an element declaration, building it on first use. */
  private typeOf(declaration: XsdNode): string {
    const reference = attribute(declaration, "ref");
    if (reference !== undefined) {
      const target = this.elements.get(reference);
      if (target === undefined) throw new Error(`The element ${reference} is not declared at the top level.`);
      return this.typeOf(target);
    }
    const name = required(declaration, "name");
    const type = attribute(declaration, "type");
    if (type !== undefined) return this.namedType(type);
    const inline = child(declaration, "simpleType", "complexType");
    if (inline?.name === "simpleType") return this.defineText(pascalCase(name.replace(/^qti-/, "")), inline);
    throw new Error(`The element ${name} has no type.`);
  }

  private namedType(type: string): string {
    const simpleName = SIMPLE_TYPE_NAMES.get(type) ?? (this.simpleTypes.has(type) ? stripSuffix(type) : undefined);
    if (simpleName !== undefined) {
      if (!this.built.has(simpleName)) {
        this.built.set(simpleName, { attributes: [], content: { kind: "text", value: this.simpleType(type) } });
      }
      return simpleName;
    }
    const complex = this.complexTypes.get(type);
    if (complex === undefined) throw new Error(`The type ${type} is not defined.`);
    const key = stripSuffix(type);
    if (!this.built.has(key)) {
      // A placeholder, so that a type that contains itself finds it.
      this.built.set(key, { attributes: [], content: { kind: "empty" } });
      this.built.set(key, this.complexType(key, type, complex));
    }
    return key;
  }

  private defineText(key: string, simple: XsdNode): string {
    if (!this.built.has(key)) {
      this.built.set(key, { attributes: [], content: { kind: "text", value: this.simpleTypeNode(simple) } });
    }
    return key;
  }

  private complexType(key: string, name: string, node: XsdNode): TypeDef {
    const declaration = this.readDeclaration(node);
    const attributes = {
      attributes: declaration.attributes,
      ...(declaration.attributeWildcard === undefined ? {} : { attributeWildcard: declaration.attributeWildcard }),
    };
    const type = { ...attributes, content: this.contentOf(key, name, declaration) };
    checkProperties(key, type);
    return type;
  }

  private contentOf(key: string, name: string, declaration: Declaration): ContentDef {
    if (declaration.text !== undefined) return { kind: "text", value: declaration.text };
    if (this.isFlow(declaration)) {
      this.checkFlow(name, declaration);
      return { kind: "flow" };
    }
    return declaration.particles.length === 0 ? { kind: "empty" } : this.slotsOf(key, declaration.particles);
  }

  /** Returns what a complex type declares, with what the types it extends declare first. */
  private readDeclaration(node: XsdNode): Declaration {
    const declaration: Declaration = { attributes: [], particles: [], mixed: attribute(node, "mixed") === "true" };
    const content = child(node, "complexContent", "simpleContent");
    let own = node;
    if (content !== undefined) {
      const derivation = child(content, "extension", "restriction");
      if (derivation === undefined) throw new Error(`A ${content.name} has no extension or restriction.`);
      const base = required(derivation, "base");
      if (content.name === "simpleContent") declaration.text = this.simpleType(base);
      else if (derivation.name === "extension") this.inherit(declaration, base);
      else if (base !== "xs:anyType") throw new Error(`A restriction of ${base} is not supported.`);
      own = derivation;
    }
    this.readOwn(declaration, own);
    return declaration;
  }

  private inherit(declaration: Declaration, base: string): void {
    const node = this.complexTypes.get(base);
    if (node === undefined) throw new Error(`The base type ${base} is not defined.`);
    const inherited = this.readDeclaration(node);
    declaration.attributes.push(...inherited.attributes);
    declaration.particles.push(...inherited.particles);
    declaration.mixed ||= inherited.mixed;
    if (inherited.attributeWildcard !== undefined) declaration.attributeWildcard = inherited.attributeWildcard;
  }

  private readOwn(declaration: Declaration, node: XsdNode): void {
    for (const part of node.children) {
      switch (part.name) {
        case "attribute":
          declaration.attributes.push(this.attributeDef(part));
          break;
        case "attributeGroup":
          declaration.attributeWildcard = this.attributeWildcardOf(required(part, "ref"));
          break;
        case "sequence":
        case "choice":
          if (part.children.length > 0) declaration.particles.push(this.particle(part));
          break;
        default:
          break;
      }
    }
  }

  private attributeWildcardOf(group: string): Wildcard {
    const node = this.attributeGroups.get(group);
    const any = node === undefined ? undefined : child(node, "anyAttribute");
    if (any === undefined) throw new Error(`The attribute group ${group} is not an attribute wildcard.`);
    return wildcardOf(any);
  }

  private attributeDef(node: XsdNode): AttributeDef {
    const reference = attribute(node, "ref");
    const name = reference ?? required(node, "name");
    const type = reference === undefined ? this.attributeType(node) : XML_ATTRIBUTES.get(reference);
    if (type === undefined) throw new Error(`The attribute reference ${reference} is not supported.`);
    const fallback = attribute(node, "default");
    return {
      name,
      property: attributeProperty(name),
      use: attribute(node, "use") === "required" ? "required" : "optional",
      ...(fallback === undefined ? {} : { default: fallback }),
      type,
    };
  }

  private attributeType(node: XsdNode): AttributeType {
    const type = attribute(node, "type");
    if (type !== undefined) return this.simpleType(type);
    const inline = child(node, "simpleType");
    if (inline === undefined) throw new Error(`The attribute ${required(node, "name")} has no type.`);
    return this.simpleTypeNode(inline);
  }

  private particle(node: XsdNode): Particle {
    const { min, max } = occurrences(node);
    switch (node.name) {
      case "element":
        return this.elementParticle(node, min, max);
      case "sequence":
        return { kind: "sequence", items: node.children.map((part) => this.particle(part)), min, max };
      case "choice":
        return { kind: "choice", items: node.children.map((part) => this.particle(part)), min, max };
      case "group": {
        const group = this.groups.get(required(node, "ref"));
        const any = group?.children[0]?.children[0];
        if (any?.name !== "any") throw new Error(`The group ${required(node, "ref")} is not a wildcard.`);
        return { kind: "wildcard", wildcard: wildcardOf(any) };
      }
      case "any":
        return { kind: "wildcard", wildcard: wildcardOf(node) };
      default:
        throw new Error(`A ${node.name} is not a particle.`);
    }
  }

  private elementParticle(node: XsdNode, min: number, max: number): Particle {
    const reference = attribute(node, "ref");
    if (reference === XINCLUDE || reference?.startsWith("m3:") || reference?.startsWith("ssml11:")) {
      return { kind: "element", element: reference, declaration: undefined, min, max };
    }
    if (reference !== undefined && this.html.has(reference)) {
      return { kind: "element", element: reference, declaration: undefined, min, max };
    }
    return { kind: "element", element: reference ?? required(node, "name"), declaration: node, min, max };
  }

  /** Returns whether a type holds flow content: text mixed with HTML, MathML and SSML elements, kept as XML. */
  private isFlow(declaration: Declaration): boolean {
    return declaration.mixed || declaration.particles.some((particle) => this.hasForeignElement(particle));
  }

  private hasForeignElement(particle: Particle): boolean {
    if (particle.kind === "element") return particle.declaration === undefined && particle.element !== XINCLUDE;
    if (particle.kind === "wildcard") return false;
    return particle.items.some((item) => this.hasForeignElement(item));
  }

  private checkFlow(name: string, declaration: Declaration): void {
    let [only, ...others] = declaration.particles;
    while (only?.kind === "sequence" && only.items.length === 1 && only.max === 1) only = only.items[0];
    if (others.length > 0 || only?.kind !== "choice" || only.max !== UNBOUNDED) {
      throw new Error(`The flow type ${name} has content besides its repeated choice.`);
    }
  }

  private slotsOf(type: string, particles: readonly Particle[]): ContentDef {
    const found = particles.map((particle) => this.collect(type, particle, false));
    const wildcard = found.find((part) => part.wildcard !== undefined)?.wildcard;
    return {
      kind: "slots",
      slots: found.flatMap((part) => part.slots),
      ...(wildcard === undefined ? {} : { wildcard }),
    };
  }

  /** Returns the slots of a particle, and the wildcard it holds; `optional` makes every slot optional. */
  private collect(type: string, particle: Particle, optional: boolean): Collected {
    switch (particle.kind) {
      case "wildcard":
        return { slots: [], wildcard: particle.wildcard };
      case "sequence": {
        if (particle.max !== 1) throw new Error(`The type ${type} repeats a sequence.`);
        const parts = particle.items.map((item) => this.collect(type, item, optional || particle.min === 0));
        const wildcard = parts.find((part) => part.wildcard !== undefined)?.wildcard;
        return { slots: parts.flatMap((part) => part.slots), ...(wildcard === undefined ? {} : { wildcard }) };
      }
      case "choice":
        return { slots: this.choiceSlots(type, particle, optional) };
      case "element":
        return { slots: [this.slot(type, [particle], optional ? 0 : particle.min, particle.max)] };
    }
  }

  private choiceSlots(type: string, choice: Extract<Particle, { kind: "choice" }>, optional: boolean): SlotDef[] {
    const min = optional ? 0 : choice.min;
    const leaves = flattenLeaves(choice);
    if (leaves !== undefined) return [this.slot(type, leaves, min, choice.max)];
    if (choice.max !== 1) throw new Error(`The type ${type} repeats a choice of sequences.`);
    // Alternatives that are sequences: the slots of each branch exclude those of the other branches.
    const branches = choice.items.map((item) => this.collect(type, item, min === 0).slots);
    return branches.flatMap((branch, index) => {
      const others = branches.flatMap((other, position) =>
        position === index ? [] : other.map((slot) => slot.property),
      );
      return branch.map((slot) => ({ ...slot, excludes: others }));
    });
  }

  private slot(type: string, particles: readonly Particle[], min: number, max: number): SlotDef {
    const accepts: AcceptDef[] = [];
    let include = false;
    for (const particle of particles) {
      if (particle.kind !== "element") throw new Error(`The type ${type} has a slot that is not made of elements.`);
      if (particle.element === XINCLUDE) include = true;
      else if (particle.declaration !== undefined)
        accepts.push({ element: particle.element, type: this.typeOf(particle.declaration) });
      else throw new Error(`The type ${type} accepts ${particle.element}, which is not flow.`);
    }
    return {
      property: slotProperty(type, accepts, include, max),
      accepts,
      ...(include ? { include: true as const } : {}),
      min,
      max: max === UNBOUNDED ? "unbounded" : max,
    };
  }

  /** Returns the type of a simple type, by name. */
  private simpleType(name: string): AttributeType {
    const builtin = BUILTINS.get(name);
    if (builtin !== undefined) return builtin;
    const node = this.simpleTypes.get(name);
    if (node === undefined) throw new Error(`The simple type ${name} is not defined.`);
    return this.simpleTypeNode(node, name);
  }

  private simpleTypeNode(node: XsdNode, name?: string): AttributeType {
    const [form] = node.children;
    if (form === undefined) throw new Error("A simple type has no content.");
    switch (form.name) {
      case "restriction":
        return this.restriction(form, name);
      case "list": {
        const item = attribute(form, "itemType");
        const inline = child(form, "simpleType");
        const itemType = item !== undefined ? this.simpleType(item) : inline && this.simpleTypeNode(inline);
        if (itemType === undefined) throw new Error("A list has no item type.");
        return { kind: "list", item: itemType };
      }
      case "union":
        return this.union(form);
      default:
        throw new Error(`A ${form.name} is not a simple type.`);
    }
  }

  private restriction(node: XsdNode, name: string | undefined): AttributeType {
    const base = required(node, "base");
    const terms = node.children
      .filter((facet) => facet.name === "enumeration")
      .map((facet) => required(facet, "value"));
    if (terms.length > 0) return { kind: "enum", terms };
    const minimum = node.children.find((facet) => facet.name === "minInclusive");
    const type = this.simpleType(base);
    if (minimum !== undefined && (type.kind === "double" || type.kind === "integer")) {
      return { ...type, minimum: Number(required(minimum, "value")) };
    }
    if (type.kind === "string" && name !== undefined && STRING_FORMATS.has(name)) {
      const format = STRING_FORMATS.get(name);
      return format === undefined ? { kind: "string" } : { kind: "string", format };
    }
    if (node.children.some((facet) => facet.name === "pattern") && name === undefined) {
      throw new Error("A pattern on an unnamed type is not supported.");
    }
    return type;
  }

  private union(node: XsdNode): AttributeType {
    const members = [
      ...(
        attribute(node, "memberTypes")
          ?.split(/\s+/)
          .filter((member) => member !== "") ?? []
      ).map((member) => this.simpleType(member)),
      ...node.children.filter((member) => member.name === "simpleType").map((member) => this.simpleTypeNode(member)),
    ];
    const has = (kind: AttributeType["kind"]) => members.find((member) => member.kind === kind);
    const strings = members.filter((member) => member.kind === "string");
    const enumeration = has("enum");
    if (enumeration?.kind === "enum" && strings.length > 0) return { ...enumeration, extension: true };
    const number = has("integer") ?? has("double");
    if (number !== undefined && strings.length > 0 && (number.kind === "integer" || number.kind === "double")) {
      return {
        kind: "reference",
        value: number.kind,
        ...(number.kind === "double" && number.minimum !== undefined ? { minimum: number.minimum } : {}),
      };
    }
    if (strings.length === members.length) return { kind: "string" };
    throw new Error(`A union of ${members.map((member) => member.kind).join(", ")} is not supported.`);
  }
}

/** Reads the namespaces and the processing of a wildcard, an `any` or an `anyAttribute`. */
function wildcardOf(node: XsdNode): Wildcard {
  const namespaces = required(node, "namespace") === "##any" ? "any" : "other";
  return { namespaces, ...(attribute(node, "processContents") === "strict" ? { strict: true as const } : {}) };
}

function stripSuffix(type: string): string {
  return type.replace(/^xs:/, "").replace(/DType$/, "");
}

function attributeProperty(name: string): string {
  if (name === "xml:lang") return "language";
  if (name === "xml:base") return "xmlBase";
  return camelCase(name);
}

/** Returns the leaf elements of a choice, or `undefined` when a branch is a sequence. */
function flattenLeaves(choice: Extract<Particle, { kind: "choice" }>): Particle[] | undefined {
  const leaves: Particle[] = [];
  for (const item of choice.items) {
    if (item.kind === "element") leaves.push(item);
    else if (item.kind === "choice" && item.max === 1) {
      const inner = flattenLeaves(item);
      if (inner === undefined) return undefined;
      leaves.push(...inner);
    } else return undefined;
  }
  return leaves;
}

/** Returns the properties that the model of a type has besides those of its attributes and slots. */
function implicitProperties(type: TypeDef): string[] {
  const { content } = type;
  return [
    "kind",
    ...(type.attributeWildcard === undefined ? [] : ["extensions"]),
    ...(content.kind === "slots" && content.wildcard !== undefined ? ["extensionElements"] : []),
    ...(content.kind === "text" ? ["value"] : []),
    ...(content.kind === "flow" ? ["children"] : []),
  ];
}

/** Checks that no property of the model of a type is the property of two attributes or slots, or an implicit one. */
function checkProperties(name: string, type: TypeDef): void {
  const properties = [
    ...implicitProperties(type),
    ...type.attributes.map(({ property }) => property),
    ...(type.content.kind === "slots" ? type.content.slots.map(({ property }) => property) : []),
  ];
  const clash = properties.find((property, index) => properties.indexOf(property) !== index);
  if (clash !== undefined) throw new Error(`The type ${name} has the property ${clash} twice.`);
}

function slotProperty(type: string, accepts: readonly AcceptDef[], include: boolean, max: number): string {
  const [first] = accepts;
  if (accepts.length === 1 && !include && first !== undefined) {
    const known = ELEMENT_PROPERTIES.get(first.element);
    if (known !== undefined) return known;
    const word = camelCase(first.element.replace(/^qti-/, ""));
    return max > 1 ? plural(word) : word;
  }
  if (accepts.some(({ element }) => EXPRESSION_MARKERS.has(element))) {
    return EXPRESSION_PROPERTIES.get(type) ?? (max > 1 ? "operands" : "operand");
  }
  if (accepts.some(({ element }) => RULE_MARKERS.has(element))) return "rules";
  const key = `${type}/${first?.element ?? XINCLUDE}`;
  const named = SLOT_PROPERTIES.get(key);
  if (named === undefined) throw new Error(`Name the slot ${key} in SLOT_PROPERTIES.`);
  return named;
}

/**
 * Builds the table of element types from the text of a schema.
 *
 * @param schema - The text of the schema.
 * @param roots - The elements that are documents. Default: the seven document elements of the ASI schema.
 */
export function buildTable(schema: string, roots: readonly string[] = ROOT_ELEMENTS): Table {
  return new TableBuilder(parseSchema(schema)).build(roots);
}

/** An already rendered piece of source. */
class Source {
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }
}

/** Writes a value as the source of a literal with one entry to a line; Biome shapes the result. */
function literal(value: unknown): string {
  if (value instanceof Source) return value.text;
  if (Array.isArray(value)) return `[${value.map(literal).join(",")}]`;
  if (value instanceof Map) throw new Error("Maps are not rendered.");
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${literal(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The names of the lists of elements that several slots share, by an element that only that list accepts. */
const ACCEPT_LISTS: ReadonlyMap<string, string> = new Map([
  ["qti-and", "EXPRESSION"],
  ["qti-outcome-condition", "OUTCOME_RULES"],
  ["qti-response-condition", "RESPONSE_RULES"],
  ["qti-sum", "NUMERIC_EXPRESSION"],
  ["qti-template-condition", "TEMPLATE_RULES"],
]);

/** Returns the name of a list of elements that is shared, or `undefined` for a list that belongs to one slot. */
function sharedList(accepts: readonly AcceptDef[]): string | undefined {
  return accepts.map(({ element }) => ACCEPT_LISTS.get(element)).find((name) => name !== undefined);
}

/** Returns the source of the table module, before formatting. */
export function renderTable(table: Table, schema: { readonly url: string; readonly sha256: string }): string {
  const lists = new Map<string, readonly AcceptDef[]>();
  const replaceAccepts = (slot: SlotDef): unknown => {
    const name = sharedList(slot.accepts);
    if (name === undefined) return slot;
    const known = lists.get(name);
    if (known !== undefined && JSON.stringify(known) !== JSON.stringify(slot.accepts)) {
      throw new Error(`The slots that share ${name} accept different elements.`);
    }
    lists.set(name, slot.accepts);
    return { ...slot, accepts: new Source(name) };
  };
  const types = Object.fromEntries(
    [...table.types].map(([name, type]) => [
      name,
      type.content.kind === "slots"
        ? { ...type, content: { ...type.content, slots: type.content.slots.map(replaceAccepts) } }
        : type,
    ]),
  );
  const declarations = [...lists]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, accepts]) => `export const ${name} = ${literal(accepts)} as const;`);
  return [
    "// Generated by scripts/asi-table.ts; do not edit.",
    `// Source: ${schema.url} (SHA-256 ${schema.sha256}).`,
    "// biome-ignore-all lint/style/useNamingConvention: The types are named as the schema names them.",
    'import type { TypeDef } from "./table.js";',
    "",
    ...declarations,
    "",
    "/** The element types of the ASI schema that olah reads and writes, by name. */",
    `export const ELEMENT_TYPES = ${literal(types)} as const satisfies Readonly<Record<string, TypeDef>>;`,
    "",
    "/** The elements that are documents, with the name of their type. */",
    `export const DOCUMENT_ELEMENTS = ${literal(Object.fromEntries(table.roots))} as const;`,
    "",
  ].join("\n");
}

/** Formats source with Biome, so that the generated file is what `biome check` accepts. */
function format(root: string, source: string): string {
  return execFileSync("pnpm", ["exec", "biome", "format", `--stdin-file-path=${TARGET}`], {
    cwd: root,
    input: source,
    encoding: "utf8",
  });
}

/**
 * Generates the source of `packages/olah/src/asi/element-table.ts` from the pinned ASI schema in the schema cache.
 *
 * @param root - The repository root.
 */
export function generate(root: string): string {
  const entry = loadList(root).find((schema) => schema.file === SCHEMA_FILE);
  if (entry === undefined) throw new Error(`${SCHEMA_FILE} is not in the list of pinned schemas.`);
  const table = buildTable(readFileSync(join(schemaDirectory(root), SCHEMA_FILE), "utf8"));
  return format(root, renderTable(table, entry));
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, "..");
  writeFileSync(join(root, TARGET), generate(root));
}
