import { checkFunction, checkRecord, checkString, describe } from "../checks.js";
import { checkOptions } from "../checks-internal.js";
import { DataError } from "../errors.js";
import { type ParseXmlOptions, parseXml, serializeXml, type XmlElement } from "../xml/index.js";
import { XMLNS_NAMESPACE } from "../xml/internal.js";
import { DOCUMENT_ELEMENTS } from "./element-table.js";
import { isElement } from "./guards.js";
import type {
  AssessmentItem,
  AssessmentSection,
  AssessmentStimulus,
  AssessmentTest,
  OutcomeDeclaration,
  OutcomeProcessing,
  ResponseProcessing,
} from "./model.js";
import { ASI_NAMESPACE } from "./namespace.js";
import { readElement } from "./read.js";
import { asiError, type ReadContext } from "./read-error.js";
import { typeNamed } from "./type-index.js";
import { type ElementVisit, walkElement } from "./walk.js";
import { writeElement } from "./write.js";

/**
 * A document of QTI 3.0 ASI: the root element of the ASI schema, with the model of the element under the property that
 * names it. Items, stimuli, tests, sections, outcome declarations, response processing templates and outcome processing
 * are documents.
 */
export type AsiDocument =
  | {
      /** An assessment item. */
      readonly kind: "item";
      /** The item. */
      readonly item: AssessmentItem;
    }
  | {
      /** An assessment stimulus. */
      readonly kind: "stimulus";
      /** The stimulus. */
      readonly stimulus: AssessmentStimulus;
    }
  | {
      /** An assessment test. */
      readonly kind: "test";
      /** The test. */
      readonly test: AssessmentTest;
    }
  | {
      /** An assessment section. */
      readonly kind: "section";
      /** The section. */
      readonly section: AssessmentSection;
    }
  | {
      /** An outcome declaration. */
      readonly kind: "outcome-declaration";
      /** The outcome declaration. */
      readonly declaration: OutcomeDeclaration;
    }
  | {
      /** Response processing, such as a response processing template. */
      readonly kind: "response-processing";
      /** The response processing. */
      readonly processing: ResponseProcessing;
    }
  | {
      /** Outcome processing. */
      readonly kind: "outcome-processing";
      /** The outcome processing. */
      readonly processing: OutcomeProcessing;
    };

/** Options of {@link readAsi}. */
export interface ReadAsiOptions {
  /**
   * The path of the document in its package or directory; errors and issues name the document by it.
   *
   * @defaultValue `undefined`, which names the document "The document"
   */
  readonly path?: string;
  /**
   * Limits that replace the defaults of {@link parseXml}, field by field; they apply to text and bytes.
   *
   * @defaultValue `{}`, which keeps the defaults of {@link parseXml}
   */
  readonly limits?: ParseXmlOptions["limits"];
}

/** A root element, the kind of document it makes and the property of the document that holds its model. */
interface DocumentEntry {
  readonly element: keyof typeof DOCUMENT_ELEMENTS;
  readonly kind: AsiDocument["kind"];
  readonly property: string;
}

const ENTRIES: readonly DocumentEntry[] = [
  { element: "qti-assessment-item", kind: "item", property: "item" },
  { element: "qti-assessment-section", kind: "section", property: "section" },
  { element: "qti-assessment-stimulus", kind: "stimulus", property: "stimulus" },
  { element: "qti-assessment-test", kind: "test", property: "test" },
  { element: "qti-outcome-declaration", kind: "outcome-declaration", property: "declaration" },
  { element: "qti-outcome-processing", kind: "outcome-processing", property: "processing" },
  { element: "qti-response-processing", kind: "response-processing", property: "processing" },
];
const BY_ELEMENT: ReadonlyMap<string, DocumentEntry> = new Map(ENTRIES.map((entry) => [entry.element, entry]));
const BY_KIND: ReadonlyMap<string, DocumentEntry> = new Map(ENTRIES.map((entry) => [entry.kind, entry]));

const XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";
/** The schema that `writeAsi` names: the primary ASI schema, version 3.0.1. */
const SCHEMA_LOCATION = `${ASI_NAMESPACE} https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd`;

/** Returns the root without the attributes that name a schema, which are not part of the model. */
function withoutSchemaLocation(root: XmlElement): XmlElement {
  const attributes = root.attributes.filter(
    ({ namespace, name }) =>
      !(namespace === XSI_NAMESPACE && (name === "schemaLocation" || name === "noNamespaceSchemaLocation")),
  );
  return { ...root, attributes };
}

function rootOf(input: string | Uint8Array | XmlElement, options: ReadAsiOptions): XmlElement {
  const { path, limits = {} } = options;
  if (path !== undefined) checkString(path, "The option path");
  checkRecord(limits, "The option limits must be an object");
  if (typeof input === "string" || input instanceof Uint8Array) {
    return parseXml(input, { path, limits });
  }
  if (!isElement(input)) {
    throw new DataError(`The input must be a string, a Uint8Array or an XmlElement, found ${describe(input)}.`);
  }
  return input;
}

/**
 * Reads an assessment item, stimulus, test, section, outcome declaration, response processing template or outcome
 * processing document. The model has the attributes and child elements of the schema, with the defaults of the schema not
 * applied, so that writing it gives the document back. The content of bodies is typed too: text, HTML elements,
 * interactions, feedback, templates, rubric blocks and catalogs are nodes of their own types, and MathML, SSML and
 * `xi:include` stay `XmlElement`s. It does not check the order of child elements or the minimum of a list, which the
 * schema does. The model carries no source positions, and no comments or processing instructions.
 *
 * The document must be in the ASI namespace; versions 3.0.0 and 3.0.1 share it. An `xsi:schemaLocation` is
 * ignored. `xi:include` elements stay in the model, as the `XmlElement`s they are; resolve them first with
 * `resolveIncludes` of `xml` to read the included content.
 *
 * @param input - The document as text, bytes or a tree from `parseXml` or `resolveIncludes`.
 * @param options - See {@link ReadAsiOptions}.
 * @returns The document, with its kind and model.
 * @throws `DataError` when an argument has the wrong type or a limit is not a positive integer.
 * @throws `ReadError` when the document is not well-formed, the root is not a document element of the ASI namespace, or an
 * element has an attribute, child element or text that the schema does not allow, lacks a required one, or has a value
 * that is not in its lexical form.
 * @throws `SecurityError` when the document has a DOCTYPE or exceeds a limit.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/bind/ | QTI 3.0 ASI XML Binding}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
export function readAsi(input: string | Uint8Array | XmlElement, options: ReadAsiOptions = {}): AsiDocument {
  checkOptions(options);
  const root = rootOf(input, options);
  const context: ReadContext = { path: options.path, trail: [] };
  const entry = root.namespace === ASI_NAMESPACE ? BY_ELEMENT.get(root.name) : undefined;
  if (entry === undefined) {
    const names = ENTRIES.map(({ element }) => element).join(", ");
    const message = `The root element must be one of ${names} in the namespace ${ASI_NAMESPACE}, found ${root.name} in ${describe(root.namespace)}.`;
    throw asiError(context, root, "assesskit/asi/document-element", message);
  }
  const model = readElement(typeNamed(DOCUMENT_ELEMENTS[entry.element]), withoutSchemaLocation(root), context);
  // The model is built from the table that also derives the types of the models, so that it has their shape.
  return { kind: entry.kind, [entry.property]: model } as AsiDocument;
}

/** Returns the entry of a document, after checking that it is an object of one of the kinds of {@link AsiDocument}. */
function entryOfDocument(document: unknown): DocumentEntry {
  checkRecord(document, "The document must be an object");
  const entry = typeof document.kind === "string" ? BY_KIND.get(document.kind) : undefined;
  if (entry === undefined) {
    const kinds = ENTRIES.map(({ kind }) => JSON.stringify(kind)).join(", ");
    throw new DataError(`The kind of a document must be one of ${kinds}, found ${describe(document.kind)}.`);
  }
  return entry;
}

/**
 * Writes a document as XML in UTF-8: the root element in the ASI namespace, with `xsi:schemaLocation` naming the 3.0.1
 * ASI schema. Attributes and child elements are in the order of the schema, so that the output is valid
 * against it when the model is.
 *
 * @param document - The document.
 * @returns The document as text, in UTF-8.
 * @throws `DataError` when the document is not an object of one of the kinds of {@link AsiDocument}, or its model is not
 * an object of the shape the element has: a missing required property, a property the element does not have, or a
 * value of the wrong type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/bind/ | QTI 3.0 ASI XML Binding}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
export function writeAsi(document: AsiDocument): string {
  const entry = entryOfDocument(document);
  const root = writeElement(
    typeNamed(DOCUMENT_ELEMENTS[entry.element]),
    entry.element,
    Reflect.get(document, entry.property),
  );
  return serializeXml({
    ...root,
    attributes: [
      { namespace: XMLNS_NAMESPACE, name: "xmlns", value: ASI_NAMESPACE },
      { namespace: XMLNS_NAMESPACE, prefix: "xmlns", name: "xsi", value: XSI_NAMESPACE },
      { namespace: XSI_NAMESPACE, prefix: "xsi", name: "schemaLocation", value: SCHEMA_LOCATION },
      ...root.attributes,
    ],
  });
}

/**
 * Calls `visit` for each element of a document that has a model, in document order, the element before its children:
 * the root, then its children by property in the order of the schema. Each visit carries the element's name, its model,
 * the attributes the schema gives it with their types, and the element that holds it. MathML, SSML and `xi:include`
 * stay XML and are in `foreign` of the element that holds them. The walk checks the shape of the models as `writeAsi`
 * does but not their values, and it writes nothing.
 *
 * @param document - The document.
 * @param visit - The function to call for each element.
 * @throws `DataError` when an argument has the wrong type, the document is not an object of one of the kinds of
 * {@link AsiDocument}, or a model is not an object of the shape the element has: a property that should hold an array
 * does not, or a member has a kind that its property does not accept.
 */
export function walkDocument(document: AsiDocument, visit: (element: ElementVisit) => void): void {
  const entry = entryOfDocument(document);
  checkFunction(visit, "The visitor must be a function");
  walkElement(typeNamed(DOCUMENT_ELEMENTS[entry.element]), entry.element, Reflect.get(document, entry.property), visit);
}
