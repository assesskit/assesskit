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
  DISPLAY_TRANSFORMABILITY,
  DRD_HAZARDS,
  FEEDBACK_TYPES,
  INTERACTION_TYPES,
  SCORING_MODES,
  serializeXml,
  writeAccessForAllResource,
  writeCurriculumStandardsSet,
  writeQtiMetadata,
  writeResourceMetadata,
  type XmlElement,
} from "../src/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import { accessForAllResource, curriculumStandardsSet, lom, qtiMetadata } from "./metadata-generators.js";

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(requireSchemas(new URL("../../..", import.meta.url).pathname));
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
  it("[Q1][Q2][Q3][Q4][Q5][Q6][Q7][Q8][Q9][Q10][Q11][Q12][Q13][Q14] accepts the QTI metadata that writeQtiMetadata writes", async () => {
    await fc.assert(
      fc.asyncProperty(qtiMetadata, async (metadata) => {
        expect(await messages(writeQtiMetadata(metadata))).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it("[Q27][Q28][Q29][Q30] accepts the curriculum standards that writeCurriculumStandardsSet writes", async () => {
    await fc.assert(
      fc.asyncProperty(curriculumStandardsSet, async (set) => {
        expect(await messages(writeCurriculumStandardsSet(set))).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it("[Q31][Q32] accepts the accessibility description that writeAccessForAllResource writes, in the order of the schema", async () => {
    await fc.assert(
      // The schema's wildcard is strict, so that an extension must be an element that a schema declares: none here.
      fc.asyncProperty(accessForAllResource, async (resource) => {
        expect(await messages(writeAccessForAllResource({ ...resource, extensions: [] }))).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it("[Q18] accepts a lom in the loose binding, and the resource metadata around it", async () => {
    await fc.assert(
      fc.asyncProperty(lom, async (generated) => {
        expect(await messages(generated)).toEqual([]);
      }),
      { numRuns: 20 },
    );
  });

  it("[K6] writes resource metadata that the manifest schema accepts inside a resource", async () => {
    const element = writeResourceMetadata({ qti: { interactionTypes: ["choiceInteraction"], scoringModes: [] } });
    const manifest = `<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="m"><metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata><organizations/><resources><resource identifier="a" type="webcontent">${serializeXml(element).replace(/^<\?xml[^>]*\?>\n/, "")}<file href="a"/></resource></resources></manifest>`;
    expect(await messages(manifest)).toEqual([]);
  });
});

describe("the vocabularies against the XSD", () => {
  it("[Q15] has the 22 interaction types that the metadata schema enumerates, and no other", async () => {
    for (const type of INTERACTION_TYPES)
      expect(await messages(qmd(`<interactionType>${type}</interactionType>`)), type).toEqual([]);
    expect(await messages(qmd("<interactionType>choice</interactionType>"))).not.toEqual([]);
  });

  it("[Q16][Q17] has the feedback types and scoring modes that the metadata schema enumerates, and no other", async () => {
    for (const type of FEEDBACK_TYPES)
      expect(await messages(qmd(`<feedbackType>${type}</feedbackType>`)), type).toEqual([]);
    for (const mode of SCORING_MODES)
      expect(await messages(qmd(`<scoringMode>${mode}</scoringMode>`)), mode).toEqual([]);
    expect(await messages(qmd("<feedbackType>other</feedbackType>"))).not.toEqual([]);
    expect(await messages(qmd("<scoringMode>externalMachine</scoringMode>"))).not.toEqual([]);
  });

  it("[Q32] has the terms that the DRD schema enumerates for each element, and no other", async () => {
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
