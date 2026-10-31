import { ASI_NAMESPACE } from "../src/asi/index.js";
import { DOCUMENT_ELEMENTS, ELEMENT_TYPES, EXPRESSION, NUMERIC_EXPRESSION, type TypeDef } from "../src/asi/internal.js";
import { type Names, nameOf } from "./schema-declarations.js";

/** What the element table, which `scripts/asi-table.ts` generates from the ASI schema, says the schema declares. */
export interface TableNames {
  /** The elements, and for each the attributes that its own type adds, named as `declaredNames` names them. */
  readonly declared: Names;
  /** The attributes that many types share, such as the `aria-*` attributes: each must be used on some element. */
  readonly shared: readonly string[];
  /** The namespaces of the MathML and SSML elements that the content may hold. */
  readonly foreignNamespaces: readonly string[];
}

/** The types of the table by name. */
const TYPES: Readonly<Record<string, TypeDef>> = ELEMENT_TYPES;

/** Returns the element names of the ASI namespace with the names of their types: the documents and everything a slot accepts. */
function elementTypes(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const add = (element: string, type: string): void => {
    found.set(element, (found.get(element) ?? new Set()).add(type));
  };
  for (const [element, type] of Object.entries(DOCUMENT_ELEMENTS)) add(element, type);
  for (const { content } of Object.values(TYPES)) {
    if (content.kind !== "slots") continue;
    for (const { accepts } of content.slots) for (const { element, type } of accepts) add(element, type);
  }
  return found;
}

/** Reads the elements and attributes that the element table declares. */
export function tableNames(): TableNames {
  const declared = new Set<string>();
  const shared = new Set<string>();
  const foreign = new Set<string>();
  for (const [element, types] of elementTypes()) {
    declared.add(nameOf(ASI_NAMESPACE, element));
    for (const type of types) {
      for (const { name } of TYPES[type]?.attributes ?? []) declared.add(nameOf(ASI_NAMESPACE, element, name));
      for (const { name } of TYPES[type]?.inherited ?? []) shared.add(name);
    }
  }
  for (const { content } of Object.values(TYPES)) {
    if (content.kind !== "slots") continue;
    for (const slot of content.slots) {
      for (const { namespace, element } of slot.foreign ?? []) {
        declared.add(nameOf(namespace, element));
        foreign.add(namespace);
      }
    }
  }
  return { declared, shared: [...shared].sort(), foreignNamespaces: [...foreign] };
}

/** Returns the `kind` of every interaction that the schema declares: its element name without `qti-`, sorted. */
export function interactionKinds(): string[] {
  return [...elementTypes().keys()]
    .filter((element) => element.endsWith("-interaction"))
    .map((element) => element.replace(/^qti-/, ""))
    .sort();
}

/** Returns the `kind` of every expression that the schema declares, operators and leaves alike: its element name without `qti-`, sorted. */
export function expressionKinds(): string[] {
  return [...new Set([...EXPRESSION, ...NUMERIC_EXPRESSION].map(({ element }) => element.replace(/^qti-/, "")))].sort();
}
