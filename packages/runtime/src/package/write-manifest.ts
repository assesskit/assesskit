import { NC_NAME_RE } from "xmlchars/xmlns/1.0/ed3.js";
import { checkArray, checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import {
  CP_NAMESPACE,
  CSM_NAMESPACE,
  DRD_NAMESPACE,
  LOM_NAMESPACE,
  QTI_METADATA_NAMESPACE,
  writeAccessForAllResource,
  writeCurriculumStandardsSet,
  writeResourceMetadata,
} from "../metadata/index.js";
import {
  buildElement,
  type ElementAttributes,
  serializeXml,
  XMLNS_NAMESPACE,
  type XmlAttribute,
  type XmlElement,
  type XmlNode,
} from "../xml/index.js";
import {
  CPX_NAMESPACE,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_SCHEMAS,
  type Manifest,
  RESOURCE_TYPES,
  type Resource,
  type Variant,
} from "./manifest.js";

/** The prefixes the writer gives the namespaces other than the content package namespace, which is the default. */
const PREFIXES: ReadonlyMap<string, string> = new Map([
  [QTI_METADATA_NAMESPACE, "qmd"],
  [CSM_NAMESPACE, "csmd"],
  [DRD_NAMESPACE, "drd"],
  [CPX_NAMESPACE, "cpx"],
]);

type Children = readonly (XmlElement | string)[];

function cp(name: string, children: Children = [], attributes: ElementAttributes = {}): XmlElement {
  return buildElement(CP_NAMESPACE, name, attributes, children);
}

function cpx(name: string, children: Children, attributes: ElementAttributes = {}): XmlElement {
  return { ...buildElement(CPX_NAMESPACE, name, attributes, children), prefix: "cpx" };
}

function checkIdentifier(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  if (!NC_NAME_RE.test(value)) {
    throw new DataError(`${label} must be an XML name without a colon, found ${describe(value)}.`);
  }
}

function checkOptionalString(value: unknown, label: string): void {
  if (value !== undefined) checkString(value, label);
}

/** Collects the namespaces of the prefixed elements of a tree, so that the root can declare them once. */
function declarations(node: XmlNode, used: Set<string>): void {
  if (node.kind !== "element") return;
  if (PREFIXES.has(node.namespace)) used.add(node.namespace);
  for (const child of node.children) declarations(child, used);
}

function writeVariant(variant: Variant, resourceIds: ReadonlySet<string>): XmlElement {
  checkRecord(variant, "A variant must be an object");
  checkIdentifier(variant.identifier, "The identifier of a variant");
  checkString(variant.identifierref, "The identifierref of a variant");
  if (!resourceIds.has(variant.identifierref)) {
    throw new DataError(
      `The variant ${variant.identifier} links to ${describe(variant.identifierref)}, which is no resource of the manifest.`,
    );
  }
  const drd = writeAccessForAllResource(variant.drd);
  return cpx("variant", [cpx("metadata", [drd])], {
    identifier: variant.identifier,
    identifierref: variant.identifierref,
  });
}

function writeResource(resource: Resource, resourceIds: ReadonlySet<string>): XmlElement {
  checkRecord(resource, "A resource must be an object");
  const { identifier, type, href, base: resourceBase, metadata, files, dependencies, variants } = resource;
  checkIdentifier(identifier, "The identifier of a resource");
  if (!RESOURCE_TYPES.some((candidate) => candidate === type)) {
    throw new DataError(
      `The type of the resource ${identifier} must be one of ${RESOURCE_TYPES.join(", ")}, found ${describe(type)}.`,
    );
  }
  checkOptionalString(href, `The href of the resource ${identifier}`);
  checkOptionalString(resourceBase, `The base of the resource ${identifier}`);
  checkArray(files, `The files of the resource ${identifier} must be an array`);
  if (files.length === 0) throw new DataError(`The resource ${identifier} must list at least one file.`);
  checkArray(dependencies, `The dependencies of the resource ${identifier} must be an array`);
  checkArray(variants, `The variants of the resource ${identifier} must be an array`);
  const children: XmlElement[] = [];
  if (metadata !== undefined) children.push(writeResourceMetadata(metadata));
  for (const file of files) {
    checkRecord(file, "A file must be an object");
    checkString(file.href, `The href of a file of the resource ${identifier}`);
    if (file.metadata !== undefined) checkArray(file.metadata, "The metadata of a file must be an array");
    children.push(cp("file", file.metadata === undefined ? [] : [cp("metadata", file.metadata)], { href: file.href }));
  }
  for (const dependency of dependencies) {
    checkString(dependency, `A dependency of the resource ${identifier}`);
    if (!resourceIds.has(dependency)) {
      throw new DataError(
        `The resource ${identifier} depends on ${describe(dependency)}, which is no resource of the manifest.`,
      );
    }
    children.push(cp("dependency", [], { identifierref: dependency }));
  }
  for (const variant of variants) children.push(writeVariant(variant, resourceIds));
  return cp("resource", children, { identifier, type, href, "xml:base": resourceBase });
}

function writeMetadata(manifest: Manifest): XmlElement {
  checkRecord(manifest.metadata, "The metadata of a manifest must be an object");
  const { schema, curriculumStandards, lom } = manifest.metadata;
  if (!MANIFEST_SCHEMAS.some((candidate) => candidate === schema)) {
    throw new DataError(
      `The schema of a manifest must be one of ${MANIFEST_SCHEMAS.join(", ")}, found ${describe(schema)}.`,
    );
  }
  const children: XmlElement[] = [cp("schema", [schema]), cp("schemaversion", [MANIFEST_SCHEMA_VERSION])];
  if (curriculumStandards !== undefined) children.push(writeCurriculumStandardsSet(curriculumStandards));
  if (lom !== undefined) {
    checkRecord(lom, "The lom of a manifest must be an element");
    if (lom.namespace !== LOM_NAMESPACE || lom.name !== "lom") {
      throw new DataError(
        `The lom of a manifest must be a lom element of the namespace ${LOM_NAMESPACE}, found ${lom.name}.`,
      );
    }
    children.push(lom);
  }
  return cp("metadata", children);
}

/**
 * Checks the identifiers of a manifest: XML names, each declared once (xs:ID). Returns those of the resources, which the
 * dependencies and variants refer to.
 */
function checkIdentifiers(manifest: Manifest): ReadonlySet<string> {
  checkIdentifier(manifest.identifier, "The identifier of the manifest");
  checkArray(manifest.resources, "The resources of the manifest must be an array");
  const declared = new Set<string>();
  const claim = (identifier: string): void => {
    if (declared.has(identifier))
      throw new DataError(`The identifier ${describe(identifier)} is used twice in the manifest.`);
    declared.add(identifier);
  };
  claim(manifest.identifier);
  const resourceIds = new Set<string>();
  for (const resource of manifest.resources) {
    checkRecord(resource, "A resource must be an object");
    checkIdentifier(resource.identifier, "The identifier of a resource");
    claim(resource.identifier);
    resourceIds.add(resource.identifier);
  }
  for (const resource of manifest.resources) {
    checkArray(resource.variants, `The variants of the resource ${resource.identifier} must be an array`);
    for (const variant of resource.variants) {
      checkRecord(variant, "A variant must be an object");
      checkIdentifier(variant.identifier, "The identifier of a variant");
      claim(variant.identifier);
    }
  }
  return resourceIds;
}

/**
 * Writes a manifest as `imsmanifest.xml` text. The element `organizations` is written empty, and the namespaces of QTI
 * metadata, curriculum standards, the accessibility description and the manifest extension are declared on the root.
 *
 * @param manifest - The manifest to write.
 * @returns The `imsmanifest.xml` document.
 * @throws `DataError` when the manifest is not valid: an identifier that is not an XML name or is used twice, a
 * `schema` or resource type outside its vocabulary, a resource without a file, or a dependency or variant that names no
 * resource.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/bind/ | QTI 3.0 ASI XML Binding, content packages}
 */
export function writeManifest(manifest: Manifest): string {
  checkRecord(manifest, "The manifest must be an object");
  checkOptionalString(manifest.base, "The base of the manifest");
  checkOptionalString(manifest.resourcesBase, "The resourcesBase of the manifest");
  const resourceIds = checkIdentifiers(manifest);
  const resources = cp(
    "resources",
    manifest.resources.map((resource) => writeResource(resource, resourceIds)),
    { "xml:base": manifest.resourcesBase },
  );
  const root = cp("manifest", [writeMetadata(manifest), cp("organizations"), resources], {
    identifier: manifest.identifier,
    "xml:base": manifest.base,
  });
  const used = new Set<string>();
  declarations(root, used);
  const prefixed: XmlAttribute[] = [...PREFIXES]
    .filter(([namespace]) => used.has(namespace))
    .map(([namespace, prefix]) => ({ namespace: XMLNS_NAMESPACE, prefix: "xmlns", name: prefix, value: namespace }));
  const defaultNamespace: XmlAttribute = { namespace: XMLNS_NAMESPACE, name: "xmlns", value: CP_NAMESPACE };
  return serializeXml({ ...root, attributes: [defaultNamespace, ...prefixed, ...root.attributes] });
}
