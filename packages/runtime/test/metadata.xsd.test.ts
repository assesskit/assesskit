import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import {
  ACCESS_MODES,
  ADAPTATION_DETAILS,
  ADAPTATION_MEDIA_TYPES,
  ADAPTATION_TYPES,
  API_INTEROPERABLE,
  COMPLEXITY_OF_ADAPTATION,
  CONTROL_FLEXIBILITY,
  CSM_NAMESPACE,
  DISPLAY_TRANSFORMABILITY,
  DRD_HAZARDS,
  DRD_NAMESPACE,
  FEEDBACK_TYPES,
  INTERACTION_TYPES,
  LOM_NAMESPACE,
  QTI_METADATA_NAMESPACE,
  readAccessForAllResource,
  readCurriculumStandardsSet,
  readQtiMetadata,
  readResourceMetadata,
  SCORING_MODES,
  writeAccessForAllResource,
  writeCurriculumStandardsSet,
  writeQtiMetadata,
  writeResourceMetadata,
} from "../src/metadata/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import { parseXml, serializeXml, type XmlElement } from "../src/xml/index.js";
import { accessForAllResource, curriculumStandardsSet, lom, qtiMetadata } from "./arbitraries/metadata.js";
import { declaredNames, unusedNames, usedNames } from "./schema-declarations.js";

const schemaDirectory = requireSchemas(new URL("../../..", import.meta.url).pathname);

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(schemaDirectory);
});

afterAll(() => {
  schemas.close();
});

async function messages(content: string | XmlElement): Promise<string[]> {
  const text = typeof content === "string" ? content : serializeXml(content);
  return (await validateXmlFiles(schemas, [{ path: "metadata.xml", content: text }])).map(({ message }) => message);
}

const QMD = "http://www.imsglobal.org/xsd/imsqti_metadata_v3p0";
const DRD = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imsafa3p0drd_v1p0";
const qmd = (inner: string): string => `<qtiMetadata xmlns="${QMD}">${inner}</qtiMetadata>`;
const drd = (inner: string): string => `<accessForAllResource xmlns="${DRD}">${inner}</accessForAllResource>`;

describe("the XSD validation of the metadata writers", () => {
  it("accepts the QTI metadata that writeQtiMetadata writes", async () => {
    await fc.assert(
      fc.asyncProperty(qtiMetadata, async (metadata) => {
        expect(await messages(writeQtiMetadata(metadata))).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it("accepts the curriculum standards that writeCurriculumStandardsSet writes", async () => {
    await fc.assert(
      fc.asyncProperty(curriculumStandardsSet, async (set) => {
        expect(await messages(writeCurriculumStandardsSet(set))).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it("accepts the accessibility description that writeAccessForAllResource writes, in the order of the schema", async () => {
    await fc.assert(
      // The schema's wildcard is strict, so that an extension must be an element that a schema declares: none here.
      fc.asyncProperty(accessForAllResource, async (resource) => {
        expect(await messages(writeAccessForAllResource({ ...resource, extensions: [] }))).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it("accepts a lom in the loose binding, and the resource metadata around it", async () => {
    await fc.assert(
      fc.asyncProperty(lom, async (generated) => {
        expect(await messages(generated)).toEqual([]);
      }),
      { numRuns: 20 },
    );
  });

  it("writes resource metadata that the manifest schema accepts inside a resource", async () => {
    const element = writeResourceMetadata({ qti: { interactionTypes: ["choiceInteraction"], scoringModes: [] } });
    const manifest = `<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="m"><metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata><organizations/><resources><resource identifier="a" type="webcontent">${serializeXml(element).replace(/^<\?xml[^>]*\?>\n/, "")}<file href="a"/></resource></resources></manifest>`;
    expect(await messages(manifest)).toEqual([]);
  });
});

describe("the elements and attributes of the schemas", () => {
  /** Returns the elements and attributes that a schema declares and the documents do not use. */
  const unused = (file: string, namespace: string, documents: readonly string[]): string[] =>
    unusedNames(declaredNames(schemaDirectory, [file]), usedNames(documents, [namespace]));

  it("are all written for the QTI metadata, and read back", () => {
    const documents = fc
      .sample(qtiMetadata, { numRuns: 200, seed: 20_230_106 })
      .map((metadata) => serializeXml(writeQtiMetadata(metadata)));
    for (const text of documents) expect(serializeXml(writeQtiMetadata(readQtiMetadata(parseXml(text))))).toBe(text);
    expect(unused("imsqti_metadatav3p0_v1p0.xsd", QTI_METADATA_NAMESPACE, documents)).toEqual([]);
  });

  it("are all written for the curriculum standards, and read back", () => {
    const documents = fc
      .sample(curriculumStandardsSet, { numRuns: 200, seed: 20_230_107 })
      .map((set) => serializeXml(writeCurriculumStandardsSet(set)));
    for (const text of documents)
      expect(serializeXml(writeCurriculumStandardsSet(readCurriculumStandardsSet(parseXml(text))))).toBe(text);
    expect(unused("imsqtiv3p0_csmv1p1_v1p0.xsd", CSM_NAMESPACE, documents)).toEqual([]);
  });

  it("are all written for the accessibility description, and read back", () => {
    const documents = fc
      .sample(accessForAllResource, { numRuns: 200, seed: 20_230_108 })
      .map((resource) => serializeXml(writeAccessForAllResource({ ...resource, extensions: [] })));
    for (const text of documents)
      expect(serializeXml(writeAccessForAllResource(readAccessForAllResource(parseXml(text))))).toBe(text);
    expect(unused("imsqtiv3p0_afa3p0drd_v1p0.xsd", DRD_NAMESPACE, documents)).toEqual([]);
  });

  it("are all kept when a resource's metadata holds a LOM, which stays XML, with each one of them", () => {
    const declared = declaredNames(schemaDirectory, ["imsmd_loose_v1p3p2.xsd"]);
    const prefix = `{${LOM_NAMESPACE}}`;
    const children = [...declared]
      .filter((name) => !name.includes("@"))
      .map((name) => name.slice(prefix.length))
      .map((element) => {
        const attributes = [...declared]
          .filter((name) => name.startsWith(`${prefix}${element}@`))
          .map((name) => ` ${name.slice(name.indexOf("@") + 1)}="x"`);
        return `<lom:${element}${attributes.join("")}/>`;
      });
    const lomDocument = `<lom:lom xmlns:lom="${LOM_NAMESPACE}">${children.join("")}</lom:lom>`;
    const written = serializeXml(writeResourceMetadata(readResourceMetadata(parseXml(lomDocument))));
    expect(unusedNames(declared, usedNames([written], [LOM_NAMESPACE]))).toEqual([]);
  });
});

describe("the vocabularies against the XSD", () => {
  it("has the 22 interaction types that the metadata schema enumerates, and no other", async () => {
    for (const type of INTERACTION_TYPES)
      expect(await messages(qmd(`<interactionType>${type}</interactionType>`)), type).toEqual([]);
    expect(await messages(qmd("<interactionType>choice</interactionType>"))).not.toEqual([]);
  });

  it("has the feedback types and scoring modes that the metadata schema enumerates, and no other", async () => {
    for (const type of FEEDBACK_TYPES)
      expect(await messages(qmd(`<feedbackType>${type}</feedbackType>`)), type).toEqual([]);
    for (const mode of SCORING_MODES)
      expect(await messages(qmd(`<scoringMode>${mode}</scoringMode>`)), mode).toEqual([]);
    expect(await messages(qmd("<feedbackType>other</feedbackType>"))).not.toEqual([]);
    expect(await messages(qmd("<scoringMode>externalMachine</scoringMode>"))).not.toEqual([]);
  });

  it("has the terms that the DRD schema enumerates for each element, and no other", async () => {
    const vocabularies: readonly (readonly [string, readonly string[]])[] = [
      ["accessMode", ACCESS_MODES],
      ["accessModeAdapted", ACCESS_MODES],
      ["adaptationDetail", ADAPTATION_DETAILS],
      ["adaptationMediaType", ADAPTATION_MEDIA_TYPES],
      ["adaptationType", ADAPTATION_TYPES],
      ["apiInteroperable", API_INTEROPERABLE],
      ["controlFlexibility", CONTROL_FLEXIBILITY],
      ["displayTransformability", DISPLAY_TRANSFORMABILITY],
      ["educationalComplexityOfAdaptation", COMPLEXITY_OF_ADAPTATION],
      ["hazard", DRD_HAZARDS],
    ];
    for (const [name, terms] of vocabularies) {
      for (const term of [...terms, "ext:vendor.term_1"])
        expect(await messages(drd(`<${name}>${term}</${name}>`)), `${name} ${term}`).toEqual([]);
      for (const term of ["unknown", "ext:", "ext:a-b"])
        expect(await messages(drd(`<${name}>${term}</${name}>`)), `${name} ${term}`).not.toEqual([]);
    }
  });
});
