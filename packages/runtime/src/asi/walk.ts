import { describe, isRecord } from "../checks.js";
import { DataError } from "../errors.js";
import type { XmlElement } from "../xml/index.js";
import { isElement } from "./guards.js";
import type { AttributeDef } from "./table.js";
import { type SlotInfo, type TypeInfo, typeNamed } from "./type-index.js";

/** An element of a document, as {@link walkDocument} visits it. */
export interface ElementVisit {
  /** The name of the element as a document writes it, such as `qti-label`; the HTML element `label` differs from it. */
  readonly name: string;
  /** The model of the element, whose properties the schema gives it. */
  readonly model: Readonly<Record<string, unknown>>;
  /** The attributes the schema gives the element, those it inherits first, in schema order. */
  readonly attributes: readonly AttributeDef[];
  /**
   * The attributes beyond its own that the schema allows, which `model.extensions` holds: those with any name
   * (`any`), those in a namespace (`other`), or none (absent).
   */
  readonly attributeWildcard: "any" | "other" | undefined;
  /** The elements that the model keeps as XML: MathML, SSML, `xi:include`, and the elements of a schema wildcard. */
  readonly foreign: readonly XmlElement[];
  /** The element that holds this one; absent for the root. */
  readonly parent: ElementVisit | undefined;
}

/** A model member that is an element of the schema, with the type of its element. */
interface Child {
  readonly info: TypeInfo;
  readonly name: string;
  readonly model: Readonly<Record<string, unknown>>;
}

/** Returns the error of a model at a place in the document, naming the path of the element. */
function fail(parent: ElementVisit | undefined, name: string, message: string): DataError {
  const names = [name];
  for (let at = parent; at !== undefined; at = at.parent) names.unshift(at.name);
  return new DataError(`${message} It is in ${names.join("/")}.`);
}

/** Returns the members of a slot: the one member of a slot of at most one, or the array of the others. */
function membersOf(slot: SlotInfo, at: ElementVisit): readonly unknown[] {
  const { property, max } = slot.def;
  const value = at.model[property];
  if (max === 1) return value === undefined ? [] : [value];
  if (Array.isArray(value)) return value;
  const message = `The property ${property} of ${at.name} must be an array, found ${describe(value)}.`;
  throw fail(at.parent, at.name, message);
}

/** Sorts the members of a slot into elements of the schema and elements that the model keeps as XML. */
function sortSlot(slot: SlotInfo, at: ElementVisit, children: Child[], foreign: XmlElement[]): void {
  const { property } = slot.def;
  for (const member of membersOf(slot, at)) {
    if (!isRecord(member)) {
      const message = `A member of ${property} of ${at.name} must be an object, found ${describe(member)}.`;
      throw fail(at.parent, at.name, message);
    }
    if (member.kind === "text") continue;
    if (isElement(member)) {
      foreign.push(member);
      continue;
    }
    const accept = typeof member.kind === "string" ? slot.byKind.get(member.kind) : undefined;
    if (accept === undefined) {
      const message = `A member of ${property} of ${at.name} has the kind ${describe(member.kind)}, which the property does not accept.`;
      throw fail(at.parent, at.name, message);
    }
    children.push({ info: typeNamed(accept.type), name: accept.element, model: member });
  }
}

/** Walks the models of a document in document order, checking the shape of each as it goes. */
function walkFrom(
  info: TypeInfo,
  name: string,
  model: unknown,
  parent: ElementVisit | undefined,
  visit: (element: ElementVisit) => void,
): void {
  if (!isRecord(model)) {
    throw fail(parent, name, `The model of ${name} must be an object, found ${describe(model)}.`);
  }
  const foreign: XmlElement[] = [];
  const children: Child[] = [];
  const at: ElementVisit = {
    name,
    model,
    attributes: info.attributeList,
    attributeWildcard: info.def.attributeWildcard?.namespaces,
    foreign,
    parent,
  };
  for (const slot of info.slots) sortSlot(slot, at, children, foreign);
  if (info.def.content.kind === "slots" && info.def.content.wildcard !== undefined) {
    const extra = model.extensionElements;
    if (!Array.isArray(extra)) {
      const message = `The property extensionElements of ${name} must be an array, found ${describe(extra)}.`;
      throw fail(parent, name, message);
    }
    for (const element of extra) if (isElement(element)) foreign.push(element);
  }
  visit(at);
  for (const child of children) walkFrom(child.info, child.name, child.model, at, visit);
}

/**
 * Walks the elements of the model of one element in the order of the schema, the element before its children, and calls
 * `visit` for each: the type-directed traversal that `writeAsi` makes, without writing. The name, the attribute
 * definitions with their types and formats, and the parent let a check tell apart elements that the model's `kind` does
 * not: the HTML `label` and `qti-label` share the kind `label`.
 *
 * @param info - The type of the root element.
 * @param name - The name of the root element.
 * @param model - The root's model.
 * @param visit - The function to call.
 * @throws `DataError` when a model is not an object of the shape the schema gives it: a property that should hold an
 * array does not, or a member has a kind the property does not accept.
 */
export function walkElement(
  info: TypeInfo,
  name: string,
  model: unknown,
  visit: (element: ElementVisit) => void,
): void {
  walkFrom(info, name, model, undefined, visit);
}
