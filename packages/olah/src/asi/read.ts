import { DataError } from "../errors.js";
import { xmlTokens } from "../values/whitespace.js";
import {
  XINCLUDE_NAMESPACE,
  XML_NAMESPACE,
  XMLNS_NAMESPACE,
  type XmlAttribute,
  type XmlElement,
  type XmlNode,
} from "../xml/index.js";
import { parseAttributeValue } from "./attribute-value.js";
import { ASI_NAMESPACE } from "./namespace.js";
import { asiError, type ReadContext } from "./read-error.js";
import type { AttributeDef } from "./table.js";
import { kindOf, type SlotInfo, type TypeInfo, typeNamed } from "./type-index.js";

type Model = Record<string, unknown>;

/**
 * Returns a node as the model keeps it: without the positions that the parser recorded and without namespace
 * declarations, which `serializeXml` adds where an element needs them. Equal content is then equal.
 */
function modelNode(node: XmlNode): XmlNode {
  if (node.kind !== "element") return node;
  const { line: _line, column: _column, ...rest } = node;
  const attributes = node.attributes.filter(({ namespace }) => namespace !== XMLNS_NAMESPACE);
  return { ...rest, attributes, children: node.children.map(modelNode) };
}

function isBlank(text: string): boolean {
  return xmlTokens(text).length === 0;
}

/** Returns the name an attribute has in the table: `xml:lang` for the attribute `lang` of the XML namespace. */
function nameInTable(attribute: XmlAttribute): string | undefined {
  if (attribute.namespace === "") return attribute.name;
  return attribute.namespace === XML_NAMESPACE ? `xml:${attribute.name}` : undefined;
}

function qualifiedName({ prefix, name }: XmlAttribute): string {
  return prefix === undefined ? name : `${prefix}:${name}`;
}

/** Runs a reader of text and turns the `DataError` of a value that is not in its lexical form into a `ReadError`. */
function readText<T>(read: () => T, describeText: string, element: XmlElement, context: ReadContext): T {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    throw asiError(context, element, "olah/asi/invalid-value", `${describeText} is invalid: ${error.message}`);
  }
}

function allowsExtension(wildcard: TypeInfo["def"]["attributeWildcard"], attribute: XmlAttribute): boolean {
  return wildcard !== undefined && (wildcard.namespaces === "any" || attribute.namespace !== "");
}

function readAttribute(
  info: TypeInfo,
  attribute: XmlAttribute,
  element: XmlElement,
  context: ReadContext,
): { readonly definition: AttributeDef; readonly value: unknown } | undefined {
  const name = nameInTable(attribute);
  const definition = name === undefined ? undefined : info.attributes.get(name);
  if (definition === undefined) return undefined;
  const value = readText(
    () => parseAttributeValue(definition.type, attribute.value),
    `The attribute ${definition.name} of ${element.name}`,
    element,
    context,
  );
  return { definition, value };
}

function readAttributes(info: TypeInfo, element: XmlElement, model: Model, context: ReadContext): void {
  const extensions: XmlAttribute[] = [];
  for (const attribute of element.attributes) {
    if (attribute.namespace === XMLNS_NAMESPACE) continue;
    const read = readAttribute(info, attribute, element, context);
    if (read !== undefined) {
      model[read.definition.property] = read.value;
    } else if (allowsExtension(info.def.attributeWildcard, attribute)) {
      extensions.push(attribute);
    } else {
      const message = `The attribute ${qualifiedName(attribute)} is not allowed on ${element.name}.`;
      throw asiError(context, element, "olah/asi/attribute", message);
    }
  }
  const missing = info.def.attributes.find(({ use, property }) => use === "required" && model[property] === undefined);
  if (missing !== undefined) {
    const message = `The element ${element.name} must have the attribute ${missing.name}.`;
    throw asiError(context, element, "olah/asi/missing-attribute", message);
  }
  if (info.def.attributeWildcard !== undefined) model.extensions = extensions;
}

function readTextContent(info: TypeInfo, element: XmlElement, model: Model, context: ReadContext): void {
  if (info.def.content.kind !== "text") throw new Error(`The content of ${info.name} is not text.`);
  const { value: type } = info.def.content;
  const text = element.children
    .map((child) => {
      if (child.kind === "element") {
        const message = `The element ${element.name} must contain text only, found ${child.name}.`;
        throw asiError(context, element, "olah/asi/element", message);
      }
      return child.kind === "text" || child.kind === "cdata" ? child.value : "";
    })
    .join("");
  model.value = readText(() => parseAttributeValue(type, text), `The text of ${element.name}`, element, context);
}

/** Checks the text between the child elements of an element, which must be white space. */
function checkBlank(child: XmlNode, element: XmlElement, context: ReadContext): void {
  if ((child.kind === "text" || child.kind === "cdata") && !isBlank(child.value)) {
    throw asiError(context, element, "olah/asi/text", `The element ${element.name} must not contain text.`);
  }
}

function checkEmpty(element: XmlElement, context: ReadContext): void {
  for (const child of element.children) {
    if (child.kind === "element") {
      const message = `The element ${element.name} must be empty, found ${child.name}.`;
      throw asiError(context, element, "olah/asi/element", message);
    }
    checkBlank(child, element, context);
  }
}

/** Returns the slot that accepts a child element, or `undefined` when the child goes to the wildcard or nowhere. */
function slotOf(info: TypeInfo, child: XmlElement): SlotInfo | undefined {
  if (child.namespace === ASI_NAMESPACE) return info.slotOfElement.get(child.name);
  return child.namespace === XINCLUDE_NAMESPACE && child.name === "include" ? info.includeSlot : undefined;
}

function readMember(slot: SlotInfo, child: XmlElement, context: ReadContext): unknown {
  const accept = child.namespace === ASI_NAMESPACE ? slot.byElement.get(child.name) : undefined;
  return accept === undefined ? modelNode(child) : readElement(typeNamed(accept.type), child, context);
}

/** Stores the members found for a slot in the model, checking how many there are. */
function storeSlot(
  slot: SlotInfo,
  members: readonly unknown[],
  element: XmlElement,
  model: Model,
  context: ReadContext,
): void {
  const { property, min, max } = slot.def;
  const fail = (code: string, message: string) => asiError(context, element, `olah/asi/${code}`, message);
  if (max === 1) {
    if (members.length > 1)
      throw fail("element", `The element ${element.name} may have one ${property}, found ${members.length}.`);
    if (members.length === 0 && min === 1)
      throw fail("missing-element", `The element ${element.name} must have a ${property}.`);
    if (members.length === 1) model[property] = members[0];
    return;
  }
  if (max !== "unbounded" && members.length > max) {
    throw fail("element", `The element ${element.name} may have ${max} ${property}, found ${members.length}.`);
  }
  model[property] = members;
}

function checkExclusions(
  info: TypeInfo,
  element: XmlElement,
  found: ReadonlyMap<SlotInfo, readonly unknown[]>,
  context: ReadContext,
): void {
  const present = new Set([...found].filter(([, members]) => members.length > 0).map(([slot]) => slot.def.property));
  for (const property of present) {
    const slot = info.slots.find((candidate) => candidate.def.property === property);
    const clash = slot?.def.excludes?.find((other) => present.has(other));
    if (clash !== undefined) {
      const message = `The element ${element.name} cannot have both ${property} and ${clash}.`;
      throw asiError(context, element, "olah/asi/exclusive", message);
    }
  }
}

function readSlots(info: TypeInfo, element: XmlElement, model: Model, context: ReadContext): void {
  const found = new Map<SlotInfo, unknown[]>();
  const foreign: XmlElement[] = [];
  const wildcard = info.def.content.kind === "slots" && info.def.content.wildcard !== undefined;
  for (const child of element.children) {
    if (child.kind !== "element") {
      checkBlank(child, element, context);
      continue;
    }
    const slot = slotOf(info, child);
    if (slot !== undefined) found.set(slot, [...(found.get(slot) ?? []), readMember(slot, child, context)]);
    else if (wildcard && child.namespace !== ASI_NAMESPACE) foreign.push(child);
    else
      throw asiError(
        context,
        element,
        "olah/asi/element",
        `The element ${element.name} cannot contain ${child.name} here.`,
      );
  }
  for (const slot of info.slots) storeSlot(slot, found.get(slot) ?? [], element, model, context);
  checkExclusions(info, element, found, context);
  if (wildcard) model.extensionElements = foreign.map(modelNode);
}

/**
 * Reads an element as the model of a type of the table. The root of a document and every child element go through it.
 * It does not check the order of child elements, which the schema fixes, or the minimum of a list.
 *
 * @param info - The type of the element.
 * @param element - The element.
 * @param context - Where the reader is.
 * @throws `ReadError` when the element has an attribute, child element or text the type does not allow, lacks a
 * required attribute or child element, or has a value that is not in its lexical form.
 */
export function readElement(info: TypeInfo, element: XmlElement, context: ReadContext): Model {
  context.trail.push(element.name);
  const model: Model = { kind: kindOf(element.name) };
  readAttributes(info, element, model, context);
  switch (info.def.content.kind) {
    case "empty":
      checkEmpty(element, context);
      break;
    case "text":
      readTextContent(info, element, model, context);
      break;
    case "flow":
      model.children = element.children.map(modelNode);
      break;
    case "slots":
      readSlots(info, element, model, context);
      break;
  }
  context.trail.pop();
  return model;
}
