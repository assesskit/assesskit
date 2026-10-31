import type { AccessForAllResource, CurriculumStandardsSet, ResourceMetadata } from "../metadata/index.js";
import type { XmlElement } from "../xml/index.js";

/** The namespace of the manifest extension that holds the variants of a resource. */
export const CPX_NAMESPACE = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_extensionv1p2";

/** The types of a resource. */
export const RESOURCE_TYPES = [
  "imsqti_test_xmlv3p0",
  "imsqti_section_xmlv3p0",
  "imsqti_item_xmlv3p0",
  "imsqti_resprocessing_xmlv3p0",
  "imsqti_outcomes_xmlv3p0",
  "imsqti_stimulus_xmlv3p0",
  "imsqti_fragment_xmlv3p0",
  "imsqti_rptemplate_xmlv3p0",
  "associatedcontent/learning-application-resource",
  "webcontent",
  "imsbasiclti_xmlv1p3",
  "controlfile",
  "resourcemetadata/xml",
  "resourceextmetadata/xml",
  "qtiusagedata/xml",
  "pls",
  "css2",
  "css3",
  "extension",
] as const;

/** The type of a resource. */
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** The values of the metadata element `schema` of a manifest. */
export const MANIFEST_SCHEMAS = [
  "QTI Package",
  "QTI Test Bank",
  "QTI Item Bank",
  "QTI Object Bank",
  "QTI Test",
  "QTI Section",
  "QTI Item",
] as const;

/** A value of the metadata element `schema` of a manifest. */
export type ManifestSchema = (typeof MANIFEST_SCHEMAS)[number];

/** The only value of the metadata element `schemaversion` of a manifest. */
export const MANIFEST_SCHEMA_VERSION = "3.0.0";

/** The metadata of a manifest. The `schemaversion` is always `3.0.0`. */
export interface ManifestMetadata {
  /** What the package holds. */
  readonly schema: ManifestSchema;
  /** The curriculum standards the package addresses. */
  readonly curriculumStandards?: CurriculumStandardsSet;
  /** The `lom` element, kept as XML; `lomGeneral` types its category `general`. */
  readonly lom?: XmlElement;
}

/** A file of a resource. */
export interface ResourceFile {
  /** The reference to the file, relative to the base of the resource. */
  readonly href: string;
  /** The elements of other namespaces that the `metadata` of the file holds, kept as XML. */
  readonly metadata?: readonly XmlElement[];
}

/** An alternative to a resource that suits another need of a candidate. */
export interface Variant {
  /** The identifier of the variant link. */
  readonly identifier: string;
  /** The identifier of the resource that is the variant. */
  readonly identifierref: string;
  /** How the variant differs from the resource it is linked from. */
  readonly drd: AccessForAllResource;
}

/** A resource of a manifest: an item, test, section, stimulus or a file that belongs to them. */
export interface Resource {
  /** The identifier, unique in the manifest. */
  readonly identifier: string;
  /** The type. */
  readonly type: ResourceType;
  /** The reference to the main file, relative to the base of the resource. */
  readonly href?: string;
  /** The `xml:base` of the resource. */
  readonly base?: string;
  /** The metadata of the resource. */
  readonly metadata?: ResourceMetadata;
  /** The files of the resource. */
  readonly files: readonly ResourceFile[];
  /** The identifiers of the resources this one depends on. */
  readonly dependencies: readonly string[];
  /** The variants of the resource. */
  readonly variants: readonly Variant[];
}

/** The manifest of a QTI content package, `imsmanifest.xml`. The profile has no organizations. */
export interface Manifest {
  /** The identifier of the manifest. */
  readonly identifier: string;
  /** The `xml:base` of the manifest. */
  readonly base?: string;
  /** The metadata of the manifest. */
  readonly metadata: ManifestMetadata;
  /** The `xml:base` of the `resources` element. */
  readonly resourcesBase?: string;
  /** The resources. */
  readonly resources: readonly Resource[];
}
