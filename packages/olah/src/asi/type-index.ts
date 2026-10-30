import { ELEMENT_TYPES } from "./element-table.js";
import type { AcceptDef, AttributeDef, SlotDef, TypeDef } from "./table.js";

/** A slot with the lookups that the reader and the writer make. */
export interface SlotInfo {
  /** The slot as the table has it. */
  readonly def: SlotDef;
  /** The elements it accepts, by element name. */
  readonly byElement: ReadonlyMap<string, AcceptDef>;
  /** The elements it accepts, by the `kind` of their model. */
  readonly byKind: ReadonlyMap<string, AcceptDef>;
  /** The elements of other namespaces it accepts, by {@link foreignName}. */
  readonly foreign: ReadonlySet<string>;
}

/** An element type with the lookups that the reader and the writer make. */
export interface TypeInfo {
  /** The name of the type in the table. */
  readonly name: string;
  /** The type as the table has it. */
  readonly def: TypeDef;
  /** All the attributes in schema order: those it inherits, then its own. */
  readonly attributeList: readonly AttributeDef[];
  /** The attributes by name as written. */
  readonly attributes: ReadonlyMap<string, AttributeDef>;
  /** The slots in schema order; empty for a type without child elements. */
  readonly slots: readonly SlotInfo[];
  /** The slot that accepts each element of the ASI namespace. */
  readonly slotOfElement: ReadonlyMap<string, SlotInfo>;
  /** The slot that accepts each element of another namespace, by {@link foreignName}. */
  readonly slotOfForeign: ReadonlyMap<string, SlotInfo>;
  /** The slot that takes text, if there is one. */
  readonly textSlot: SlotInfo | undefined;
  /** The slot that accepts `xi:include`, if there is one. */
  readonly includeSlot: SlotInfo | undefined;
  /** The properties of the model besides `kind`: those that attributes, slots and content give. */
  readonly properties: ReadonlySet<string>;
}

const QTI_PREFIX = "qti-";

/** Returns the `kind` of the model of an element: its name without the `qti-` prefix. */
export function kindOf(element: string): string {
  return element.startsWith(QTI_PREFIX) ? element.slice(QTI_PREFIX.length) : element;
}

/** Returns the name of an element of another namespace as one string: `{namespace}name`. */
export function foreignName(namespace: string, name: string): string {
  return `{${namespace}}${name}`;
}

function indexSlot(def: SlotDef): SlotInfo {
  return {
    def,
    byElement: new Map(def.accepts.map((accept) => [accept.element, accept])),
    byKind: new Map(def.accepts.map((accept) => [kindOf(accept.element), accept])),
    foreign: new Set((def.foreign ?? []).map(({ namespace, element }) => foreignName(namespace, element))),
  };
}

function indexType(name: string, def: TypeDef): TypeInfo {
  const slots = def.content.kind === "slots" ? def.content.slots.map(indexSlot) : [];
  const attributeList = [...(def.inherited ?? []), ...def.attributes];
  const properties = new Set<string>(attributeList.map(({ property }) => property));
  for (const slot of slots) properties.add(slot.def.property);
  if (def.attributeWildcard !== undefined) properties.add("extensions");
  if (def.content.kind === "slots" && def.content.wildcard) properties.add("extensionElements");
  if (def.content.kind === "text") properties.add("value");
  return {
    name,
    def,
    attributeList,
    attributes: new Map(attributeList.map((attribute) => [attribute.name, attribute])),
    slots,
    slotOfElement: new Map(slots.flatMap((slot) => slot.def.accepts.map((accept) => [accept.element, slot] as const))),
    slotOfForeign: new Map(slots.flatMap((slot) => [...slot.foreign].map((name) => [name, slot] as const))),
    textSlot: slots.find((slot) => slot.def.text),
    includeSlot: slots.find((slot) => slot.def.include),
    properties,
  };
}

/** The element types of the table with their lookups, by name. */
const TYPE_INDEX: ReadonlyMap<string, TypeInfo> = new Map(
  Object.entries<TypeDef>(ELEMENT_TYPES).map(([name, def]) => [name, indexType(name, def)]),
);

/**
 * Returns the type of the table by name.
 *
 * @throws `Error` when the table has no such type, which only a table that is not consistent with itself causes.
 */
export function typeNamed(name: string): TypeInfo {
  const info = TYPE_INDEX.get(name);
  if (info === undefined) throw new Error(`The element table has no type ${name}.`);
  return info;
}
