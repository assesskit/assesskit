import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataError, type Manifest, ReadError, SecurityError, writeManifest, writePackage } from "../src/index.js";
import { loadSchemaSet, readPackageFile, SCHEMA_FILES, validateXmlFiles, writePackageFile } from "../src/node/index.js";
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
    directory = mkdtempSync(join(tmpdir(), "runtime-schemas-"));
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

const MANIFEST: Manifest = {
  identifier: "m",
  metadata: { schema: "QTI Package" },
  resources: [{ identifier: "a", type: "webcontent", files: [{ href: "a.txt" }], dependencies: [], variants: [] }],
};
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const POSIX = process.platform !== "win32";

describe("readPackageFile", () => {
  let directory: string;
  let counter = 0;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "runtime-package-"));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  /** Writes an unpacked package of the given files in a new directory and returns the directory. */
  function unpacked(files: Readonly<Record<string, string>>): string {
    const target = join(directory, `package-${counter++}`);
    for (const [path, content] of Object.entries({ "imsmanifest.xml": writeManifest(MANIFEST), ...files })) {
      mkdirSync(dirname(join(target, path)), { recursive: true });
      writeFileSync(join(target, path), content);
    }
    return target;
  }

  it("[K30] reads a ZIP file that writePackageFile writes", async () => {
    const file = join(directory, "package.zip");
    await writePackageFile(file, MANIFEST, new Map([["a.txt", bytes("hello")]]));
    const pkg = await readPackageFile(file);
    expect(pkg.paths).toEqual(["imsmanifest.xml", "a.txt"]);
    expect(pkg.file("a.txt")).toEqual(bytes("hello"));
  });

  it("[K30] reads an unpacked directory: its files in order, read when asked for", async () => {
    const root = unpacked({ "items/b.xml": "<b/>", "a.txt": "hello", "items/sub/c.txt": "c" });
    const pkg = await readPackageFile(root);
    expect(pkg.paths).toEqual(["a.txt", "imsmanifest.xml", "items/b.xml", "items/sub/c.txt"]);
    expect(pkg.file("a.txt")).toEqual(bytes("hello"));
    expect(pkg.file("items/sub/c.txt")).toEqual(bytes("c"));
    expect(pkg.file("missing")).toBeUndefined();
    expect(pkg.manifest.identifier).toBe("m");
  });

  it.skipIf(!POSIX)(
    "[K30][B94] rejects a directory with a symbolic link to a file inside it, to a file outside it and to a directory outside it",
    async () => {
      const outside = join(directory, "outside.txt");
      writeFileSync(outside, "secret");
      mkdirSync(join(directory, "outside-dir"), { recursive: true });
      for (const [name, target] of [
        ["inside", "imsmanifest.xml"],
        ["file", outside],
        ["dir", join(directory, "outside-dir")],
        ["dangling", join(directory, "nowhere")],
      ] as const) {
        const root = unpacked({});
        symlinkSync(target, join(root, name));
        const error = await readPackageFile(root).catch((caught: unknown) => caught);
        expect(error, name).toBeInstanceOf(SecurityError);
        expect((error as SecurityError).limit, name).toBe("symlink");
      }
    },
  );

  it.skipIf(!POSIX)(
    "[K30][B94] rejects a symbolic link that replaces a file after the directory was listed, and a directory that is itself a link",
    async () => {
      const root = unpacked({ "a.txt": "hello" });
      const pkg = await readPackageFile(root);
      expect(pkg.file("a.txt")).toEqual(bytes("hello"));
      const outside = join(directory, "secret.txt");
      writeFileSync(outside, "secret");
      unlinkSync(join(root, "a.txt"));
      symlinkSync(outside, join(root, "a.txt"));
      expect(() => pkg.file("a.txt")).toThrow(SecurityError);
      const link = join(directory, "link-to-package");
      symlinkSync(unpacked({}), link);
      expect((await readPackageFile(link)).manifest.identifier).toBe("m");
    },
  );

  it.skipIf(!POSIX)("[K30][B94] rejects a file that is neither a regular file nor a directory", async () => {
    const root = unpacked({});
    const server = createServer();
    await new Promise<void>((done) => server.listen(join(root, "socket"), done));
    try {
      const error = await readPackageFile(root).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SecurityError);
      expect((error as SecurityError).limit).toBe("special-file");
    } finally {
      server.close();
    }
  });

  it.skipIf(!POSIX)("[K30][B94] rejects a file whose name is not allowed in a package", async () => {
    const root = unpacked({});
    writeFileSync(join(root, "a\\b.txt"), "x");
    const error = await readPackageFile(root).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecurityError);
    expect((error as SecurityError).limit).toBe("path");
  });

  it("[K30][B94] applies the limits of entries and sizes to a directory and a ZIP file", async () => {
    const root = unpacked({ "a.txt": "a".repeat(100), "b.txt": "b".repeat(100) });
    const limit = async (limits: object): Promise<string | undefined> => {
      const error = await readPackageFile(root, JSON.parse(JSON.stringify({ limits }))).catch(
        (caught: unknown) => caught,
      );
      return error instanceof SecurityError ? error.limit : undefined;
    };
    expect(await limit({ maxEntries: 2 })).toBe("maxEntries");
    expect(await limit({ maxEntryBytes: 50 })).toBe("maxEntryBytes");
    expect(await limit({ maxTotalBytes: 150 })).toBe("maxTotalBytes");
    expect(await limit({})).toBeUndefined();
    const file = join(directory, "limited.zip");
    await writePackageFile(
      file,
      MANIFEST,
      new Map([["a.txt", new Uint8Array(5000).map((_, index) => (index * 7919) % 251)]]),
    );
    const error = await readPackageFile(file, { limits: { maxTotalBytes: 1000 } }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecurityError);
    expect((error as SecurityError).limit).toBe("maxTotalBytes");
  });

  it("[K30] passes the xml limits to the manifest", async () => {
    const root = unpacked({});
    const error = await readPackageFile(root, { xmlLimits: { maxNodes: 3 } }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecurityError);
    expect((error as SecurityError).limit).toBe("maxNodes");
  });

  it("[K30] reports a path that does not exist or a directory without a manifest", async () => {
    await expect(readPackageFile(join(directory, "nowhere"))).rejects.toThrow(DataError);
    const empty = join(directory, "empty");
    mkdirSync(empty);
    await expect(readPackageFile(empty)).rejects.toThrow(ReadError);
  });

  it("[K30] throws DataError for input of other types, as JavaScript or JSON pass it", async () => {
    await expect(readPackageFile(JSON.parse("5"))).rejects.toThrow("The path must be a string, found 5.");
    await expect(readPackageFile(JSON.parse("null"))).rejects.toThrow(DataError);
    await expect(readPackageFile(directory, JSON.parse("null"))).rejects.toThrow(DataError);
    await expect(readPackageFile(directory, JSON.parse('{"limits":{"maxEntries":-1}}'))).rejects.toThrow(DataError);
  });
});

describe("writePackageFile", () => {
  let directory: string;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "runtime-write-"));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("[K30] writes the bytes that writePackage returns and replaces an existing file", async () => {
    const file = join(directory, "a.zip");
    writeFileSync(file, "old");
    const files = new Map([["a.txt", bytes("hello")]]);
    await writePackageFile(file, MANIFEST, files);
    expect(new Uint8Array(readFileSync(file))).toEqual(writePackage(MANIFEST, files));
  });

  it("[K30] throws DataError when the file cannot be written, the package is not valid or an argument has another type", async () => {
    await expect(writePackageFile(join(directory, "missing", "a.zip"), MANIFEST, new Map())).rejects.toThrow(DataError);
    await expect(writePackageFile(join(directory, "b.zip"), MANIFEST, new Map([["../x", bytes("x")]]))).rejects.toThrow(
      DataError,
    );
    await expect(writePackageFile(JSON.parse("5"), MANIFEST, new Map())).rejects.toThrow(
      "The path must be a string, found 5.",
    );
    await expect(writePackageFile(join(directory, "c.zip"), JSON.parse("null"), new Map())).rejects.toThrow(DataError);
  });
});
