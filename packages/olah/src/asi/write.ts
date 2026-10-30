import { describe, isRecord } from "../checks.js";
import { DataError } from "../errors.js";
import { XINCLUDE_NAMESPACE, XML_NAMESPACE, type XmlAttribute, type XmlElement, type XmlNode } from "../xml/index.js";
import { formatAttributeValue } from "./attribute-value.js";
import { isAttribute, isElement } from "./guards.js";
import { ASI_NAMESPACE } from "./namespace.js";
import type { AttributeDef, Wildcard } from "./table.js";
import { foreignName, kindOf, type SlotInfo, type TypeInfo, typeNamed } from "./type-index.js";

type Properties = Readonly<Record<string, unknown>>;

/** Returns the attribute of a document for the text of a definition: `xml:lang` is `lang` of the XML namespace. */
function toAttribute(definition: AttributeDef, value: string): XmlAttribute {
  return definition.name.startsWith("xml:")
    ? { namespace: XML_NAMESPACE, prefix: "xml", name: definition.name.slice("xml:".length), value }
    : { namespace: "", name: definition.name, value };
}

/** Writes models as elements, checking each as it goes. */
class Writer {
  private readonly trail: string[] = [];

  private fail(message: string): DataError {
    return new DataError(this.trail.length === 0 ? message : `${message} It is in ${this.trail.join("/")}.`);
  }

  private array(value: unknown, message: string): readonly unknown[] {
    if (!Array.isArray(value)) throw this.fail(`${message}, found ${describe(value)}.`);
    return value;
  }

  private record(value: unknown, message: string): Properties {
    if (!isRecord(value)) throw this.fail(`${message}, found ${describe(value)}.`);
    return value;
  }

  private checkProperties(info: TypeInfo, name: string, model: Properties): void {
    const kind = kindOf(name);
    if (model.kind !== kind)
      throw this.fail(`The kind of ${name} must be ${JSON.stringify(kind)}, found ${describe(model.kind)}.`);
    for (const key of Object.keys(model)) {
      if (key !== "kind" && !info.properties.has(key)) {
        throw this.fail(`The property ${JSON.stringify(key)} does not belong to ${name}.`);
      }
    }
  }

  private writeAttributes(info: TypeInfo, name: string, model: Properties): XmlAttribute[] {
    const attributes: XmlAttribute[] = [];
    for (const definition of info.attributeList) {
      const value = model[definition.property];
      if (value === undefined) {
        if (definition.use === "required")
          throw this.fail(`The property ${definition.property} of ${name} is required.`);
        continue;
      }
      try {
        attributes.push(toAttribute(definition, formatAttributeValue(definition.type, value)));
      } catch (error) {
        if (!(error instanceof DataError)) throw error;
        throw this.fail(`The property ${definition.property} of ${name} is invalid: ${error.message}`);
      }
    }
    if (info.def.attributeWildcard !== undefined) attributes.push(...this.writeExtensions(info, name, model));
    return attributes;
  }

  private writeExtensions(info: TypeInfo, name: string, model: Properties): XmlAttribute[] {
    const extensions = this.array(model.extensions, `The property extensions of ${name} must be an array`);
    return extensions.map((extension) => {
      if (!isAttribute(extension)) {
        throw this.fail(
          `An extension attribute of ${name} must have a namespace, name and value, found ${describe(extension)}.`,
        );
      }
      if (info.def.attributeWildcard?.namespaces === "other" && extension.namespace === "") {
        throw this.fail(`The extension attribute ${extension.name} of ${name} must be in a namespace.`);
      }
      return extension;
    });
  }

  private writeText(info: TypeInfo, name: string, model: Properties): XmlNode[] {
    if (info.def.content.kind !== "text") throw new Error("The content of the type is not text.");
    if (model.value === undefined) throw this.fail(`The property value of ${name} is required.`);
    try {
      const text = formatAttributeValue(info.def.content.value, model.value);
      return text === "" ? [] : [{ kind: "text", value: text }];
    } catch (error) {
      if (!(error instanceof DataError)) throw error;
      throw this.fail(`The property value of ${name} is invalid: ${error.message}`);
    }
  }

  private writeMember(slot: SlotInfo, name: string, member: unknown): XmlNode {
    const properties = this.record(member, `A member of ${slot.def.property} of ${name} must be an object`);
    if (properties.kind === "text") return this.writeTextNode(slot, name, properties);
    if (isElement(member)) return this.writeVerbatim(slot, name, member);
    const accept = typeof properties.kind === "string" ? slot.byKind.get(properties.kind) : undefined;
    if (accept === undefined) {
      const kinds = [...slot.byKind.keys(), ...(slot.def.text === true ? ["text"] : [])]
        .map((kind) => JSON.stringify(kind))
        .join(", ");
      throw this.fail(
        `A member of ${slot.def.property} of ${name} must have the kind ${kinds}, found ${describe(properties.kind)}.`,
      );
    }
    return this.writeElement(typeNamed(accept.type), accept.element, properties);
  }

  /** Writes the text of a slot that takes text. */
  private writeTextNode(slot: SlotInfo, name: string, member: Properties): XmlNode {
    if (slot.def.text !== true) throw this.fail(`The property ${slot.def.property} of ${name} does not take text.`);
    if (typeof member.value !== "string")
      throw this.fail(
        `The value of a text in ${slot.def.property} of ${name} must be a string, found ${describe(member.value)}.`,
      );
    return { kind: "text", value: member.value };
  }

  /** Writes an element that the model keeps as XML: an `xi:include`, or MathML or SSML. */
  private writeVerbatim(slot: SlotInfo, name: string, element: XmlElement): XmlElement {
    const isInclude = element.namespace === XINCLUDE_NAMESPACE && element.name === "include";
    const accepted = isInclude
      ? slot.def.include === true
      : slot.foreign.has(foreignName(element.namespace, element.name));
    if (!accepted) {
      const what = isInclude ? "xi:include" : `the element ${element.name}`;
      throw this.fail(`The property ${slot.def.property} of ${name} does not accept ${what}.`);
    }
    return element;
  }

  private writeSlot(slot: SlotInfo, name: string, model: Properties): XmlNode[] {
    const { property, min, max } = slot.def;
    const value = model[property];
    if (max === 1) {
      if (value !== undefined) return [this.writeMember(slot, name, value)];
      if (min === 1) throw this.fail(`The property ${property} of ${name} is required.`);
      return [];
    }
    const members = this.array(value, `The property ${property} of ${name} must be an array`);
    if (max !== "unbounded" && members.length > max) {
      throw this.fail(`The property ${property} of ${name} may have ${max} members, found ${members.length}.`);
    }
    return members.map((member) => this.writeMember(slot, name, member));
  }

  private checkExclusions(info: TypeInfo, name: string, present: ReadonlySet<string>): void {
    for (const slot of info.slots) {
      const clash = slot.def.excludes?.find((other) => present.has(other));
      if (present.has(slot.def.property) && clash !== undefined) {
        throw this.fail(`The element ${name} cannot have both ${slot.def.property} and ${clash}.`);
      }
    }
  }

  private writeForeign(name: string, wildcard: Wildcard, model: Properties): XmlElement[] {
    const foreign = this.array(model.extensionElements, `The property extensionElements of ${name} must be an array`);
    return foreign.map((element) => {
      if (!isElement(element) || (wildcard.namespaces === "other" && element.namespace === ASI_NAMESPACE)) {
        const expected = wildcard.namespaces === "other" ? "an element of another namespace" : "an element";
        throw this.fail(`A member of extensionElements of ${name} must be ${expected}, found ${describe(element)}.`);
      }
      return element;
    });
  }

  private writeSlots(info: TypeInfo, name: string, model: Properties): XmlNode[] {
    const present = new Set<string>();
    const children: XmlNode[] = [];
    for (const slot of info.slots) {
      const written = this.writeSlot(slot, name, model);
      if (written.length > 0) present.add(slot.def.property);
      children.push(...written);
    }
    this.checkExclusions(info, name, present);
    if (info.def.content.kind === "slots" && info.def.content.wildcard !== undefined) {
      children.push(...this.writeForeign(name, info.def.content.wildcard, model));
    }
    return children;
  }

  private writeContent(info: TypeInfo, name: string, model: Properties): XmlNode[] {
    switch (info.def.content.kind) {
      case "empty":
        return [];
      case "text":
        return this.writeText(info, name, model);
      case "slots":
        return this.writeSlots(info, name, model);
    }
  }

  /** Writes the model of an element of a type of the table. */
  writeElement(info: TypeInfo, name: string, model: unknown): XmlElement {
    this.trail.push(name);
    const properties = this.record(model, `The model of ${name} must be an object`);
    this.checkProperties(info, name, properties);
    const attributes = this.writeAttributes(info, name, properties);
    const children = this.writeContent(info, name, properties);
    this.trail.pop();
    return { kind: "element", namespace: ASI_NAMESPACE, name, attributes, children };
  }
}

/**
 * Writes the model of an element as an XML element in the ASI namespace. Attributes are in schema order, then the
 * extension attributes; child elements are in schema order, then the elements of other namespaces.
 *
 * @param info - The type of the element.
 * @param name - The element name, such as `qti-assessment-item`.
 * @param model - The model.
 * @throws `DataError` when the model is not an object of the kind of the element, has a property the type does not have,
 * lacks a required property, or has a property of the wrong type or in the wrong form.
 */
export function writeElement(info: TypeInfo, name: string, model: unknown): XmlElement {
  return new Writer().writeElement(info, name, model);
}
