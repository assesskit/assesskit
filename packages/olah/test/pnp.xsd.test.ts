import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import {
  type PersonalNeedsProfile,
  PNP_NAMESPACE,
  parseXml,
  readPnp,
  SUPPORT_NAMES,
  type SupportSetting,
  writePnp,
  type XmlElement,
} from "../src/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import { asProfile, personalNeedsProfile, pnpRecords, settingFor } from "./arbitraries/pnp.js";

const root = resolve(import.meta.dirname, "../../..");
const schemaDirectory = requireSchemas(root);

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(schemaDirectory);
});

afterAll(() => {
  schemas.close();
});

/** Returns the issues of the PNP schema for a document. */
const issuesOf = (content: string, path = "pnp.xml"): Promise<readonly unknown[]> =>
  validateXmlFiles(schemas, [{ path, content }]);

/** The element children of an element, in order. */
const elementsOf = (element: XmlElement): XmlElement[] => element.children.filter((child) => child.kind === "element");

/** The names of the elements that a named complex type of the schema declares, apart from the wildcard. */
function declaredElements(schema: XmlElement, typeName: string): string[] {
  const type = elementsOf(schema).find((child) =>
    child.attributes.some(({ name, value }) => name === "name" && value === typeName),
  );
  if (type === undefined) throw new Error(`The schema has no type ${typeName}.`);
  const found: string[] = [];
  const visit = (node: XmlElement): void => {
    if (node.name === "element") {
      const name = node.attributes.find((attribute) => attribute.name === "name");
      if (name !== undefined) found.push(name.value);
      return;
    }
    for (const child of elementsOf(node)) visit(child);
  };
  visit(type);
  return found;
}

const profileWith = (...settings: SupportSetting[]): PersonalNeedsProfile => ({
  supports: new Map(settings.map((setting) => [setting.name, setting])),
  activateAsOption: new Set(),
  activateAtInitialization: new Set(),
  prohibited: new Set(),
  extensions: [],
});

describe("support names", () => {
  const schema = parseXml(readFileSync(join(schemaDirectory, "imsqtiv3p0_afa3p0pnp_v1p0.xsd"), "utf8"));

  it("[P1][P2][P3][P4][P5][P6][P7][P8][P9][P10][P11][P12][P13][P14][P15][P16][P17][P18][P19][P20][P21][P22][P23][P24][P25][P26][P27][P28][P29][P30][P31][P32][P33][P34][P35][P36][P37][P38][P39][P40] lists the supports that the schema declares", () => {
    expect([...SUPPORT_NAMES].sort()).toEqual(
      declaredElements(schema, "AccessForAllPNPDType")
        .filter((name) => !name.endsWith("-set"))
        .sort(),
    );
  });

  it("[P41][P42][P43] lists in a set the elements that the schema declares for a set", () => {
    const inSets = SUPPORT_NAMES.filter((name) => name !== "hazard-avoidance" && name !== "environment");
    expect([...inSets].sort()).toEqual(declaredElements(schema, "FeatureSetDType").sort());
  });
});

describe("writePnp", () => {
  it("[P44][X] writes a profile with no support", async () => {
    expect(await issuesOf(writePnp(profileWith()))).toEqual([]);
  });

  it("[P1][P2][P3][P4][P5][P6][P7][P8][P9][P10][P11][P12][P13][P14][P15][P16][P17][P18][P19][P20][P21][P22][P23][P24][P25][P26][P27][P28][P29][P30][P31][P32][P33][P34][P35][P36][P37][P38][P39][P40][X] writes samples of the settings of every support as elements that the schema accepts", async () => {
    const files = SUPPORT_NAMES.flatMap((name) =>
      fc.sample(settingFor(name), { numRuns: 12, seed: 20_230_103 }).map((setting, index) => ({
        path: `${name}-${index}.xml`,
        content: writePnp(profileWith(setting)),
      })),
    );
    expect(files.length).toBeGreaterThan(400);
    expect(await validateXmlFiles(schemas, files)).toEqual([]);
  });

  it("[P41][P42][P43][X] writes the three sets", async () => {
    const profile: PersonalNeedsProfile = {
      ...profileWith(),
      activateAtInitialization: new Set(["spoken", "dictionary-on-screen"]),
      activateAsOption: new Set(["magnification", "language-of-interface"]),
      prohibited: new Set(["answer-masking", "text-appearance"]),
    };
    expect(await issuesOf(writePnp(profile))).toEqual([]);
  });

  it("[P45][P46][P47][P48][X] writes a bulk file with candidates and appointments", async () => {
    const profile = profileWith();
    const text = writePnp([
      { personSourcedId: { sourceSystem: "IMSGlobalExamples", id: "111" }, appointmentIds: [], profile },
      {
        personSourcedId: { sourceSystem: "IMSGlobalExamples", id: "1000001" },
        appointmentIds: ["g8alg12345", "g8ela12345"],
        profile,
      },
    ]);
    expect(await issuesOf(text)).toEqual([]);
  });

  it("[S13][L15][X] writes the schema's namespace for a profile that was read in another", async () => {
    const read = readPnp(
      '<access-for-all-pnp xmlns="http://www.imsglobal.org/xsd/qt/qtiv3p0/imsafa3p0pnp_v1p0"><captions/></access-for-all-pnp>',
    );
    const text = writePnp(asProfile(read));
    expect(text).toContain(`xmlns="${PNP_NAMESPACE}"`);
    expect(await issuesOf(text)).toEqual([]);
  });

  it("[X][N] has a schema that rejects what the writer refuses: a volume above 1 and an extension term with a hyphen", async () => {
    const document = (children: string): string =>
      `<access-for-all-pnp xmlns="${PNP_NAMESPACE}">${children}</access-for-all-pnp>`;
    expect(await issuesOf(document("<spoken><volume>2</volume></spoken>"))).toMatchObject([
      { code: "olah/node/xsd-invalid" },
    ]);
    expect(
      await issuesOf(document("<spoken><restriction-type>ext:iowa-reading</restriction-type></spoken>")),
    ).toMatchObject([{ code: "olah/node/xsd-invalid" }]);
    expect(await issuesOf(document("<spoken><restriction-type>ext:iowa.reading</restriction-type></spoken>"))).toEqual(
      [],
    );
  });
});

describe("properties", () => {
  it("[P44][X] writes profiles that the PNP schema accepts", async () => {
    const samples = fc.sample(personalNeedsProfile({ extensions: false }), { numRuns: 80, seed: 20_230_101 });
    const files = samples.map((model, index) => ({ path: `pnp-${index}.xml`, content: writePnp(model) }));
    expect(await validateXmlFiles(schemas, files)).toEqual([]);
  });

  it("[P45][P46][X] writes bulk files that the PNP schema accepts", async () => {
    const samples = fc.sample(pnpRecords, { numRuns: 30, seed: 20_230_102 });
    const files = samples.map((model, index) => ({ path: `records-${index}.xml`, content: writePnp(model) }));
    expect(await validateXmlFiles(schemas, files)).toEqual([]);
  });
});
