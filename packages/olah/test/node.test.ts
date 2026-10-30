import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataError } from "../src/index.js";
import { loadSchemaSet, SCHEMA_FILES, validateXmlFiles } from "../src/node/index.js";
import { PRIMARY_SCHEMAS, selectSchema } from "../src/node/select-schema.js";
import { parseXml } from "../src/xml/index.js";

const PURL = "https://purl.imsglobal.org/spec/";

/** The schemas of the table in design §2.3, which lists them by their locations under the purl. */
const EXPECTED_FILES = [
  "imsmd_loose_v1p3p2.xsd",
  "imsqti_asiv3p0_v1p0.xsd",
  "imsqti_asiv3p0p1_v1p0.xsd",
  "imsqti_itemv3p0_v1p0.xsd",
  "imsqti_itemv3p0p1_v1p0.xsd",
  "imsqti_metadatav3p0_v1p0.xsd",
  "imsqti_outcomev3p0_v1p0.xsd",
  "imsqti_outcomev3p0p1_v1p0.xsd",
  "imsqti_responseprocessingv3p0_v1p0.xsd",
  "imsqti_responseprocessingv3p0p1_v1p0.xsd",
  "imsqti_resultv3p0_v1p0.xsd",
  "imsqti_sectionv3p0_v1p0.xsd",
  "imsqti_sectionv3p0p1_v1p0.xsd",
  "imsqti_stimulusv3p0_v1p0.xsd",
  "imsqti_stimulusv3p0p1_v1p0.xsd",
  "imsqti_testv3p0_v1p0.xsd",
  "imsqti_testv3p0p1_v1p0.xsd",
  "imsqti_usagedatav3p0_v1p0.xsd",
  "imsqtiv3p0_afa3p0drd_v1p0.xsd",
  "imsqtiv3p0_afa3p0pnp_v1p0.xsd",
  "imsqtiv3p0_cpextv1p2_v1p0.xsd",
  "imsqtiv3p0_csmv1p1_v1p0.xsd",
  "imsqtiv3p0_imscpv1p2_v1p0.xsd",
  "mathml3-common.xsd",
  "mathml3-content.xsd",
  "mathml3-presentation.xsd",
  "mathml3-strict-content.xsd",
  "mathml3.xsd",
  "ssmlv1p1-core.xsd",
  "synthesis-nonamespace.xsd",
  "xlink.xsd",
  "xml.xsd",
  "XInclude.xsd",
];

describe("SCHEMA_FILES", () => {
  it("lists the schemas of the ASI, results, usage data, metadata, package, PNP and imported specifications", () => {
    expect(SCHEMA_FILES.map(({ file }) => file).sort()).toEqual([...EXPECTED_FILES].sort());
  });

  it("gives each schema a purl or W3C address, a file name that is the last segment of it, and a SHA-256", () => {
    for (const { url, file, sha256 } of SCHEMA_FILES) {
      expect(url.startsWith(PURL), url).toBe(true);
      expect(url.endsWith(`/${file}`), url).toBe(true);
      expect(sha256, file).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(SCHEMA_FILES.map(({ url }) => url)).size).toBe(SCHEMA_FILES.length);
    expect(new Set(SCHEMA_FILES.map(({ sha256 }) => sha256)).size).toBe(SCHEMA_FILES.length);
  });
});

describe("selectSchema", () => {
  const root = (namespace: string, schemaLocation?: string) =>
    parseXml(
      `<r xmlns="${namespace}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"${schemaLocation === undefined ? "" : ` xsi:schemaLocation="${schemaLocation}"`}/>`,
    );
  const Asi = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

  it("names a pinned schema for each namespace in the table", () => {
    for (const [namespace, file] of PRIMARY_SCHEMAS) {
      expect(
        SCHEMA_FILES.some((schema) => schema.file === file),
        file,
      ).toBe(true);
      expect(selectSchema(root(namespace))?.file).toBe(file);
    }
  });

  it("validates ASI documents against the 3.0.1 schema by default (BPIG §1.1.5)", () => {
    expect(selectSchema(root(Asi))?.file).toBe("imsqti_asiv3p0p1_v1p0.xsd");
  });

  it("takes the pinned schema that the root's xsi:schemaLocation names for its namespace", () => {
    const hint = (file: string) => ` ${Asi}\n\t${PURL}qti/v3p0/schema/xsd/${file} `;
    expect(selectSchema(root(Asi, hint("imsqti_asiv3p0_v1p0.xsd")))?.file).toBe("imsqti_asiv3p0_v1p0.xsd");
    expect(selectSchema(root(Asi, hint("imsqti_itemv3p0p1_v1p0.xsd")))?.file).toBe("imsqti_itemv3p0p1_v1p0.xsd");
  });

  it("ignores a hint that names another namespace, an unknown location or an odd number of tokens", () => {
    expect(selectSchema(root(Asi, `urn:other ${PURL}qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd`))?.file).toBe(
      "imsqti_asiv3p0p1_v1p0.xsd",
    );
    expect(selectSchema(root(Asi, `${Asi} https://example.org/x.xsd`))?.file).toBe("imsqti_asiv3p0p1_v1p0.xsd");
    expect(selectSchema(root(Asi, Asi))?.file).toBe("imsqti_asiv3p0p1_v1p0.xsd");
  });

  it("has no schema for a namespace it does not know, or for no namespace", () => {
    expect(selectSchema(root("urn:other"))).toBeUndefined();
    expect(selectSchema(parseXml("<r/>"))).toBeUndefined();
  });
});

describe("loadSchemaSet", () => {
  let directory = "";

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "olah-schemas-"));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("names every schema that is missing and says where to get them", async () => {
    const empty = join(directory, "empty");
    mkdirSync(empty);
    const message = await loadSchemaSet(empty).then(
      () => "",
      (reason: unknown) => (reason instanceof DataError ? reason.message : ""),
    );
    expect(message.startsWith(`The directory ${empty} does not hold the pinned schemas of SCHEMA_FILES:`)).toBe(true);
    for (const { file } of SCHEMA_FILES)
      expect(message).toContain(`The schema ${file} cannot be read from ${empty}: ENOENT`);
    expect(message.endsWith("\nDownload each url of SCHEMA_FILES to its file name.")).toBe(true);
  });

  it("names a schema whose file has another SHA-256 than the pinned one", async () => {
    const changed = join(directory, "changed");
    mkdirSync(changed);
    writeFileSync(join(changed, "xml.xsd"), "x");
    const pinned = SCHEMA_FILES.find(({ file }) => file === "xml.xsd")?.sha256;
    await expect(loadSchemaSet(changed)).rejects.toThrow(
      `The schema xml.xsd in ${changed} has the SHA-256 2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881, not the pinned ${pinned}.`,
    );
  });

  it("throws DataError for input of other types, as JavaScript or JSON pass it", async () => {
    await expect(loadSchemaSet(JSON.parse("5"))).rejects.toThrow("The schema directory must be a string, found 5.");
    await expect(loadSchemaSet(JSON.parse("null"))).rejects.toThrow(
      "The schema directory must be a string, found null.",
    );
  });
});

describe("validateXmlFiles", () => {
  it("throws DataError for a schema set that loadSchemaSet did not return", async () => {
    await expect(validateXmlFiles(JSON.parse("{}"), [])).rejects.toThrow(
      "The schemas must be a SchemaSet that loadSchemaSet returned.",
    );
    await expect(validateXmlFiles(JSON.parse("null"), [])).rejects.toThrow(DataError);
  });
});
