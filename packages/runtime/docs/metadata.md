# metadata

`@assesskit/runtime/metadata` reads and writes the metadata of a resource in a QTI content package: QTI metadata, IEEE
LOM, curriculum standards and the accessibility description of a variant. It uses no platform API and runs in any JavaScript
runtime. `package` builds on it, and the manifest carries the metadata of each resource.

| Export                                                                   | Purpose                                                                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `readResourceMetadata(element, path?)`, `writeResourceMetadata`          | The metadata of a resource: `lom`, `qti` and `curriculumStandards` (`ResourceMetadata`).            |
| `readQtiMetadata`, `writeQtiMetadata`, `checkQtiMetadata`, `QtiMetadata` | The `qtiMetadata` element (MD §2.3.1).                                                              |
| `readCurriculumStandardsSet`, `writeCurriculumStandardsSet`              | The `curriculumStandardsMetadataSet` element (CSM XSD).                                             |
| `readAccessForAllResource`, `writeAccessForAllResource`                  | The `accessForAllResource` element (DRD XSD).                                                       |
| `lomGeneral(lom)`                                                        | The identifiers and titles of the LOM category `general`.                                           |
| `INTERACTION_TYPES`, `FEEDBACK_TYPES`, `SCORING_MODES`                   | The vocabularies of QTI metadata. The DRD vocabularies are `ACCESS_MODES`, `DRD_HAZARDS` and so on. |
| `*_NAMESPACE`                                                            | The namespaces of QTI metadata, LOM, curriculum standards, the DRD and content packaging.           |

Readers take a parsed `XmlElement` (`parseXml` of [xml](xml.md)); writers return one, and `serializeXml` writes it. `path`
names the document in the issues of a `ReadError`.

## Example

```ts
import { lomGeneral, readResourceMetadata } from "@assesskit/runtime/metadata";
import { parseXml } from "@assesskit/runtime/xml";

const metadata = readResourceMetadata(
  parseXml(`<metadata xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"
    xmlns:qmd="http://www.imsglobal.org/xsd/imsqti_metadata_v3p0" xmlns:lom="http://ltsc.ieee.org/xsd/LOM">
  <qmd:qtiMetadata>
    <qmd:timeDependent>false</qmd:timeDependent>
    <qmd:interactionType>choiceInteraction</qmd:interactionType>
    <qmd:feedbackType>nonadaptive</qmd:feedbackType>
    <qmd:solutionAvailable>true</qmd:solutionAvailable>
  </qmd:qtiMetadata>
  <lom:lom><lom:general>
    <lom:identifier><lom:entry>capital</lom:entry></lom:identifier>
    <lom:title><lom:string language="en">Capital city</lom:string></lom:title>
  </lom:general></lom:lom>
</metadata>`),
);
metadata.qti;
// { timeDependent: false, interactionTypes: ["choiceInteraction"], feedbackType: "nonadaptive",
//   solutionAvailable: true, scoringModes: [] }
metadata.lom && lomGeneral(metadata.lom);
// { identifiers: ["capital"], titles: [{ language: "en", text: "Capital city" }] }
```

## Resource metadata

`readResourceMetadata` reads one of two elements:

- The `metadata` element of a resource in a manifest (BIND §8.8). It may contain one each of `qmd:qtiMetadata`,
  `csmd:curriculumStandardsMetadataSet` and `lom:lom`, in that order. Another element is a `ReadError`.
- The root `lom` element of an external metadata file (resource type `resourcemetadata/xml`, BPIG §6.3), which holds the QTI
  metadata and the curriculum standards among the LOM elements. The result's `lom` is that element without the two.

`writeResourceMetadata` writes the first form, in the namespace of content packaging, with the children in the order of the CP
schema: QTI metadata, curriculum standards, LOM.

## QTI metadata

`QtiMetadata` has the fields of MD §2.3.1. A field that the document omits is `undefined`; the two lists are empty.

| Field                                        | Type                                          | Meaning                                                             |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| `itemTemplate`, `timeDependent`, `composite` | `boolean`                                     | An item template, a time dependent item, more than one interaction. |
| `interactionTypes`                           | `InteractionType[]`                           | The 22 terms of MD §2.6.2, such as `choiceInteraction`.             |
| `portableCustomInteractionContext`           | `{ customTypeIdentifier?, interactionKind? }` | MD §2.4.1.                                                          |
| `feedbackType`                               | `"adaptive" \| "nonadaptive" \| "none"`       | MD §2.6.1.                                                          |
| `solutionAvailable`                          | `boolean`                                     | The item declares a correct response.                               |
| `scoringModes`                               | `ScoringMode[]`                               | `human`, `externalmachine`, `responseprocessing` (MD §2.6.3).       |
| `toolName`, `toolVersion`, `toolVendor`      | `string`                                      | At most 256 characters each (MD §2.5.1).                            |

Booleans are `true`, `false`, `1` or `0`, with white space around them ignored. `customTypeIdentifier` and `interactionKind`
are `xs:normalizedString`: a tab, line feed or carriage return reads as a space. The writer writes the children in the order of
the schema, whatever the order of the fields.

`checkQtiMetadata(value)` throws a `DataError` unless the value is valid QTI metadata: the types of the fields, the terms of
the vocabularies and the length of the tool strings. `writeQtiMetadata` and `cat.catMetadata` check their input with it.

## Derived metadata

`deriveQtiMetadata(item)` takes an item from `readAsi` and returns the `QtiMetadata` that the item shows (MD §2.3.1):

| Field                              | Derived as                                                                                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `itemTemplate`                     | True when the item has template processing (MD §2.3.1.1).                                                                                                                                    |
| `timeDependent`                    | The attribute `time-dependent`.                                                                                                                                                              |
| `composite`                        | True when the body has more than one interaction.                                                                                                                                            |
| `interactionTypes`                 | The type of each interaction in the body, found at any depth, each type once, in the order of the model: document order, except that the places of one element come in schema order.         |
| `portableCustomInteractionContext` | For a portable custom interaction, `customTypeIdentifier` of the first one. The item does not have `interactionKind`.                                                                        |
| `feedbackType`                     | `none` without `qti-modal-feedback`, `qti-feedback-block` and `qti-feedback-inline`; otherwise `adaptive` for an item with `adaptive="true"` and `nonadaptive` for any other (MD §2.6.1).    |
| `solutionAvailable`                | True when the item declares a response and every declared response has a correct response, in its declaration or set by `qti-set-correct-response` in the template processing (MD §2.3.1.7). |
| `scoringModes`                     | `human` and `externalmachine` for the outcomes with `external-scored`, and `responseprocessing` when the item has response processing (MD §2.6.3), in the order of the vocabulary.           |
| `toolName`, `toolVersion`          | The attributes `tool-name` and `tool-version`, when they have at most 256 characters. `toolVendor` is not in the item.                                                                       |

The metadata that an author wrote in a manifest can differ from what the item shows. In the 32 example items that have both, the
derived values agree on every field but twelve: authors wrote `nonadaptive` for items without feedback, `extendedTextInteraction`
for items with a text entry, no solution for items that declare correct responses, and a solution for an item that declares correct
responses for one of its two responses ([Evidence](evidence.md)).

## LOM

The LOM stays XML. `ResourceMetadata.lom` is the `lom:lom` element with all its categories (`general`, `lifeCycle`,
`metaMetadata`, `technical`, `educational`, `rights`, `relation`, `annotation`, `classification`; MD §2.7.1 to §2.7.9), and
`lomGeneral(lom)` returns what the package needs of `general`:

| Field         | Content                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `identifiers` | The `entry` of each `identifier`, in document order. An identifier with only a `catalog` is left out.  |
| `titles`      | The `string` elements of `title`, with `language` from the attribute `language` or `xml:lang`, if any. |

The writer declares the namespaces that a kept subtree uses, so a subtree read from a document whose root declared them can be
written elsewhere.

## Curriculum standards

`CurriculumStandardsSet` mirrors the CSM schema: `resourceLabel`, `resourcePartId` and a list of `standards`
(`providerId`, `guidSets`); a `GuidSet` has `region`, `version` and `labelledGuids`, and a `LabelledGuid` has `label`,
`caseItemUri` (kept as a string) and `guid`, which is required. The lists in the schema have at least one item, so the
writer throws a `DataError` for an empty one; the reader accepts what the document has.

## Accessibility description

`AccessForAllResource` has one field per element of the DRD schema, with the name of the element: ten fields with a vocabulary,
`atInteroperable`, `educationalLevelOfAdaptation`, `languageOfAdaptation` and the four lists of URIs (`hasAdaptation`,
`isAdaptationOf`, `isFullAdaptationOf`, `isPartialAdaptationOf`). The lists are empty when the element does not occur;
`atInteroperable` and `educationalComplexityOfAdaptation` are `undefined`.

| Field                                                               | Terms                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `accessMode`, `accessModeAdapted`                                   | `ACCESS_MODES`: 10 terms, such as `auditory`, `visual`, `textual`.                       |
| `adaptationDetail`, `adaptationMediaType`, `adaptationType`         | `ADAPTATION_DETAILS`, `ADAPTATION_MEDIA_TYPES`, `ADAPTATION_TYPES`.                      |
| `apiInteroperable`, `controlFlexibility`, `displayTransformability` | `API_INTEROPERABLE`, `CONTROL_FLEXIBILITY`, `DISPLAY_TRANSFORMABILITY`.                  |
| `educationalComplexityOfAdaptation`                                 | `COMPLEXITY_OF_ADAPTATION`: `enriched`, `simplified`.                                    |
| `hazard`                                                            | `DRD_HAZARDS`: `flashing`, `sound`, `olfactoryHazard`, `motionSimulation` (`DrdHazard`). |

Each vocabulary also takes an extension term, `ext:` and letters, digits, spaces, `.`, `_` and `|` (`ExtensionTerm`). Any other
term is a `ReadError`, or a `DataError` in the writer. The elements come in the order of the DRD schema, in the reader and the writer. `extensions` holds the elements of other namespaces that the schema allows after the DRD elements.

## Errors

| Code                                                         | Class       | Meaning                                                                                           | Source      |
| ------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------- | ----------- |
| `assesskit/metadata/invalid-text`                            | `ReadError` | A boolean, term or string that its element does not allow.                                        | MD, DRD XSD |
| `assesskit/metadata/unexpected-element`                      | `ReadError` | An element that the schema does not allow at that place: not declared, repeated, or out of order. | the schema  |
| `assesskit/metadata/missing-element`                         | `ReadError` | An element that the schema requires, such as a `GUID`.                                            | the schema  |
| `assesskit/metadata/unexpected-attribute`, `unexpected-text` | `ReadError` | An attribute the schema does not declare, or text in an element that has elements only.           | the schema  |
| `assesskit/metadata/duplicate-element`                       | `ReadError` | An external metadata file has the QTI metadata or the curriculum standards twice.                 | BIND §8.8   |

The readers throw `DataError` for an argument of the wrong type. The writers throw `DataError` for a model that is not valid.
