import { checkChoice } from "../checks.js";
import { DataError, type Issue, ReadError } from "../errors.js";
import {
  CP_NAMESPACE,
  CSM_NAMESPACE,
  DRD_NAMESPACE,
  LOM_NAMESPACE,
  QTI_METADATA_NAMESPACE,
  readAccessForAllResource,
  readCurriculumStandardsSet,
  readResourceMetadata,
} from "../metadata/index.js";
import {
  createTermConverter,
  ElementReader,
  type ParseXmlOptions,
  type ReaderRules,
  type XmlElement,
} from "../xml/index.js";
import {
  CPX_NAMESPACE,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_SCHEMAS,
  type Manifest,
  type ManifestMetadata,
  RESOURCE_TYPES,
  type Resource,
  type ResourceFile,
  type ResourceType,
  type Variant,
} from "./manifest.js";

/** The most issues that a `ReadError` of the identifiers of a manifest lists, so that a manifest cannot make millions of them. */
const MAX_IDENTIFIER_ISSUES = 1000;

const RULES: ReaderRules = {
  module: "package",
  namespaces: [CP_NAMESPACE, CPX_NAMESPACE, DRD_NAMESPACE, QTI_METADATA_NAMESPACE, CSM_NAMESPACE, LOM_NAMESPACE],
};

/**
 * The resource types that the XML binding lists and the CP schema does not enumerate, read as the type of the schema. 1EdTech's
 * own LTI examples use `imslti_xmlv1p1` for the resource type `imsbasiclti_xmlv1p3`.
 */
const BIND_RESOURCE_TYPES: ReadonlyMap<string, ResourceType> = new Map([["imslti_xmlv1p1", "imsbasiclti_xmlv1p3"]]);

function parseResourceType(text: string): ResourceType {
  const aliased = BIND_RESOURCE_TYPES.get(text);
  if (aliased !== undefined) return aliased;
  checkChoice(text, "The resource type", RESOURCE_TYPES);
  return text;
}

function parseSchemaVersion(text: string): string {
  if (text !== MANIFEST_SCHEMA_VERSION) {
    throw new DataError(
      `The schemaversion of a manifest must be ${MANIFEST_SCHEMA_VERSION}, found ${JSON.stringify(text)}.`,
    );
  }
  return text;
}

/** A declaration or a reference of an identifier, and the reader of the element it is in. */
interface Mention {
  readonly reader: ElementReader;
  readonly identifier: string;
}

/** Reads the elements of a manifest and records the identifiers it declares and refers to. */
class ManifestReader {
  private readonly declared: Mention[] = [];
  private readonly resourceIds = new Set<string>();
  private readonly references: Mention[] = [];
  private readonly path: string | undefined;

  constructor(path: string | undefined) {
    this.path = path;
  }

  private readFile(reader: ElementReader): ResourceFile {
    const href = reader.required("href");
    const metadata = reader.take("metadata");
    const extensions = metadata?.takeForeign();
    metadata?.done();
    reader.done();
    return { href, metadata: extensions };
  }

  private readDependency(reader: ElementReader): string {
    const identifier = reader.required("identifierref");
    reader.done();
    this.references.push({ reader, identifier });
    return identifier;
  }

  private readVariant(reader: ElementReader): Variant {
    const identifier = reader.required("identifier");
    const identifierref = reader.required("identifierref");
    const metadata = reader.require("metadata");
    const drd = metadata.require("accessForAllResource");
    metadata.done();
    reader.done();
    this.declared.push({ reader, identifier });
    this.references.push({ reader, identifier: identifierref });
    return { identifier, identifierref, drd: readAccessForAllResource(drd.element, { path: this.path }) };
  }

  private readResource(reader: ElementReader): Resource {
    const identifier = reader.required("identifier");
    const type = reader.required("type", parseResourceType);
    const href = reader.attribute("href");
    const base = reader.base();
    this.declared.push({ reader, identifier });
    this.resourceIds.add(identifier);
    const metadata = reader.take("metadata");
    const files = reader.takeAll("file").map((file) => this.readFile(file));
    const dependencies = reader.takeAll("dependency").map((dependency) => this.readDependency(dependency));
    const variants = reader.takeAll("variant").map((variant) => this.readVariant(variant));
    reader.done();
    return {
      identifier,
      type,
      href,
      base,
      metadata: metadata && readResourceMetadata(metadata.element, { path: this.path }),
      files,
      dependencies,
      variants,
    };
  }

  private readMetadata(reader: ElementReader): ManifestMetadata {
    const schema = reader.require("schema").leaf(createTermConverter(MANIFEST_SCHEMAS));
    reader.require("schemaversion").leaf(parseSchemaVersion);
    const curriculumStandards = reader.take("curriculumStandardsMetadataSet");
    const lom = reader.take("lom");
    reader.done();
    return {
      schema,
      curriculumStandards:
        curriculumStandards && readCurriculumStandardsSet(curriculumStandards.element, { path: this.path }),
      lom: lom?.element,
    };
  }

  /** The QTI profile prohibits organizations: the element may be there, and must be empty. */
  private checkOrganizations(reader: ElementReader): void {
    const first = reader.next();
    if (first !== undefined) {
      const message = `The organizations of a QTI package must be empty, found the element ${first.qualifiedName}; the profile prohibits cp:organization, cp:item and nested manifests.`;
      throw first.fail("organizations", message);
    }
    reader.done();
  }

  /**
   * Checks that identifiers are unique and that every `identifierref` names a resource (`xs:ID` and `xs:IDREF` in the CP
   * schema). The error lists at most {@link MAX_IDENTIFIER_ISSUES} of them and counts them all.
   */
  private checkIdentifiers(): void {
    const issues: Issue[] = [];
    let count = 0;
    const report = (reader: ElementReader, rule: string, message: string): void => {
      count += 1;
      if (count > MAX_IDENTIFIER_ISSUES) return;
      for (const issue of reader.fail(rule, message).issues) issues.push(issue);
    };
    const seen = new Set<string>();
    for (const { reader, identifier } of this.declared) {
      if (seen.has(identifier)) {
        report(
          reader,
          "duplicate-identifier",
          `The identifier ${JSON.stringify(identifier)} is declared twice in the manifest.`,
        );
      }
      seen.add(identifier);
    }
    for (const { reader, identifier } of this.references) {
      if (!this.resourceIds.has(identifier)) {
        report(
          reader,
          "dangling-reference",
          `The identifierref ${JSON.stringify(identifier)} names no resource of the manifest.`,
        );
      }
    }
    const [first] = issues;
    if (first !== undefined) {
      const total = count === 1 ? "" : ` The manifest has ${count} such problems.`;
      throw new ReadError(`${first.message}${total}`, issues);
    }
  }

  read(reader: ElementReader): Manifest {
    if (reader.element.namespace !== CP_NAMESPACE || reader.name !== "manifest") {
      const message = `The root element of a manifest must be {${CP_NAMESPACE}}manifest, found ${reader.qualifiedName}.`;
      throw reader.fail("not-a-manifest", message);
    }
    const identifier = reader.required("identifier");
    const base = reader.base();
    this.declared.push({ reader, identifier });
    const metadata = this.readMetadata(reader.require("metadata"));
    const organizations = reader.take("organizations");
    if (organizations !== undefined) this.checkOrganizations(organizations);
    const resourcesReader = reader.require("resources");
    const resourcesBase = resourcesReader.base();
    const resources = resourcesReader.takeAll("resource").map((resource) => this.readResource(resource));
    resourcesReader.done();
    reader.done();
    this.checkIdentifiers();
    return { identifier, base, metadata, resourcesBase, resources };
  }
}

/**
 * Reads the manifest of a QTI content package. The root must be a `manifest` of the content package namespace, and the
 * elements come in the order of the CP schema. The reader checks the vocabularies of `schema`, `schemaversion` and the
 * resource type, the ones that the model cannot hold otherwise. It does not check that files exist.
 *
 * @remarks
 * The resource type `imslti_xmlv1p1`, which the XML binding lists and the CP schema does not, is read as
 * `imsbasiclti_xmlv1p3`.
 * @param input - The manifest as text or bytes, or the parsed root element.
 * @param options - See {@link ParseXmlOptions}.
 * @returns The manifest.
 * @throws `DataError` when an argument has the wrong type or a limit is not a positive integer.
 * @throws `ReadError` when the document is not well-formed, is not a manifest of the content package namespace, has an
 * element, attribute or text that the CP schema does not allow at that place, lacks a required element or attribute, has a
 * value outside its vocabulary, has organizations, declares an identifier twice or has an `identifierref` that names no
 * resource.
 * @throws `SecurityError` when the document has a DOCTYPE or exceeds a limit.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/bind/ | QTI 3.0 ASI XML Binding, content packages}
 */
export function readManifest(input: string | Uint8Array | XmlElement, options: ParseXmlOptions = {}): Manifest {
  const reader = ElementReader.open(input, RULES, "The manifest", options);
  return new ManifestReader(options.path).read(reader);
}
