import { checkRecord } from "../checks.js";
import { DataError } from "../errors.js";
import { ElementReader, locationOf, readError, type XmlElement } from "../xml/index.js";
import {
  type CurriculumStandardsSet,
  readCurriculumStandardsSet,
  writeCurriculumStandardsSet,
} from "./curriculum-standards.js";
import { CP_NAMESPACE, CSM_NAMESPACE, LOM_NAMESPACE, QTI_METADATA_NAMESPACE } from "./namespaces.js";
import { type QtiMetadata, readQtiMetadata, writeQtiMetadata } from "./qti-metadata.js";
import { checkReadArguments, expectRoot } from "./text.js";

/** The metadata of a resource in a content package (BIND §8.8). */
export interface ResourceMetadata {
  /** The `lom` element, kept as XML: the runtime types only its category `general` (see {@link lomGeneral}). */
  readonly lom?: XmlElement;
  /** The QTI metadata of the resource. */
  readonly qti?: QtiMetadata;
  /** The curriculum standards the resource addresses. */
  readonly curriculumStandards?: CurriculumStandardsSet;
}

const BIND_METADATA = "BIND §8.8";

function isLom(element: XmlElement): boolean {
  return element.namespace === LOM_NAMESPACE && element.name === "lom";
}

/** Reads the `metadata` element of a resource: the QTI metadata, the curriculum standards and the LOM, in that order. */
function readContainer(element: XmlElement, path: string | undefined): ResourceMetadata {
  const rules = {
    module: "metadata",
    source: BIND_METADATA,
    namespaces: [QTI_METADATA_NAMESPACE, CSM_NAMESPACE, LOM_NAMESPACE],
    path,
  };
  const reader = new ElementReader(element, rules);
  const qti = reader.take("qtiMetadata");
  const curriculumStandards = reader.take("curriculumStandardsMetadataSet");
  const lom = reader.take("lom");
  reader.done();
  if (lom !== undefined) expectRoot(lom, LOM_NAMESPACE, "lom");
  return {
    lom: lom?.element,
    qti: qti && readQtiMetadata(qti.element, path),
    curriculumStandards: curriculumStandards && readCurriculumStandardsSet(curriculumStandards.element, path),
  };
}

/** Finds the one child of an element that is the element `name` of a namespace; a second one is an error. */
function onlyChild(
  element: XmlElement,
  namespace: string,
  name: string,
  path: string | undefined,
): XmlElement | undefined {
  const found = element.children.filter(
    (child): child is XmlElement => child.kind === "element" && child.namespace === namespace && child.name === name,
  );
  const [first, second] = found;
  if (second !== undefined) {
    const message = `The metadata file must contain at most one ${name} element.`;
    throw readError(
      "assesskit/metadata/duplicate-element",
      message,
      BIND_METADATA,
      locationOf(second, path, element.name),
    );
  }
  return first;
}

/** Reads the root `lom` element of an external metadata file: the QTI metadata and the curriculum standards are among its elements. */
function readExternal(element: XmlElement, path: string | undefined): ResourceMetadata {
  const qti = onlyChild(element, QTI_METADATA_NAMESPACE, "qtiMetadata", path);
  const curriculumStandards = onlyChild(element, CSM_NAMESPACE, "curriculumStandardsMetadataSet", path);
  const rest = element.children.filter((child) => child !== qti && child !== curriculumStandards);
  return {
    lom: { ...element, children: rest },
    qti: qti && readQtiMetadata(qti, path),
    curriculumStandards: curriculumStandards && readCurriculumStandardsSet(curriculumStandards, path),
  };
}

/**
 * Reads the metadata of a resource from the `metadata` element of the resource in a manifest, or from the root `lom`
 * element of an external metadata file (resource type `resourcemetadata/xml`, BPIG §6.3), which holds the QTI metadata
 * and the curriculum standards among the LOM elements. In the second case `lom` is the element without those two.
 *
 * The `metadata` element has `qtiMetadata`, `curriculumStandardsMetadataSet` and `lom` in that order (BIND §8.8).
 *
 * @param element - The `metadata` element, or the `lom` root.
 * @param path - The path of the document, which the issues name. Default: no path.
 * @throws `DataError` when an argument has the wrong type.
 * @throws `ReadError` when a `metadata` element has anything but those three elements in that order, or one of the parts
 * cannot be read; an external file has one of the two parts twice.
 */
export function readResourceMetadata(element: XmlElement, path?: string): ResourceMetadata {
  checkReadArguments(element, path);
  return isLom(element) ? readExternal(element, path) : readContainer(element, path);
}

/**
 * Writes the metadata of a resource as a `metadata` element of the content package namespace, with the children in
 * the order of the CP XSD: QTI metadata, curriculum standards, LOM.
 *
 * @throws `DataError` when a field has the wrong type, the `lom` is not a `lom` element of the LOM namespace, or the QTI
 * metadata or the curriculum standards are invalid.
 */
export function writeResourceMetadata(metadata: ResourceMetadata): XmlElement {
  const input: unknown = metadata;
  checkRecord(input, "The resource metadata must be an object");
  const { lom, qti, curriculumStandards } = metadata;
  const children: XmlElement[] = [];
  if (qti !== undefined) children.push(writeQtiMetadata(qti));
  if (curriculumStandards !== undefined) children.push(writeCurriculumStandardsSet(curriculumStandards));
  if (lom !== undefined) {
    checkRecord(lom, "The field lom must be an element");
    if (!isLom(lom))
      throw new DataError(`The field lom must be a lom element of the namespace ${LOM_NAMESPACE}, found ${lom.name}.`);
    children.push(lom);
  }
  return { kind: "element", namespace: CP_NAMESPACE, name: "metadata", attributes: [], children };
}
