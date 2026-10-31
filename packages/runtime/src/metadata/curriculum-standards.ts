import { checkArray, checkRecord, checkString } from "../checks.js";
import { DataError } from "../errors.js";
import { ElementReader, type XmlElement } from "../xml/index.js";
import { CSM_NAMESPACE } from "./namespaces.js";
import { checkReadArguments, expectRoot, parseString, takeLeaf } from "./text.js";
import { appendLeaf, branch, CSMD } from "./write-support.js";

/** A curriculum standard: its label, the address of its CASE item and its GUID (CSM XSD, `labelledGUID`). */
export interface LabelledGuid {
  /** The label that names the standard. */
  readonly label?: string;
  /** The URI of the standard as a CASE item. The runtime keeps it as a string. */
  readonly caseItemUri?: string;
  /** The globally unique identifier of the standard. */
  readonly guid: string;
}

/** Standards of one region and version (CSM XSD, `setOfGUIDs`). */
export interface GuidSet {
  /** The region the standards apply to. */
  readonly region?: string;
  /** The version of the standards. */
  readonly version?: string;
  /** The standards. */
  readonly labelledGuids: readonly LabelledGuid[];
}

/** The standards of one provider (CSM XSD, `curriculumStandardsMetadata`). */
export interface CurriculumStandards {
  /** The identifier of the provider. */
  readonly providerId?: string;
  /** The sets of standards. */
  readonly guidSets: readonly GuidSet[];
}

/** The curriculum standards a resource addresses (CSM XSD, `curriculumStandardsMetadataSet`). */
export interface CurriculumStandardsSet {
  /** The label of the resource the standards are about. */
  readonly resourceLabel?: string;
  /** The identifier of the part of the resource the standards are about. */
  readonly resourcePartId?: string;
  /** The standards, by provider. */
  readonly standards: readonly CurriculumStandards[];
}

function readGuid(reader: ElementReader): LabelledGuid {
  const guid = {
    label: takeLeaf(reader, "label", parseString),
    caseItemUri: takeLeaf(reader, "caseItemURI", parseString),
    guid: reader.require("GUID").leaf(parseString),
  };
  reader.done();
  return guid;
}

function readGuidSet(reader: ElementReader): GuidSet {
  const set = {
    region: reader.attribute("region"),
    version: reader.attribute("version"),
    labelledGuids: reader.takeAll("labelledGUID").map(readGuid),
  };
  reader.done();
  return set;
}

function readStandards(reader: ElementReader): CurriculumStandards {
  const standards = {
    providerId: reader.attribute("providerId"),
    guidSets: reader.takeAll("setOfGUIDs").map(readGuidSet),
  };
  reader.done();
  return standards;
}

/**
 * Reads a `curriculumStandardsMetadataSet` element. The children come in the order of the schema.
 *
 * @param element - The element.
 * @param path - The path of the document, which the issues name. Default: no path.
 * @throws `DataError` when an argument has the wrong type.
 * @throws `ReadError` when the element is not a `curriculumStandardsMetadataSet` of the CSM namespace, or has an element,
 * attribute or text that the CSM schema does not allow at that place, or a `labelledGUID` without a `GUID`.
 */
export function readCurriculumStandardsSet(element: XmlElement, path?: string): CurriculumStandardsSet {
  checkReadArguments(element, path);
  const reader = new ElementReader(element, {
    module: "metadata",
    source: "CSM XSD",
    namespaces: [CSM_NAMESPACE],
    path,
  });
  expectRoot(reader, CSM_NAMESPACE, "curriculumStandardsMetadataSet");
  const set = {
    resourceLabel: reader.attribute("resourceLabel"),
    resourcePartId: reader.attribute("resourcePartId"),
    standards: reader.takeAll("curriculumStandardsMetadata").map(readStandards),
  };
  reader.done();
  return set;
}

function checkOptionalString(value: unknown, label: string): void {
  if (value !== undefined) checkString(value, label);
}

function checkNonEmpty(items: unknown, label: string): asserts items is readonly unknown[] {
  checkArray(items, `${label} must be an array`);
  if (items.length === 0) throw new DataError(`${label} must have at least one item (CSM XSD).`);
}

function writeGuid(guid: LabelledGuid): XmlElement {
  checkRecord(guid, "A labelled GUID must be an object");
  checkOptionalString(guid.label, "The field label");
  checkOptionalString(guid.caseItemUri, "The field caseItemUri");
  checkString(guid.guid, "The field guid");
  const children: XmlElement[] = [];
  appendLeaf(children, CSMD, "label", guid.label);
  appendLeaf(children, CSMD, "caseItemURI", guid.caseItemUri);
  appendLeaf(children, CSMD, "GUID", guid.guid);
  return branch(CSMD, "labelledGUID", children);
}

function writeGuidSet(set: GuidSet): XmlElement {
  checkRecord(set, "A set of GUIDs must be an object");
  checkOptionalString(set.region, "The field region");
  checkOptionalString(set.version, "The field version");
  checkNonEmpty(set.labelledGuids, "The field labelledGuids");
  return branch(CSMD, "setOfGUIDs", set.labelledGuids.map(writeGuid), { region: set.region, version: set.version });
}

function writeStandards(standards: CurriculumStandards): XmlElement {
  checkRecord(standards, "Curriculum standards must be an object");
  checkOptionalString(standards.providerId, "The field providerId");
  checkNonEmpty(standards.guidSets, "The field guidSets");
  return branch(CSMD, "curriculumStandardsMetadata", standards.guidSets.map(writeGuidSet), {
    providerId: standards.providerId,
  });
}

/**
 * Writes the standards as a `curriculumStandardsMetadataSet` element.
 *
 * @throws `DataError` when a field has the wrong type, or a list that the schema requires to have an item is empty.
 */
export function writeCurriculumStandardsSet(set: CurriculumStandardsSet): XmlElement {
  checkRecord(set, "The curriculum standards set must be an object");
  checkOptionalString(set.resourceLabel, "The field resourceLabel");
  checkOptionalString(set.resourcePartId, "The field resourcePartId");
  checkNonEmpty(set.standards, "The field standards");
  return branch(CSMD, "curriculumStandardsMetadataSet", set.standards.map(writeStandards), {
    resourceLabel: set.resourceLabel,
    resourcePartId: set.resourcePartId,
  });
}
