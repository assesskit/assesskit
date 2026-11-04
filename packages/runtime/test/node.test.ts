import {
  appendFileSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DataError, ReadError, SecurityError } from "../src/errors.js";
import {
  defaultSchemaDirectory,
  loadSchemaSet,
  readPackageFile,
  SCHEMA_FILES,
  type SchemaFile,
  validateXmlFiles,
} from "../src/node/index.js";
import { PRIMARY_SCHEMAS, pinnedSchemaDirectory, selectSchema, userCacheDirectory } from "../src/node/internal.js";
import { type Manifest, readPackage, writeManifest, writePackage } from "../src/package/index.js";
import { parseXml } from "../src/xml/index.js";

// Reads of the ZIP file are counted, to show that they are ranges; every other function is the real one.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readSync: vi.fn(actual.readSync) };
});

const PURL = "https://purl.imsglobal.org/spec/";

/** The schemas that the runtime pins, by the last segment of their locations under the purl. */
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

const MANIFEST: Manifest = {
  identifier: "m",
  metadata: { schema: "QTI Package" },
  resources: [{ identifier: "a", type: "webcontent", files: [{ href: "a.txt" }], dependencies: [], variants: [] }],
};
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const POSIX = process.platform !== "win32";

describe("reading package files", () => {
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

  it("reads a ZIP file that writePackage writes", async () => {
    const file = join(directory, "package.zip");
    writeFileSync(file, writePackage(MANIFEST, new Map([["a.txt", bytes("hello")]])));
    const pkg = await readPackageFile(file);
    expect(pkg.paths).toEqual(["imsmanifest.xml", "a.txt"]);
    expect(pkg.file("a.txt")).toEqual(bytes("hello"));
  });

  /** Writes a ZIP file whose central directory starts `gap` bytes after its entries end, a hole that the file system does not store. */
  function zipWithHole(name: string, zip: Uint8Array, gap: number): string {
    const path = join(directory, name);
    const end = zip.length - 22;
    const at = new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint32(end + 16, true);
    const patched = zip.slice();
    new DataView(patched.buffer).setUint32(end + 16, at + gap, true);
    const file = openSync(path, "w");
    try {
      writeSync(file, patched, 0, at, 0);
      writeSync(file, patched, at, patched.length - at, at + gap);
    } finally {
      closeSync(file);
    }
    return path;
  }

  /** The bytes that the reads of ZIP files have asked for since the last call. */
  function bytesRead(): number {
    const calls: readonly (readonly unknown[])[] = vi.mocked(readSync).mock.calls;
    const asked = calls.reduce((sum, call) => sum + Number(call[3]), 0);
    vi.mocked(readSync).mockClear();
    return asked;
  }

  it("reads a ZIP file by ranges: its end and central directory when it opens, and the bytes of an entry when it is read", async () => {
    const zip = writePackage(
      MANIFEST,
      new Map([
        ["a.txt", bytes("hello")],
        ["b.txt", bytes("world")],
      ]),
    );
    const path = zipWithHole("hole.zip", zip, 200 * 1024 * 1024);
    bytesRead();
    const pkg = await readPackageFile(path);
    // The last 65,557 bytes at most, where an end record with the longest comment starts, and the directory.
    expect(bytesRead()).toBeLessThan(70_000);
    expect(pkg.paths).toEqual(["imsmanifest.xml", "a.txt", "b.txt"]);
    expect(pkg.file("b.txt")).toEqual(bytes("world"));
    expect(bytesRead()).toBeLessThan(500);
    expect(pkg.file("a.txt")).toEqual(bytes("hello"));
  });

  it("reads the same bytes from a ZIP file as from memory, in the archives that Python writes and in one with ZIP64 records", async () => {
    for (const name of ["valid.zip", "streamed.zip", "zip64.zip"]) {
      const path = join(import.meta.dirname, "fixtures/zip", name);
      const memory = readPackage(new Uint8Array(readFileSync(path)));
      const pkg = await readPackageFile(path);
      expect(pkg.paths, name).toEqual(memory.paths);
      for (const each of memory.paths) expect(pkg.file(each), `${name} ${each}`).toEqual(memory.file(each));
    }
  });

  it("reports a ZIP file that is cut off or gone after it was opened, when a file is read", async () => {
    const zip = writePackage(
      MANIFEST,
      new Map([["a.txt", new Uint8Array(3000).map((_, index) => (index * 7919) % 251)]]),
    );
    const cut = join(directory, "cut.zip");
    writeFileSync(cut, zip);
    const pkg = await readPackageFile(cut);
    truncateSync(cut, 40);
    expect(() => pkg.file("a.txt")).toThrow(ReadError);
    expect(() => pkg.file("a.txt")).toThrow("The data of the archive is cut off.");
    const gone = join(directory, "gone.zip");
    writeFileSync(gone, zip);
    const other = await readPackageFile(gone);
    unlinkSync(gone);
    expect(() => other.file("a.txt")).toThrow(DataError);
    expect(() => other.file("a.txt")).toThrow(`The package ${gone} cannot be read: ENOENT`);
  });

  it("reads an unpacked directory: its files in order, read when asked for", async () => {
    const root = unpacked({ "items/b.xml": "<b/>", "a.txt": "hello", "items/sub/c.txt": "c" });
    const pkg = await readPackageFile(root);
    expect(pkg.paths).toEqual(["a.txt", "imsmanifest.xml", "items/b.xml", "items/sub/c.txt"]);
    expect(pkg.file("a.txt")).toEqual(bytes("hello"));
    expect(pkg.file("items/sub/c.txt")).toEqual(bytes("c"));
    expect(pkg.file("missing")).toBeUndefined();
    expect(pkg.manifest.identifier).toBe("m");
  });

  it.skipIf(!POSIX)(
    "rejects a directory with a symbolic link to a file inside it, to a file outside it and to a directory outside it",
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
    "rejects a symbolic link that replaces a file after the directory was listed, and a directory that is itself a link",
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

  it.skipIf(!POSIX)("rejects a file that became a link to another file of the package after the listing", async () => {
    const root = unpacked({ "a.txt": "hello", "b.txt": "world" });
    const pkg = await readPackageFile(root);
    unlinkSync(join(root, "a.txt"));
    symlinkSync(join(root, "b.txt"), join(root, "a.txt"));
    const error = (() => {
      try {
        return pkg.file("a.txt");
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(SecurityError);
    expect((error as SecurityError).limit).toBe("symlink");
  });

  it.skipIf(!POSIX)(
    "rejects a file below a directory that became a link out of the package after the listing",
    async () => {
      const root = unpacked({ "sub/a.txt": "hello" });
      const pkg = await readPackageFile(root);
      const outside = join(directory, "outside-sub");
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "a.txt"), "secret");
      renameSync(join(root, "sub"), join(directory, "moved-sub"));
      symlinkSync(outside, join(root, "sub"));
      const error = (() => {
        try {
          return pkg.file("sub/a.txt");
        } catch (caught) {
          return caught;
        }
      })();
      expect(error).toBeInstanceOf(SecurityError);
      expect((error as SecurityError).limit).toBe("path");
    },
  );

  it("refuses a file that grew past maxEntryBytes after the listing, when it is read", async () => {
    const root = unpacked({ "a.txt": "a".repeat(100) });
    const pkg = await readPackageFile(root, { limits: { maxEntryBytes: 2000 } });
    appendFileSync(join(root, "a.txt"), "a".repeat(3000));
    const error = (() => {
      try {
        return pkg.file("a.txt");
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(SecurityError);
    expect((error as SecurityError).limit).toBe("maxEntryBytes");
  });

  it.skipIf(!POSIX)("rejects a file that is neither a regular file nor a directory", async () => {
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

  it.skipIf(!POSIX)("rejects a file whose name is not allowed in a package", async () => {
    const root = unpacked({});
    writeFileSync(join(root, "a\\b.txt"), "x");
    const error = await readPackageFile(root).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecurityError);
    expect((error as SecurityError).limit).toBe("path");
  });

  it("applies the limits of entries and sizes to a directory and a ZIP file", async () => {
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
    writeFileSync(
      file,
      writePackage(MANIFEST, new Map([["a.txt", new Uint8Array(5000).map((_, index) => (index * 7919) % 251)]])),
    );
    const error = await readPackageFile(file, { limits: { maxTotalBytes: 1000 } }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecurityError);
    expect((error as SecurityError).limit).toBe("maxTotalBytes");
  });

  it("passes the xml limits to the manifest", async () => {
    const root = unpacked({});
    const error = await readPackageFile(root, { xmlLimits: { maxNodes: 3 } }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecurityError);
    expect((error as SecurityError).limit).toBe("maxNodes");
  });

  it("reports a path that does not exist or a directory without a manifest", async () => {
    await expect(readPackageFile(join(directory, "nowhere"))).rejects.toThrow(DataError);
    const empty = join(directory, "empty");
    mkdirSync(empty);
    await expect(readPackageFile(empty)).rejects.toThrow(ReadError);
  });

  it("throws DataError for input of other types, as JavaScript or JSON pass it", async () => {
    await expect(readPackageFile(JSON.parse("5"))).rejects.toThrow("The path must be a string, found 5.");
    await expect(readPackageFile(JSON.parse("null"))).rejects.toThrow(DataError);
    await expect(readPackageFile(directory, JSON.parse("null"))).rejects.toThrow(DataError);
    await expect(readPackageFile(directory, JSON.parse('{"limits":{"maxEntries":-1}}'))).rejects.toThrow(DataError);
  });
});

describe("the list of schemas", () => {
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

describe("choosing the schema of a document", () => {
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

  it("validates ASI documents against the 3.0.1 schema by default", () => {
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

describe("loading schemas", () => {
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

describe("validating documents", () => {
  it("throws DataError for a schema set that loadSchemaSet did not return", async () => {
    await expect(validateXmlFiles(JSON.parse("{}"), [])).rejects.toThrow(
      "The schemas must be a SchemaSet that loadSchemaSet returned.",
    );
    await expect(validateXmlFiles(JSON.parse("null"), [])).rejects.toThrow(DataError);
  });
});

/** The SHA-256 of "abc" and of "beta", the hashes that the lists of the tests below pin. */
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const BETA = "f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753";

describe("the cache directory of a platform", () => {
  it("is Library/Caches on macOS, whatever the environment says", () => {
    expect(userCacheDirectory("darwin", { XDG_CACHE_HOME: "/x" }, "/Users/ada")).toBe("/Users/ada/Library/Caches");
  });

  it("is $XDG_CACHE_HOME or ~/.cache elsewhere, and ignores a variable that is not an absolute path", () => {
    expect(userCacheDirectory("linux", { XDG_CACHE_HOME: "/var/cache/ada" }, "/home/ada")).toBe("/var/cache/ada");
    expect(userCacheDirectory("linux", {}, "/home/ada")).toBe("/home/ada/.cache");
    expect(userCacheDirectory("linux", { XDG_CACHE_HOME: "cache" }, "/home/ada")).toBe("/home/ada/.cache");
    expect(userCacheDirectory("linux", { XDG_CACHE_HOME: "" }, "/home/ada")).toBe("/home/ada/.cache");
    expect(userCacheDirectory("freebsd", {}, "/home/ada")).toBe("/home/ada/.cache");
  });

  it("is %LOCALAPPDATA% on Windows, or AppData\\Local below the home directory", () => {
    expect(userCacheDirectory("win32", { LOCALAPPDATA: "D:\\Data\\Local" }, "C:\\Users\\ada")).toBe("D:\\Data\\Local");
    expect(userCacheDirectory("win32", {}, "C:\\Users\\ada")).toBe("C:\\Users\\ada\\AppData\\Local");
    expect(userCacheDirectory("win32", { LOCALAPPDATA: "Local" }, "C:\\Users\\ada")).toBe(
      "C:\\Users\\ada\\AppData\\Local",
    );
  });
});

describe("the default schema directory", () => {
  it("is the directory of the pinned list of the runtime, which `assesskit schemas fetch` fills", () => {
    expect(defaultSchemaDirectory()).toBe(pinnedSchemaDirectory(SCHEMA_FILES));
    expect(defaultSchemaDirectory()).toMatch(/assesskit[\\/]schemas[\\/][0-9a-f]{12}$/);
  });

  const first: SchemaFile = { url: "https://example.org/a.xsd", file: "a.xsd", sha256: ABC };
  const second: SchemaFile = { url: "https://example.org/b.xsd", file: "b.xsd", sha256: BETA };

  it("is assesskit/schemas/<version> in the user cache directory, the version being the start of the SHA-256 of the list", () => {
    // `printf 'a.xsd <hash>\nb.xsd <hash>\n' | shasum -a 256` starts with 123a6930c83f; the list of `a.xsd` alone with b7e2901c34c0.
    const cache = userCacheDirectory(process.platform, process.env, homedir());
    expect(pinnedSchemaDirectory([first, second])).toBe(join(cache, "assesskit", "schemas", "123a6930c83f"));
    expect(pinnedSchemaDirectory([first])).toBe(join(cache, "assesskit", "schemas", "b7e2901c34c0"));
  });

  it("changes when a schema is added or its hash changes, and not when only the address does", () => {
    const moved = { ...first, url: "https://mirror.example/a.xsd" };
    const changed = { ...first, sha256: BETA };
    expect(pinnedSchemaDirectory([moved])).toBe(pinnedSchemaDirectory([first]));
    expect(pinnedSchemaDirectory([changed])).not.toBe(pinnedSchemaDirectory([first]));
    expect(pinnedSchemaDirectory([first, second])).not.toBe(pinnedSchemaDirectory([first]));
  });
});
