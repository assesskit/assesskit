import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseXml, XML_NAMESPACE, type XmlElement } from "../src/xml/index.js";
import { XMLNS_NAMESPACE } from "../src/xml/internal.js";

const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema";

/**
 * The limits for reading an official schema, which is not a document of QTI: the ASI schema has 18.8 MB of text, most of it
 * documentation, and 55,580 nodes. Its hash is pinned, so it is not untrusted input.
 */
export const SCHEMA_LIMITS = { maxBytes: 32 * 1024 * 1024 } as const;

/** The elements and attributes that schemas declare, or that documents use: `name` for an element, `name@attribute` for an attribute. */
export type Names = ReadonlySet<string>;

/** Returns the child elements of an element. */
const elementsOf = (element: XmlElement): XmlElement[] => element.children.filter((child) => child.kind === "element");

/** Returns the value of an attribute without a namespace, or `undefined`. */
const attributeOf = (element: XmlElement, name: string): string | undefined =>
  element.attributes.find((attribute) => attribute.namespace === "" && attribute.name === name)?.value;

/** Returns the local part of a name that may have a prefix, such as `xs:string`. */
const localPart = (name: string): string => name.slice(name.indexOf(":") + 1);

/** Names an element by its namespace and its name, and an attribute of it by the name of the attribute after an `@`. */
export function nameOf(namespace: string, element: string, attribute?: string): string {
  return `{${namespace}}${element}${attribute === undefined ? "" : `@${attribute}`}`;
}

/** One schema file, read: its target namespace, its named types, and every element declaration in it. */
interface Schema {
  readonly namespace: string;
  readonly types: ReadonlyMap<string, XmlElement>;
  readonly declarations: readonly XmlElement[];
}

function readSchema(text: string): Schema {
  const root = parseXml(text, { limits: SCHEMA_LIMITS });
  const types = new Map<string, XmlElement>();
  const declarations: XmlElement[] = [];
  const visit = (element: XmlElement): void => {
    if (element.namespace === XSD_NAMESPACE) {
      const name = attributeOf(element, "name");
      if (element.name === "element" && name !== undefined) declarations.push(element);
      if (element.name === "complexType" && name !== undefined) types.set(name, element);
    }
    for (const child of elementsOf(element)) visit(child);
  };
  visit(root);
  return { namespace: attributeOf(root, "targetNamespace") ?? "", types, declarations };
}

/**
 * Collects the attributes that a complex type declares itself, in its extensions, and in the type it extends: the
 * attributes of the nodes below the type, but not those of the elements it declares, which have types of their own.
 */
function attributesOfType(type: XmlElement, schemas: readonly Schema[], home: Schema, found: Set<string>): void {
  const visit = (node: XmlElement): void => {
    for (const child of elementsOf(node)) {
      if (child.namespace !== XSD_NAMESPACE || child.name === "element") continue;
      const name = attributeOf(child, "name") ?? attributeOf(child, "ref");
      if (child.name === "attribute" && name !== undefined) found.add(name);
      const base = attributeOf(child, "base");
      if (child.name === "extension" && base !== undefined) attributesOfNamedType(base, schemas, home, found);
      visit(child);
    }
  };
  visit(type);
}

/** Collects the attributes of the named complex type, looking in the schema of the declaration first. */
function attributesOfNamedType(name: string, schemas: readonly Schema[], home: Schema, found: Set<string>): void {
  const local = localPart(name);
  const type = home.types.get(local) ?? schemas.map((schema) => schema.types.get(local)).find(Boolean);
  if (type !== undefined) attributesOfType(type, schemas, home, found);
}

/**
 * Returns what the schemas declare: every element, and every attribute that an element takes. Wildcards declare
 * nothing; the type of an element is the one it names or the one it holds, and the elements that other elements refer
 * to are found in the schema that declares them.
 *
 * @param files - The schema files, such as `imsqti_resultv3p0_v1p0.xsd`, below the directory.
 */
export function declaredNames(directory: string, files: readonly string[]): Names {
  const schemas = files.map((file) => readSchema(readFileSync(join(directory, file), "utf8")));
  const names = new Set<string>();
  for (const schema of schemas) {
    for (const declaration of schema.declarations) {
      const name = attributeOf(declaration, "name") ?? "";
      names.add(nameOf(schema.namespace, name));
      const attributes = new Set<string>();
      const typeName = attributeOf(declaration, "type");
      const inline = elementsOf(declaration).find(({ name: kind }) => kind === "complexType");
      if (typeName !== undefined) attributesOfNamedType(typeName, schemas, schema, attributes);
      if (inline !== undefined) attributesOfType(inline, schemas, schema, attributes);
      for (const attribute of attributes) names.add(nameOf(schema.namespace, name, attribute));
    }
  }
  return names;
}

/** Returns the elements and attributes that documents use, named as {@link declaredNames} names them. */
export function usedNames(documents: readonly string[], namespaces: readonly string[]): Names {
  const names = new Set<string>();
  const visit = (element: XmlElement): void => {
    if (namespaces.includes(element.namespace)) {
      names.add(nameOf(element.namespace, element.name));
      for (const attribute of element.attributes) {
        if (attribute.namespace === XMLNS_NAMESPACE || (attribute.prefix === undefined && attribute.name === "xmlns"))
          continue;
        names.add(
          nameOf(
            element.namespace,
            element.name,
            attribute.namespace === XML_NAMESPACE ? `xml:${attribute.name}` : attribute.name,
          ),
        );
      }
    }
    for (const child of elementsOf(element)) visit(child);
  };
  for (const document of documents) visit(parseXml(document));
  return names;
}

/** Returns the names that the schemas declare and no document uses, sorted. */
export function unusedNames(declared: Names, used: Names): string[] {
  return [...declared].filter((name) => !used.has(name)).sort();
}

/** Returns the attributes, of those that many elements share, that no element of the documents has. */
export function unusedSharedAttributes(shared: readonly string[], used: Names): string[] {
  return shared.filter((attribute) => ![...used].some((name) => name.endsWith(`@${attribute}`)));
}
