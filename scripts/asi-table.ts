import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SaxesParser } from "saxes";
import type {
  AcceptDef,
  AttributeDef,
  AttributeType,
  ContentDef,
  ForeignDef,
  SlotDef,
  StringFormat,
  TypeDef,
  Wildcard,
  // biome-ignore lint/style/noRestrictedImports: A type-only import, erased before Node runs the script; the table types are not part of the public API.
} from "../packages/runtime/src/asi/table.ts";
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

/** The type that another type extends, and how many of its attributes come from it, first. */
export interface Base {
  /** The name of the type in the schema, such as `BaseSequenceDType`. */
  readonly name: string;
  /** The number of attributes that the base gives. */
  readonly count: number;
}

/** A type that other types extend: all its attributes, and the type it extends in turn. */
export interface BaseType {
  /** The attributes, those of the type it extends first. */
  readonly attributes: readonly AttributeDef[];
  /** The type it extends. */
  readonly base?: Base;
}

/** The generated table. */
export interface Table {
  /** The types by name, sorted. */
  readonly types: ReadonlyMap<string, TypeDef>;
  /** The elements that are documents: element name to type name. */
  readonly roots: ReadonlyMap<string, string>;
  /** The base of each type that extends another, by the name of the type in the table. */
  readonly extended: ReadonlyMap<string, Base>;
  /** The types that other types extend, by name in the schema. */
  readonly bases: ReadonlyMap<string, BaseType>;
}

const SCHEMA_FILE = "imsqti_asiv3p0p1_v1p0.xsd";
const TARGET = "packages/runtime/src/asi/element-table.ts";
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

/** The property of an attribute when the rule (the attribute name in camel case) is not right. */
const ATTRIBUTE_PROPERTIES: ReadonlyMap<string, string> = new Map([
  ["xml:lang", "language"],
  ["xml:base", "xmlBase"],
  // `kind` names the element in a model.
  ["kind", "trackKind"],
]);

/** The property of an element in a slot when the rule (the element name in camel case, plural for a list) is not right. */
const ELEMENT_PROPERTIES: ReadonlyMap<string, string> = new Map([
  ["qti-assessment-stimulus-ref", "stimulusRefs"],
  ["qti-companion-materials-info", "companionMaterials"],
  ["li", "items"],
  ["qti-item-body", "body"],
  // The attribute `label` has the plain name.
  ["qti-label", "labelElement"],
  ["qti-modal-feedback", "modalFeedback"],
  ["qti-rubric-block", "rubricBlocks"],
  ["qti-stimulus-body", "body"],
  ["qti-test-feedback", "testFeedback"],
  ["tbody", "bodies"],
  ["tr", "rows"],
]);

/** The property of a slot that accepts several elements and that no rule names, by the type it is in and its first element. */
const SLOT_PROPERTIES: ReadonlyMap<string, string> = new Map([
  ["AssessmentSection/qti-assessment-item-ref", "children"],
  ["DL/dt", "items"],
  ["DrawingInteraction/object", "image"],
  ["GapImg/object", "image"],
  ["GapMatchInteraction/qti-gap-text", "choices"],
  ["GraphicAssociateInteraction/object", "image"],
  ["GraphicGapMatchInteraction/object", "image"],
  ["GraphicGapMatchInteraction/qti-gap-text", "choices"],
  ["GraphicOrderInteraction/object", "image"],
  ["HotspotInteraction/object", "image"],
  ["MediaInteraction/object", "media"],
  ["OutcomeDeclaration/qti-match-table", "lookupTable"],
  ["PositionObjectInteraction/object", "image"],
  ["PositionObjectStage/object", "image"],
  ["Protractor/qti-increment-si", "increment"],
  ["Rule/qti-rule-system-si", "ruleSystem"],
  ["SelectPointInteraction/object", "image"],
  ["TR/td", "cells"],
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
  | { readonly kind: "foreign"; readonly foreign: ForeignDef; readonly min: number; readonly max: number }
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
  /** The type this one extends. */
  base?: Base;
}

/** The slots of a particle, and the wildcard it holds, if any. */
interface Collected {
  readonly slots: SlotDef[];
  readonly wildcard?: Wildcard;
}

const XINCLUDE = "xi:include";

/** The property of the slot that holds flow content: text, HTML, MathML, SSML, interactions and feedback. */
const FLOW_PROPERTY = "children";

/** Reads the schema into a table of element types. */
class TableBuilder {
  private readonly complexTypes = new Map<string, XsdNode>();
  private readonly simpleTypes = new Map<string, XsdNode>();
  private readonly attributeGroups = new Map<string, XsdNode>();
  private readonly groups = new Map<string, XsdNode>();
  private readonly elements = new Map<string, XsdNode>();
  private readonly namespaces = new Map<string, string>();
  private readonly built = new Map<string, TypeDef>();
  private readonly extended = new Map<string, Base>();
  private readonly bases = new Map<string, BaseType>();

  constructor(schema: XsdNode) {
    for (const [name, value] of schema.attributes) {
      if (name.startsWith("xmlns:")) this.namespaces.set(name.slice("xmlns:".length), value);
    }
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
    return { types: new Map(sorted), roots: rootTypes, extended: this.extended, bases: this.bases };
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
      this.built.set(key, this.complexType(key, complex));
    }
    return key;
  }

  private defineText(key: string, simple: XsdNode): string {
    if (!this.built.has(key)) {
      this.built.set(key, { attributes: [], content: { kind: "text", value: this.simpleTypeNode(simple) } });
    }
    return key;
  }

  private complexType(key: string, node: XsdNode): TypeDef {
    const declaration = this.readDeclaration(node);
    if (declaration.base !== undefined) this.extended.set(key, declaration.base);
    const attributes = {
      attributes: declaration.attributes,
      ...(declaration.attributeWildcard === undefined ? {} : { attributeWildcard: declaration.attributeWildcard }),
    };
    const type = { ...attributes, content: this.contentOf(key, declaration) };
    checkProperties(key, type);
    return type;
  }

  private contentOf(key: string, declaration: Declaration): ContentDef {
    if (declaration.text !== undefined) return { kind: "text", value: declaration.text };
    if (declaration.particles.length === 0) {
      if (declaration.mixed) throw new Error(`The mixed type ${key} contains no elements.`);
      return { kind: "empty" };
    }
    return this.slotsOf(key, declaration.particles, declaration.mixed);
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
    declaration.base = { name: base, count: inherited.attributes.length };
    this.bases.set(base, {
      attributes: inherited.attributes,
      ...(inherited.base === undefined ? {} : { base: inherited.base }),
    });
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
    if (reference === XINCLUDE) return { kind: "element", element: reference, declaration: undefined, min, max };
    if (reference?.includes(":")) return { kind: "foreign", foreign: this.foreignOf(reference), min, max };
    return { kind: "element", element: reference ?? required(node, "name"), declaration: node, min, max };
  }

  /** Returns the element that a reference with a prefix names, such as `m3:math`. */
  private foreignOf(reference: string): ForeignDef {
    const [prefix = "", element = ""] = reference.split(":");
    const namespace = this.namespaces.get(prefix);
    if (namespace === undefined) throw new Error(`The prefix of ${reference} is not declared by the schema.`);
    return { namespace, element };
  }

  private slotsOf(type: string, particles: readonly Particle[], mixed: boolean): ContentDef {
    // Text may stand anywhere in mixed content, so the model keeps its elements and text in one array in document order.
    if (mixed) return { kind: "slots", slots: [this.slot(type, particles.flatMap(leavesOf), 0, UNBOUNDED, true)] };
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
      case "foreign":
        return { slots: [this.slot(type, [particle], optional ? 0 : particle.min, particle.max)] };
    }
  }

  private choiceSlots(type: string, choice: Extract<Particle, { kind: "choice" }>, optional: boolean): SlotDef[] {
    const min = optional ? 0 : choice.min;
    const leaves = flattenLeaves(choice);
    // The elements of a choice that picks one of them once can repeat on their own, as the rows or the bodies of a table.
    const repeating = choice.max === 1 && leaves?.some((leaf) => leaf.max > 1);
    if (leaves !== undefined && !repeating) return [this.slot(type, leaves, min, choice.max)];
    if (choice.max !== 1) throw new Error(`The type ${type} repeats a choice of sequences.`);
    // Alternatives: the slots of each branch exclude those of the other branches, and a branch that another can replace
    // is optional.
    const branches = choice.items.map((item) => this.collect(type, item, true).slots);
    return branches.flatMap((branch, index) => {
      const others = branches.flatMap((other, position) =>
        position === index ? [] : other.map((slot) => slot.property),
      );
      return branch.map((slot) => ({ ...slot, excludes: others }));
    });
  }

  private slot(type: string, particles: readonly Particle[], min: number, max: number, mixed = false): SlotDef {
    const accepts: AcceptDef[] = [];
    const foreign: ForeignDef[] = [];
    let include = false;
    for (const particle of particles) {
      if (particle.kind === "foreign") addForeign(foreign, particle.foreign);
      else if (particle.kind !== "element")
        throw new Error(`The type ${type} has a slot that is not made of elements.`);
      else if (particle.element === XINCLUDE) include = true;
      else this.addAccept(type, accepts, particle);
    }
    // A slot that takes MathML or SSML, or text, holds flow content: the body of an item, a prompt, a paragraph.
    const flow = mixed || foreign.length > 0;
    return {
      property: flow ? FLOW_PROPERTY : slotProperty(type, accepts, include, max),
      accepts,
      ...(foreign.length > 0 ? { foreign } : {}),
      ...(include ? { include: true as const } : {}),
      ...(mixed ? { text: true as const } : {}),
      min,
      max: max === UNBOUNDED ? "unbounded" : max,
    };
  }

  /** Adds the element of a particle to the list of the accepted ones, once, with the type that models it. */
  private addAccept(type: string, accepts: AcceptDef[], particle: Extract<Leaf, { kind: "element" }>): void {
    if (particle.declaration === undefined) {
      throw new Error(`The type ${type} accepts ${particle.element}, which has no declaration.`);
    }
    if (!accepts.some(({ element }) => element === particle.element)) {
      accepts.push({ element: particle.element, type: this.typeOf(particle.declaration) });
    }
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
      // A string that the schema leaves unrestricted holds a reference in braces, `{identifier}` (INFO §9.3.1).
      const braced = strings.some((member) => member.kind === "string" && member.format === undefined);
      return {
        kind: "reference",
        value: number.kind,
        ...(number.kind === "double" && number.minimum !== undefined ? { minimum: number.minimum } : {}),
        ...(braced ? { braced: true as const } : {}),
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
  return ATTRIBUTE_PROPERTIES.get(name) ?? camelCase(name);
}

/**
 * Returns the leaf elements of a choice, or `undefined` when a branch is a sequence. A choice nested in an unbounded
 * choice is flattened whatever its own limits are, as the outer repetition allows any number of its elements.
 */
function flattenLeaves(choice: Extract<Particle, { kind: "choice" }>): Leaf[] | undefined {
  const leaves: Leaf[] = [];
  for (const item of choice.items) {
    if (item.kind === "element" || item.kind === "foreign") leaves.push(item);
    else if (item.kind === "choice" && (item.max === 1 || choice.max === UNBOUNDED)) {
      const inner = flattenLeaves(item);
      if (inner === undefined) return undefined;
      leaves.push(...inner);
    } else return undefined;
  }
  return leaves;
}

/** A particle that is one element of the ASI namespace, `xi:include`, or an element of another namespace. */
type Leaf = Extract<Particle, { kind: "element" | "foreign" }>;

/** Adds an element of another namespace to a list of them, once. */
function addForeign(list: ForeignDef[], entry: ForeignDef): void {
  if (!list.some(({ namespace, element }) => namespace === entry.namespace && element === entry.element)) {
    list.push(entry);
  }
}

/** Returns the leaf elements of a particle, however deep, without looking at order or limits. */
function leavesOf(particle: Particle): Leaf[] {
  switch (particle.kind) {
    case "element":
    case "foreign":
      return [particle];
    case "sequence":
    case "choice":
      return particle.items.flatMap(leavesOf);
    case "wildcard":
      throw new Error("Mixed content with a wildcard is not supported.");
  }
}

/** Returns the properties that the model of a type has besides those of its attributes and slots. */
function implicitProperties(type: TypeDef): string[] {
  const { content } = type;
  return [
    "kind",
    ...(type.attributeWildcard === undefined ? [] : ["extensions"]),
    ...(content.kind === "slots" && content.wildcard !== undefined ? ["extensionElements"] : []),
    ...(content.kind === "text" ? ["value"] : []),
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

/**
 * The names of the lists of elements that other modules import, by an element that only that list accepts. A list
 * without a name here is named after the first type that uses it, if two slots share it.
 */
const ACCEPT_LISTS: ReadonlyMap<string, string> = new Map([
  ["qti-and", "EXPRESSION"],
  ["qti-outcome-condition", "OUTCOME_RULES"],
  ["qti-response-condition", "RESPONSE_RULES"],
  ["qti-sum", "NUMERIC_EXPRESSION"],
  ["qti-template-condition", "TEMPLATE_RULES"],
]);

/** The fewest attributes of a type that other types extend for the table to name the list and share it. */
const SHARED_ATTRIBUTES_MINIMUM = 10;

/** The fewest elements in a list that two slots share for the table to name it; shorter lists stay with their slot. */
const SHARED_ELEMENTS_MINIMUM = 10;

/** Returns a name in SCREAMING_SNAKE_CASE for a type of the schema, such as `BaseHTML5Flow` for `BASE_HTML5_FLOW`. */
function screamingCase(name: string): string {
  return stripSuffix(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}

/** Returns the name of the type alias for a constant: `EXPRESSION` is `Expression`, `ARIA_BASE_ATTRIBUTES` is `AriaBaseAttributes`. */
function aliasOf(constant: string): string {
  return constant
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join("");
}

/**
 * Returns the source that uses a shared list: the constant, asserted to the type alias of its own type. The declaration
 * file then names the list where it is used, and does not repeat it for every use.
 */
function useOf(constant: string): Source {
  return new Source(`${constant} as ${aliasOf(constant)}`);
}

/** Returns the source of a shared list: the constant and, when the table uses the list, the alias that names its type. */
function declarationOf(constant: string, entries: unknown, options: { exported: boolean; used: boolean }): string {
  const list = `${options.exported ? "export " : ""}const ${constant} = ${literal(entries)} as const;`;
  return options.used ? `${list}\ntype ${aliasOf(constant)} = typeof ${constant};` : list;
}

/** A list of elements that several slots share. */
interface SharedList {
  /** The name of the constant. */
  readonly name: string;
  /** The entries. */
  readonly entries: readonly unknown[];
  /** Whether other modules import it. */
  readonly exported: boolean;
}

/** Collects the lists of elements of the slots, names those that are shared, and replaces them by their names. */
class ListSharing {
  private readonly users = new Map<string, { readonly first: string; count: number }>();
  private readonly lists = new Map<string, SharedList>();

  constructor(table: Table) {
    for (const [name, type] of table.types) {
      if (type.content.kind !== "slots") continue;
      for (const slot of type.content.slots) {
        for (const list of [slot.accepts, slot.foreign ?? []]) {
          const key = JSON.stringify(list);
          const user = this.users.get(key);
          if (user === undefined) this.users.set(key, { first: name, count: 1 });
          else user.count++;
        }
      }
    }
  }

  /** Returns the name of the constant for a list, or `undefined` for a list that belongs to one slot. */
  private nameOf(list: readonly AcceptDef[] | readonly ForeignDef[], suffix: string): SharedList | undefined {
    const key = JSON.stringify(list);
    const known = this.lists.get(key);
    if (known !== undefined) return known;
    const marked = list
      .map((entry) => ("type" in entry ? ACCEPT_LISTS.get(entry.element) : undefined))
      .find((name) => name !== undefined);
    const user = this.users.get(key);
    if (marked === undefined && (list.length < SHARED_ELEMENTS_MINIMUM || user === undefined || user.count < 2)) {
      return undefined;
    }
    const name = marked ?? `${screamingCase(user?.first ?? "")}_${suffix}`;
    if ([...this.lists.values()].some((other) => other.name === name)) {
      throw new Error(`Two lists of elements share the name ${name}.`);
    }
    const shared = { name, entries: list, exported: marked !== undefined };
    this.lists.set(key, shared);
    return shared;
  }

  /** Returns a slot with its lists of elements replaced by the names of the constants that hold them. */
  share(slot: SlotDef): unknown {
    const accepts = this.nameOf(slot.accepts, "ACCEPTS");
    const foreign = slot.foreign === undefined ? undefined : this.nameOf(slot.foreign, "FOREIGN");
    return {
      ...slot,
      ...(accepts === undefined ? {} : { accepts: useOf(accepts.name) }),
      ...(foreign === undefined ? {} : { foreign: useOf(foreign.name) }),
    };
  }

  /** Returns the source of the constants, sorted by name. */
  declarations(): string[] {
    return [...this.lists.values()]
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map(({ name, entries, exported }) => declarationOf(name, entries, { exported, used: true }));
  }
}

/** Names the lists of attributes that types inherit, and writes a type's attributes after the list it inherits. */
class AttributeSharing {
  private readonly table: Table;
  private readonly users = new Map<string, number>();
  private readonly used = new Set<string>();

  constructor(table: Table) {
    this.table = table;
    for (const base of [...table.extended.values(), ...[...table.bases.values()].flatMap(({ base }) => base ?? [])]) {
      this.users.set(base.name, (this.users.get(base.name) ?? 0) + 1);
    }
  }

  /** Returns whether a base is extended by two types, is long, and has attributes of its own besides those it extends. */
  private isShared(name: string): boolean {
    const base = this.table.bases.get(name);
    return (
      base !== undefined &&
      (this.users.get(name) ?? 0) >= 2 &&
      base.attributes.length >= SHARED_ATTRIBUTES_MINIMUM &&
      base.attributes.length > (base.base?.count ?? 0)
    );
  }

  /** Returns the nearest base, at or above a type's own, whose list is shared. */
  private sharedBase(base: Base | undefined): Base | undefined {
    if (base === undefined || this.isShared(base.name)) return base;
    return this.sharedBase(this.table.bases.get(base.name)?.base);
  }

  private constantOf(name: string): string {
    return `${screamingCase(name)}_ATTRIBUTES`;
  }

  /**
   * Returns the attributes of a type or of a base, as the properties of its entry in the table: those it inherits from a
   * shared base, by reference, and its own.
   */
  attributes(
    attributes: readonly AttributeDef[],
    base: Base | undefined,
  ): { readonly inherited?: Source; readonly attributes: readonly AttributeDef[] } {
    const shared = this.sharedBase(base);
    if (shared === undefined) return { attributes };
    this.used.add(shared.name);
    return { inherited: useOf(this.constantOf(shared.name)), attributes: attributes.slice(shared.count) };
  }

  /** Returns the source of the constants for the shared lists, each after the list it extends. */
  declarations(): string[] {
    const declared: string[] = [];
    const seen = new Set<string>();
    const declare = (name: string): void => {
      const base = this.table.bases.get(name);
      if (seen.has(name) || base === undefined || !this.isShared(name)) return;
      seen.add(name);
      const parent = this.sharedBase(base.base);
      if (parent !== undefined) declare(parent.name);
      const list =
        parent === undefined
          ? base.attributes
          : [new Source(`...${this.constantOf(parent.name)}`), ...base.attributes.slice(parent.count)];
      declared.push(declarationOf(this.constantOf(name), list, { exported: false, used: this.used.has(name) }));
    };
    for (const name of [...this.table.bases.keys()].sort()) declare(name);
    return declared;
  }
}

/** Returns the source of the table module, before formatting. */
export function renderTable(table: Table, schema: { readonly url: string; readonly sha256: string }): string {
  const lists = new ListSharing(table);
  const attributes = new AttributeSharing(table);
  const types = Object.fromEntries(
    [...table.types].map(([name, type]) => [
      name,
      {
        ...attributes.attributes(type.attributes, table.extended.get(name)),
        ...(type.attributeWildcard === undefined ? {} : { attributeWildcard: type.attributeWildcard }),
        ...(type.content.kind === "slots"
          ? { content: { ...type.content, slots: type.content.slots.map((slot) => lists.share(slot)) } }
          : { content: type.content }),
      },
    ]),
  );
  return [
    "// Generated by scripts/asi-table.ts; do not edit.",
    `// Source: ${schema.url} (SHA-256 ${schema.sha256}).`,
    "// biome-ignore-all lint/style/useNamingConvention: The types are named as the schema names them.",
    'import type { TypeDef } from "./table.js";',
    "",
    ...attributes.declarations(),
    ...lists.declarations(),
    "",
    "/** The element types of the ASI schema that the runtime reads and writes, by name. */",
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
 * Generates the source of `packages/runtime/src/asi/element-table.ts` from the pinned ASI schema in the schema cache.
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
