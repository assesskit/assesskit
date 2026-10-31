import { checkArray, checkBoolean, checkRecord, checkString } from "../checks.js";
import { DataError } from "../errors.js";
import { ElementReader, type XmlElement } from "../xml/index.js";
import { DRD_NAMESPACE } from "./namespaces.js";
import {
  checkOpenTerm,
  checkReadArguments,
  type ExtensionTerm,
  expectRoot,
  openTermOf,
  parseBoolean,
  parseString,
  takeLeaf,
  takeLeaves,
} from "./text.js";
import { appendLeaf, branch, DRD, leaf } from "./write-support.js";

/** The terms of the vocabulary AccessMode, also used by `accessModeAdapted` (DRD XSD): the sensory channel of the content. */
export const ACCESS_MODES = [
  "auditory",
  "colour",
  "itemSize",
  "olfactory",
  "orientation",
  "position",
  "tactile",
  "textOnImage",
  "textual",
  "visual",
] as const;

/** The terms of the vocabulary AdaptationDetail (DRD XSD). */
export const ADAPTATION_DETAILS = ["enhanced", "verbatim", "realTime", "symbolic", "recorded", "synthesized"] as const;

/** The terms of the vocabulary AdaptationMediaType (DRD XSD). */
export const ADAPTATION_MEDIA_TYPES = [
  "Daisy",
  "braille",
  "NIMAS",
  "MathML",
  "ChemML",
  "LaTeX",
  "OEBPS",
  "PDF",
  "LIT",
  "Nemeth",
  "EPUB3",
] as const;

/** The terms of the vocabulary AdaptationType (DRD XSD). */
export const ADAPTATION_TYPES = [
  "alternativeText",
  "audioDescription",
  "captions",
  "e-book",
  "haptic",
  "highContrast",
  "longDescription",
  "signLanguage",
  "transcript",
] as const;

/** The terms of the vocabulary ApiInteroperable (DRD XSD). */
export const API_INTEROPERABLE = [
  "AndroidAccessibility",
  "ARIA",
  "ATK",
  "AT-SPI",
  "BlackberryAccessibility",
  "iAccessible2",
  "JavaAccessibility",
  "MacOSXAccessibility",
  "MSAA",
  "UIAutomation",
] as const;

/** The terms of the vocabulary ControlFlexibility (DRD XSD). */
export const CONTROL_FLEXIBILITY = ["fullKeyboardControl", "fullMouseControl"] as const;

/** The terms of the vocabulary DisplayTransformability (DRD XSD). */
export const DISPLAY_TRANSFORMABILITY = [
  "backgroundColour",
  "cursorPresentation",
  "fontFace",
  "fontSize",
  "fontWeight",
  "foregroundColour",
  "highlightPresentation",
  "layout",
  "letterSpacing",
  "lineHeight",
  "structurePresentation",
  "wordSpacing",
] as const;

/** The terms of the vocabulary EducationalComplexityOfAdaptation (DRD XSD). */
export const COMPLEXITY_OF_ADAPTATION = ["enriched", "simplified"] as const;

/** The terms of the vocabulary Hazard (DRD XSD). */
export const DRD_HAZARDS = ["flashing", "sound", "olfactoryHazard", "motionSimulation"] as const;

/** A hazard of the vocabulary of the DRD XSD. */
export type DrdHazard = (typeof DRD_HAZARDS)[number];

/** A term of AccessMode or `accessModeAdapted`, or an extension term. */
export type AccessMode = (typeof ACCESS_MODES)[number] | ExtensionTerm;
/** A term of AdaptationDetail, or an extension term. */
export type AdaptationDetail = (typeof ADAPTATION_DETAILS)[number] | ExtensionTerm;
/** A term of AdaptationMediaType, or an extension term. */
export type AdaptationMediaType = (typeof ADAPTATION_MEDIA_TYPES)[number] | ExtensionTerm;
/** A term of AdaptationType, or an extension term. */
export type AdaptationType = (typeof ADAPTATION_TYPES)[number] | ExtensionTerm;
/** A term of ApiInteroperable, or an extension term. */
export type ApiInteroperable = (typeof API_INTEROPERABLE)[number] | ExtensionTerm;
/** A term of ControlFlexibility, or an extension term. */
export type ControlFlexibility = (typeof CONTROL_FLEXIBILITY)[number] | ExtensionTerm;
/** A term of DisplayTransformability, or an extension term. */
export type DisplayTransformability = (typeof DISPLAY_TRANSFORMABILITY)[number] | ExtensionTerm;
/** A term of EducationalComplexityOfAdaptation, or an extension term. */
export type ComplexityOfAdaptation = (typeof COMPLEXITY_OF_ADAPTATION)[number] | ExtensionTerm;
/** A term of Hazard, or an extension term. */
export type Hazard = DrdHazard | ExtensionTerm;

/**
 * The accessibility description of a resource (DRD XSD, `accessForAllResource`, AfA 3.0 Digital Resource Description).
 * Each field has the name of its element; the lists are empty when the document has none of the element.
 */
export interface AccessForAllResource {
  /** The sensory channels the resource uses. */
  readonly accessMode: readonly AccessMode[];
  /** The sensory channels of the adapted resource. */
  readonly accessModeAdapted: readonly AccessMode[];
  /** The kinds of adaptation. */
  readonly adaptationType: readonly AdaptationType[];
  /** Whether the resource works with assistive technology. */
  readonly atInteroperable?: boolean;
  /** How the resource can be controlled. */
  readonly controlFlexibility: readonly ControlFlexibility[];
  /** How the display of the resource can be transformed. */
  readonly displayTransformability: readonly DisplayTransformability[];
  /** Whether the adaptation is more or less complex than the original. */
  readonly educationalComplexityOfAdaptation?: ComplexityOfAdaptation;
  /** The URIs of resources that adapt this one. */
  readonly hasAdaptation: readonly string[];
  /** The hazards the resource has. */
  readonly hazard: readonly Hazard[];
  /** The URIs of the resources this one adapts. */
  readonly isAdaptationOf: readonly string[];
  /** The languages of the adapted resource. */
  readonly languageOfAdaptation: readonly string[];
  /** The detail of the adaptation. */
  readonly adaptationDetail: readonly AdaptationDetail[];
  /** The media types of the adaptation. */
  readonly adaptationMediaType: readonly AdaptationMediaType[];
  /** The accessibility APIs the resource supports. */
  readonly apiInteroperable: readonly ApiInteroperable[];
  /** The educational levels of the adaptation. */
  readonly educationalLevelOfAdaptation: readonly string[];
  /** The URIs of the resources this one adapts in full. */
  readonly isFullAdaptationOf: readonly string[];
  /** The URIs of the resources this one adapts in part. */
  readonly isPartialAdaptationOf: readonly string[];
  /** Elements of other namespaces that the schema allows after the DRD elements, kept as they are. */
  readonly extensions: readonly XmlElement[];
}

/**
 * Reads an `accessForAllResource` element. The children come in the order of the DRD schema.
 *
 * @param element - The element.
 * @param path - The path of the document, which the issues name. Default: no path.
 * @throws `DataError` when an argument has the wrong type.
 * @throws `ReadError` when the element is not an `accessForAllResource` of the DRD namespace, has an element, attribute or
 * text that the schema does not allow at that place, a boolean that is not `true`, `false`, `1` or `0`, or a term outside
 * its vocabulary that is not an extension term.
 */
export function readAccessForAllResource(element: XmlElement, path?: string): AccessForAllResource {
  checkReadArguments(element, path);
  const reader = new ElementReader(element, {
    module: "metadata",
    namespaces: [DRD_NAMESPACE],
    path,
  });
  expectRoot(reader, DRD_NAMESPACE, "accessForAllResource");
  const resource: AccessForAllResource = {
    accessMode: takeLeaves(reader, "accessMode", openTermOf(ACCESS_MODES)),
    accessModeAdapted: takeLeaves(reader, "accessModeAdapted", openTermOf(ACCESS_MODES)),
    adaptationType: takeLeaves(reader, "adaptationType", openTermOf(ADAPTATION_TYPES)),
    atInteroperable: takeLeaf(reader, "atInteroperable", parseBoolean),
    controlFlexibility: takeLeaves(reader, "controlFlexibility", openTermOf(CONTROL_FLEXIBILITY)),
    displayTransformability: takeLeaves(reader, "displayTransformability", openTermOf(DISPLAY_TRANSFORMABILITY)),
    educationalComplexityOfAdaptation: takeLeaf(
      reader,
      "educationalComplexityOfAdaptation",
      openTermOf(COMPLEXITY_OF_ADAPTATION),
    ),
    hasAdaptation: takeLeaves(reader, "hasAdaptation", parseString),
    hazard: takeLeaves(reader, "hazard", openTermOf(DRD_HAZARDS)),
    isAdaptationOf: takeLeaves(reader, "isAdaptationOf", parseString),
    languageOfAdaptation: takeLeaves(reader, "languageOfAdaptation", parseString),
    adaptationDetail: takeLeaves(reader, "adaptationDetail", openTermOf(ADAPTATION_DETAILS)),
    adaptationMediaType: takeLeaves(reader, "adaptationMediaType", openTermOf(ADAPTATION_MEDIA_TYPES)),
    apiInteroperable: takeLeaves(reader, "apiInteroperable", openTermOf(API_INTEROPERABLE)),
    educationalLevelOfAdaptation: takeLeaves(reader, "educationalLevelOfAdaptation", parseString),
    isFullAdaptationOf: takeLeaves(reader, "isFullAdaptationOf", parseString),
    isPartialAdaptationOf: takeLeaves(reader, "isPartialAdaptationOf", parseString),
    extensions: reader.takeForeign(),
  };
  reader.done();
  return resource;
}

function checkList(value: unknown, label: string): asserts value is readonly unknown[] {
  checkArray(value, `The field ${label} must be an array`);
}

/**
 * Writes the description as an `accessForAllResource` element, with its children in the order of the DRD XSD.
 *
 * @throws `DataError` when a field has the wrong type or a term is outside its vocabulary and is not an extension term.
 */
export function writeAccessForAllResource(resource: AccessForAllResource): XmlElement {
  checkRecord(resource, "The accessibility description must be an object");
  const children: XmlElement[] = [];
  const terms = (name: keyof AccessForAllResource, vocabulary: readonly string[]): void => {
    const values: unknown = resource[name];
    checkList(values, name);
    for (const value of values) {
      checkOpenTerm(value, `A term of ${name}`, vocabulary);
      children.push(leaf(DRD, name, value));
    }
  };
  const strings = (name: keyof AccessForAllResource): void => {
    const values: unknown = resource[name];
    checkList(values, name);
    for (const value of values) {
      checkString(value, `A value of ${name}`);
      children.push(leaf(DRD, name, value));
    }
  };
  terms("accessMode", ACCESS_MODES);
  terms("accessModeAdapted", ACCESS_MODES);
  terms("adaptationType", ADAPTATION_TYPES);
  if (resource.atInteroperable !== undefined) {
    checkBoolean(resource.atInteroperable, "The field atInteroperable");
    appendLeaf(children, DRD, "atInteroperable", resource.atInteroperable.toString());
  }
  terms("controlFlexibility", CONTROL_FLEXIBILITY);
  terms("displayTransformability", DISPLAY_TRANSFORMABILITY);
  if (resource.educationalComplexityOfAdaptation !== undefined) {
    checkOpenTerm(
      resource.educationalComplexityOfAdaptation,
      "The field educationalComplexityOfAdaptation",
      COMPLEXITY_OF_ADAPTATION,
    );
    appendLeaf(children, DRD, "educationalComplexityOfAdaptation", resource.educationalComplexityOfAdaptation);
  }
  strings("hasAdaptation");
  terms("hazard", DRD_HAZARDS);
  strings("isAdaptationOf");
  strings("languageOfAdaptation");
  terms("adaptationDetail", ADAPTATION_DETAILS);
  terms("adaptationMediaType", ADAPTATION_MEDIA_TYPES);
  terms("apiInteroperable", API_INTEROPERABLE);
  strings("educationalLevelOfAdaptation");
  strings("isFullAdaptationOf");
  strings("isPartialAdaptationOf");
  checkList(resource.extensions, "extensions");
  for (const extension of resource.extensions) {
    checkRecord(extension, "An extension must be an element");
    if (extension.namespace === DRD_NAMESPACE) {
      throw new DataError(`An extension must not be in the namespace of the DRD XSD, found ${extension.name}.`);
    }
    children.push(extension);
  }
  return branch(DRD, "accessForAllResource", children);
}
