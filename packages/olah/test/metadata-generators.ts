import fc from "fast-check";
import {
  ACCESS_MODES,
  type AccessForAllResource,
  ADAPTATION_DETAILS,
  ADAPTATION_MEDIA_TYPES,
  ADAPTATION_TYPES,
  API_INTEROPERABLE,
  COMPLEXITY_OF_ADAPTATION,
  CONTROL_FLEXIBILITY,
  type CurriculumStandardsSet,
  DISPLAY_TRANSFORMABILITY,
  DRD_HAZARDS,
  type ExtensionTerm,
  FEEDBACK_TYPES,
  type GuidSet,
  INTERACTION_TYPES,
  type LabelledGuid,
  LOM_NAMESPACE,
  type QtiMetadata,
  SCORING_MODES,
  XMLNS_NAMESPACE,
  type XmlElement,
} from "../src/index.js";

/** Printable ASCII text without a line end or tab, which `xs:normalizedString` would change. */
const text = fc.string({ maxLength: 20 });
/** A URI reference of letters, digits and a few separators, which `xs:anyURI` accepts. */
export const uri: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(..."abc019-_./"), { maxLength: 8 })
  .map((characters) => characters.join(""));
const optional = <T>(value: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> => fc.option(value, { nil: undefined });

const extensionTerm: fc.Arbitrary<ExtensionTerm> = fc
  .array(fc.constantFrom(..."abcXYZ019._ |"), { minLength: 1, maxLength: 8 })
  .map((characters): ExtensionTerm => `ext:${characters.join("")}`);

const openTerms = <T extends string>(vocabulary: readonly T[]): fc.Arbitrary<(T | ExtensionTerm)[]> =>
  fc.array(
    fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...vocabulary) }, { weight: 1, arbitrary: extensionTerm }),
    {
      maxLength: 3,
    },
  );

/** QTI metadata with each field present or absent, and strings of up to 20 characters. */
export const qtiMetadata: fc.Arbitrary<QtiMetadata> = fc.record({
  itemTemplate: optional(fc.boolean()),
  timeDependent: optional(fc.boolean()),
  composite: optional(fc.boolean()),
  interactionTypes: fc.array(fc.constantFrom(...INTERACTION_TYPES), { maxLength: 4 }),
  portableCustomInteractionContext: optional(
    fc.record({ customTypeIdentifier: optional(text), interactionKind: optional(text) }),
  ),
  feedbackType: optional(fc.constantFrom(...FEEDBACK_TYPES)),
  solutionAvailable: optional(fc.boolean()),
  scoringModes: fc.array(fc.constantFrom(...SCORING_MODES), { maxLength: 3 }),
  toolName: optional(text),
  toolVersion: optional(text),
  toolVendor: optional(text),
});

const labelledGuid: fc.Arbitrary<LabelledGuid> = fc.record({
  label: optional(text),
  caseItemUri: optional(uri),
  guid: text,
});

const guidSet: fc.Arbitrary<GuidSet> = fc.record({
  region: optional(text),
  version: optional(text),
  labelledGuids: fc.array(labelledGuid, { minLength: 1, maxLength: 2 }),
});

/** Curriculum standards with every list non-empty, as the CSM schema requires. */
export const curriculumStandardsSet: fc.Arbitrary<CurriculumStandardsSet> = fc.record({
  resourceLabel: optional(text),
  resourcePartId: optional(text),
  standards: fc.array(
    fc.record({ providerId: optional(text), guidSets: fc.array(guidSet, { minLength: 1, maxLength: 2 }) }),
    { minLength: 1, maxLength: 2 },
  ),
});

/** A foreign element for the extension point of the DRD, with its own namespace declaration. */
const extension: fc.Arbitrary<XmlElement> = text.map(
  (value): XmlElement => ({
    kind: "element",
    namespace: "urn:extension",
    prefix: "x",
    name: "note",
    attributes: [{ namespace: XMLNS_NAMESPACE, prefix: "xmlns", name: "x", value: "urn:extension" }],
    children: value === "" ? [] : [{ kind: "text", value }],
  }),
);

/** An accessibility description with terms from the vocabularies and extension terms. */
export const accessForAllResource: fc.Arbitrary<AccessForAllResource> = fc.record({
  accessMode: openTerms(ACCESS_MODES),
  accessModeAdapted: openTerms(ACCESS_MODES),
  adaptationType: openTerms(ADAPTATION_TYPES),
  atInteroperable: optional(fc.boolean()),
  controlFlexibility: openTerms(CONTROL_FLEXIBILITY),
  displayTransformability: openTerms(DISPLAY_TRANSFORMABILITY),
  educationalComplexityOfAdaptation: optional(fc.oneof(fc.constantFrom(...COMPLEXITY_OF_ADAPTATION), extensionTerm)),
  hasAdaptation: fc.array(uri, { maxLength: 2 }),
  hazard: openTerms(DRD_HAZARDS),
  isAdaptationOf: fc.array(uri, { maxLength: 2 }),
  languageOfAdaptation: fc.array(text, { maxLength: 2 }),
  adaptationDetail: openTerms(ADAPTATION_DETAILS),
  adaptationMediaType: openTerms(ADAPTATION_MEDIA_TYPES),
  apiInteroperable: openTerms(API_INTEROPERABLE),
  educationalLevelOfAdaptation: fc.array(text, { maxLength: 2 }),
  isFullAdaptationOf: fc.array(uri, { maxLength: 2 }),
  isPartialAdaptationOf: fc.array(uri, { maxLength: 2 }),
  extensions: fc.array(extension, { maxLength: 2 }),
});

/** A `lom` element that declares its own namespace, with a title and an identifier. */
export const lom: fc.Arbitrary<XmlElement> = fc.tuple(text, text).map(([identifier, title]): XmlElement => {
  const leaf = (name: string, value: string): XmlElement => ({
    kind: "element",
    namespace: LOM_NAMESPACE,
    prefix: "lom",
    name,
    attributes: [],
    children: value === "" ? [] : [{ kind: "text", value }],
  });
  const branch = (name: string, children: XmlElement[]): XmlElement => ({
    kind: "element",
    namespace: LOM_NAMESPACE,
    prefix: "lom",
    name,
    attributes: [],
    children,
  });
  return {
    kind: "element",
    namespace: LOM_NAMESPACE,
    prefix: "lom",
    name: "lom",
    attributes: [{ namespace: XMLNS_NAMESPACE, prefix: "xmlns", name: "lom", value: LOM_NAMESPACE }],
    children: [
      branch("general", [branch("identifier", [leaf("entry", identifier)]), branch("title", [leaf("string", title)])]),
    ],
  };
});
