import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import {
  type PersonalNeedsProfile,
  PNP_NAMESPACE,
  readPnp,
  SUPPORT_NAMES,
  type SupportSetting,
  writePnp,
} from "../src/pnp/index.js";
import { parseXml, type XmlElement } from "../src/xml/index.js";
import { asProfile, personalNeedsProfile, pnpRecords, settingFor } from "./arbitraries/pnp.js";
import { declaredNames, unusedNames, usedNames } from "./schema-declarations.js";

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

  it("lists the supports that the schema declares", () => {
    expect([...SUPPORT_NAMES].sort()).toEqual(
      declaredElements(schema, "AccessForAllPNPDType")
        .filter((name) => !name.endsWith("-set"))
        .sort(),
    );
  });

  it("lists in a set the elements that the schema declares for a set", () => {
    const inSets = SUPPORT_NAMES.filter((name) => name !== "hazard-avoidance" && name !== "environment");
    expect([...inSets].sort()).toEqual(declaredElements(schema, "FeatureSetDType").sort());
  });
});

describe("writePnp", () => {
  it("writes a profile with no support", async () => {
    expect(await issuesOf(writePnp(profileWith()))).toEqual([]);
  });

  /** The documents with samples of the settings of every support, one support in each. */
  const settingDocuments = (): { path: string; content: string }[] =>
    SUPPORT_NAMES.flatMap((name) =>
      fc.sample(settingFor(name), { numRuns: 12, seed: 20_230_103 }).map((setting, index) => ({
        path: `${name}-${index}.xml`,
        content: writePnp(profileWith(setting)),
      })),
    );

  it("writes samples of the settings of every support as elements that the schema accepts", async () => {
    const files = settingDocuments();
    expect(files.length).toBeGreaterThan(400);
    expect(await validateXmlFiles(schemas, files)).toEqual([]);
  });

  it("writes every element and attribute that the schema declares, and reads them back", () => {
    const profiles = fc.sample(personalNeedsProfile({ extensions: false }), { numRuns: 80, seed: 20_230_101 });
    const bulk = fc.sample(pnpRecords, { numRuns: 30, seed: 20_230_102 });
    const documents = [...settingDocuments().map(({ content }) => content), ...[...profiles, ...bulk].map(writePnp)];
    for (const text of documents) expect(writePnp(readPnp(text))).toBe(text);
    const declared = declaredNames(schemaDirectory, ["imsqtiv3p0_afa3p0pnp_v1p0.xsd"]);
    expect(unusedNames(declared, usedNames(documents, [PNP_NAMESPACE]))).toEqual([]);
  });

  it("shows that the schema refuses a color theme, and that what the writer makes of one passes", async () => {
    const document = `<access-for-all-pnp xmlns="${PNP_NAMESPACE}"><text-appearance><color-theme>yellow-blue</color-theme></text-appearance></access-for-all-pnp>`;
    expect(await issuesOf(document)).toMatchObject([{ rule: "assesskit/node/xsd-invalid" }]);
    expect(await issuesOf(writePnp(readPnp(document)))).toEqual([]);
  });

  it("writes the three sets", async () => {
    const profile: PersonalNeedsProfile = {
      ...profileWith(),
      activateAtInitialization: new Set(["spoken", "dictionary-on-screen"]),
      activateAsOption: new Set(["magnification", "language-of-interface"]),
      prohibited: new Set(["answer-masking", "text-appearance"]),
    };
    expect(await issuesOf(writePnp(profile))).toEqual([]);
  });

  it("writes a bulk file with candidates and appointments", async () => {
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

  it("writes the schema's namespace for a profile that was read in another", async () => {
    const read = readPnp(
      '<access-for-all-pnp xmlns="http://www.imsglobal.org/xsd/qt/qtiv3p0/imsafa3p0pnp_v1p0"><captions/></access-for-all-pnp>',
    );
    const text = writePnp(asProfile(read));
    expect(text).toContain(`xmlns="${PNP_NAMESPACE}"`);
    expect(await issuesOf(text)).toEqual([]);
  });

  it("has a schema that rejects what the writer refuses: a volume above 1 and an extension term with a hyphen", async () => {
    const document = (children: string): string =>
      `<access-for-all-pnp xmlns="${PNP_NAMESPACE}">${children}</access-for-all-pnp>`;
    expect(await issuesOf(document("<spoken><volume>2</volume></spoken>"))).toMatchObject([
      { rule: "assesskit/node/xsd-invalid" },
    ]);
    expect(
      await issuesOf(document("<spoken><restriction-type>ext:iowa-reading</restriction-type></spoken>")),
    ).toMatchObject([{ rule: "assesskit/node/xsd-invalid" }]);
    expect(await issuesOf(document("<spoken><restriction-type>ext:iowa.reading</restriction-type></spoken>"))).toEqual(
      [],
    );
  });
});

describe("properties", () => {
  it("writes profiles that the PNP schema accepts", async () => {
    const samples = fc.sample(personalNeedsProfile({ extensions: false }), { numRuns: 80, seed: 20_230_101 });
    const files = samples.map((model, index) => ({ path: `pnp-${index}.xml`, content: writePnp(model) }));
    expect(await validateXmlFiles(schemas, files)).toEqual([]);
  });

  it("writes bulk files that the PNP schema accepts", async () => {
    const samples = fc.sample(pnpRecords, { numRuns: 30, seed: 20_230_102 });
    const files = samples.map((model, index) => ({ path: `records-${index}.xml`, content: writePnp(model) }));
    expect(await validateXmlFiles(schemas, files)).toEqual([]);
  });
});
