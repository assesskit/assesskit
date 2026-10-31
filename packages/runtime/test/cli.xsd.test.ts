import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { requireSchemas } from "../../../scripts/schemas.js";
import { pathIssues } from "../src/cli/check-path.js";
import { sha256 } from "../src/cli/fetch-schemas.js";
import { runCli } from "../src/cli/index.js";
import { type Issue, ReadError, readAsi } from "../src/index.js";
import { loadSchemaSet, readPackageFile, SCHEMA_FILES, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import { PNP_NAMESPACE } from "../src/pnp/index.js";
import { validateAsi, validatePackage } from "../src/validate/index.js";
import { buildZip, bytes } from "./zip-builder.js";

const root = resolve(import.meta.dirname, "../../..");
const schemaDirectory = requireSchemas(root);
const examples = join(requireCorpus(root), "qti-examples/qtiv3-examples");

/** The `version` of the package, which a report carries. */
const VERSION = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")).version;

interface Report {
  readonly tool: string;
  readonly version: string;
  readonly target: string;
  readonly valid: boolean;
  readonly summary: { readonly errors: number; readonly warnings: number };
  readonly issues: readonly Issue[];
}

let directory = "";
let schemas: SchemaSet;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "runtime-cli-xsd-"));
  schemas = await loadSchemaSet(schemaDirectory);
});

afterAll(() => {
  schemas.close();
  rmSync(directory, { recursive: true, force: true });
});

/** Runs the command line with the schemas of the repository. */
async function run(args: readonly string[], options: Parameters<typeof runCli>[1] = {}) {
  let stdout = "";
  let stderr = "";
  const code = await runCli(args, {
    schemaDirectory,
    ...options,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}

/** Validates a path with `--format json` and returns the report with the exit code. */
async function report(path: string, ...more: string[]): Promise<{ code: number; report: Report }> {
  const { code, stdout, stderr } = await run(["validate", path, "--format", "json", ...more]);
  expect(stderr).toBe("");
  return { code, report: JSON.parse(stdout) };
}

/** Writes a file below the temporary directory and returns its path. */
function write(name: string, content: string | Uint8Array): string {
  const path = join(directory, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function example(path: string): string {
  return join(examples, path);
}

/** The issues of the libraries for an assessment document: the schema check, then the reader and the semantic checks (L12). */
async function expectedForDocument(path: string): Promise<readonly Issue[]> {
  const content = new Uint8Array(readFileSync(path));
  const schema = await validateXmlFiles(schemas, [{ path, content }]);
  try {
    return [...schema, ...validateAsi(readAsi(content, { path }), { path })];
  } catch (error) {
    if (error instanceof ReadError) return [...schema, ...error.issues];
    throw error;
  }
}

/** The issues of the libraries for a package: the schema check of each of its XML files that has a schema, then `validatePackage` (L12). */
async function expectedForPackage(path: string): Promise<readonly Issue[]> {
  const pkg = await readPackageFile(path);
  const issues: Issue[] = [];
  for (const file of pkg.paths.filter((each) => each.endsWith(".xml"))) {
    const found = await validateXmlFiles(schemas, [{ path: file, content: pkg.file(file) ?? new Uint8Array() }]);
    issues.push(...found.filter(({ code }) => code !== "assesskit/node/no-schema"));
  }
  return [...issues, ...validatePackage(pkg)];
}

describe("assesskit validate: documents", () => {
  it("says that a valid item is valid, in text, and exits with 0", async () => {
    const path = example("packaging/items/choice.xml");
    expect(await run(["validate", path])).toEqual({
      code: 0,
      stdout: `${path}: valid (0 errors, 0 warnings)\n`,
      stderr: "",
    });
  });

  it("gives the report of the design in JSON, with the fields in order, for an item that is valid", async () => {
    const path = example("packaging/items/choice.xml");
    const { code, stdout, stderr } = await run(["validate", path, "--format=json"]);
    expect([code, stderr]).toEqual([0, ""]);
    expect(stdout.endsWith("}\n")).toBe(true);
    const parsed = JSON.parse(stdout);
    expect(Object.keys(parsed)).toEqual(["tool", "version", "target", "valid", "summary", "issues"]);
    expect(parsed).toEqual({
      tool: "assesskit",
      version: VERSION,
      target: path,
      valid: true,
      summary: { errors: 0, warnings: 0 },
      issues: [],
    });
  });

  it("exits with 0 for an item that has warnings only, and prints them", async () => {
    const path = example("packaging/items/Example03-feedbackBlock-solution-random.xml");
    const { code, stdout } = await run(["validate", path]);
    expect(code).toBe(0);
    expect(stdout).toBe(
      `${path} (qti-assessment-item): warning: The identifier "Example03-feedbackBlock-solution-random" of the qti-assessment-item has more than 32 characters, which version 1 of QTI does not take. [assesskit/validate/identifier-style]\n` +
        `${path}: valid (0 errors, 1 warning)\n`,
    );
  });

  it("exits with 1 for an item with errors, and reports what the semantic checks find", async () => {
    // INFO §2.11.3.29: qti-member takes a single value and then a container, and this example has them the wrong way round.
    const path = example("packaging/items/feedback_adaptive.xml");
    const { code, report: found } = await report(path);
    expect(code).toBe(1);
    expect(found).toMatchObject({ valid: false, summary: { errors: 3, warnings: 0 } });
    expect(found.issues.map(({ code: each }) => each)).toEqual([
      "assesskit/validate/assignment-type",
      "assesskit/validate/operand-type",
      "assesskit/validate/operand-type",
    ]);
    expect(found.issues).toEqual(await expectedForDocument(path));
  });

  it("checks the schema first and then the semantics, and reports a defect that both find with both codes", async () => {
    const path = example("packaging/items/data-attributes.xml");
    const { code, report: found } = await report(path);
    expect(code).toBe(1);
    expect(found.issues.map(({ code: each, location }) => [each, location?.line])).toEqual([
      ["assesskit/node/xsd-invalid", 15],
      ["assesskit/asi/missing-attribute", 15],
    ]);
    expect(found.issues).toEqual(await expectedForDocument(path));
  });

  it("reads a test, a results report, usage data and a manifest as the kind their root element names", async () => {
    for (const path of [
      "tests/rtest01.xml",
      "results/report.xml",
      "usageData/example.xml",
      "packaging/simple/imsmanifest.xml",
    ]) {
      const { code, stdout } = await run(["validate", example(path)]);
      expect([path, code, stdout]).toEqual([path, 0, `${example(path)}: valid (0 errors, 0 warnings)\n`]);
    }
  });

  it("applies the rules of Results Reporting to a report: an item result of a test has a sequenceIndex (RR §2.4.5)", async () => {
    const { code, report: found } = await report(example("results/conformance-use-case-1.xml"));
    expect(code).toBe(1);
    expect(found.issues.map(({ code: each }) => each)).toEqual(Array(4).fill("assesskit/validate/sequence-index"));
  });

  it("reports a document that is not well-formed once, with the position the reader found", async () => {
    const { code, report: found } = await report(example("results/full-example.xml"));
    expect(code).toBe(1);
    expect(found.issues).toMatchObject([
      { code: "assesskit/xml/not-well-formed", severity: "error", location: { line: 26, column: 13 } },
    ]);
  });

  it("reports a document that is not in a namespace with a schema, with exit 1", async () => {
    const { code, report: found } = await report(example("packaging/usageData/USAGE-TOTAL-TEST-106391.xml"));
    expect(code).toBe(1);
    expect(found.issues.map(({ code: each }) => each)).toEqual(["assesskit/node/no-schema"]);
  });

  it("reports a document with a DOCTYPE as an error without reading it (BPIG §6.7)", async () => {
    const path = write("doctype.xml", '<!DOCTYPE x [<!ENTITY e "boom">]><x>&e;</x>');
    const { code, report: found } = await report(path);
    expect(code).toBe(1);
    expect(found.issues).toMatchObject([{ code: "assesskit/xml/security", severity: "error" }]);
  });

  it("reads a PNP document, checks its supports and reports the namespaces of the examples of 1EdTech", async () => {
    const profile = (children: string, namespace = PNP_NAMESPACE): string =>
      `<access-for-all-pnp xmlns="${namespace}">${children}</access-for-all-pnp>`;
    const valid = write("pnp-valid.xml", profile("<spoken/><prohibit-set><magnification/></prohibit-set>"));
    expect((await report(valid)).code).toBe(0);
    const contradiction = write(
      "pnp-contradiction.xml",
      profile(
        "<prohibit-set><magnification/></prohibit-set><activate-as-option-set><magnification/></activate-as-option-set>",
      ),
    );
    const contradictory = await report(contradiction);
    expect(contradictory.code).toBe(1);
    expect(contradictory.report.issues).toMatchObject([
      { code: "assesskit/validate/pnp-prohibited", severity: "error" },
    ]);
    const alternate = write(
      "pnp-alternate.xml",
      profile("<spoken/>", "http://www.imsglobal.org/xsd/qt/qtiv3p0/imsafa3p0pnp_v1p0"),
    );
    const moved = await report(alternate);
    expect(moved.code).toBe(1);
    expect(moved.report.issues.map(({ code: each }) => each)).toEqual([
      "assesskit/node/no-schema",
      "assesskit/validate/pnp-namespace",
    ]);
  });

  it("reports a manifest that cannot be read with the issues of its reader, and a document that has an xi:include as unresolved", async () => {
    const manifest = write(
      "bad/imsmanifest.xml",
      '<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"/>',
    );
    const read = await report(manifest);
    expect(read.code).toBe(1);
    expect(read.report.issues.map(({ code: each }) => each)).toContain("assesskit/package/missing-attribute");
    // A lone document has no files to include, and a package does: INFO §2.12 asks for the includes to be resolved first.
    const fragment = await report(example("tests/rtest01-set01.xml"));
    expect(fragment.report.issues.map(({ code: each }) => each)).toContain("assesskit/validate/unresolved-include");
  });

  it("exits with 2 for a path that does not exist, and for a document above the limit maxBytes of parseXml", async () => {
    const missing = await run(["validate", join(directory, "missing.xml")]);
    expect(missing.code).toBe(2);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain(`assesskit: The path ${join(directory, "missing.xml")} cannot be read: ENOENT`);
    const huge = write("huge.xml", "<x/>");
    truncateSync(huge, 33_554_433);
    expect(await run(["validate", huge])).toEqual({
      code: 2,
      stdout: "",
      stderr: `assesskit: The file ${huge} has 33554433 bytes, above the limit maxBytes of 33554432.\n`,
    });
  });
});

describe("assesskit validate: the 1EdTech examples", () => {
  it("reads every XML file and every ZIP file of the examples, and refuses none", async () => {
    const files = readdirSync(examples, { recursive: true, encoding: "utf8" }).filter(
      (path) => path.endsWith(".xml") || path.endsWith(".zip"),
    );
    expect(files).toHaveLength(353);
    for (const file of files) {
      await expect(pathIssues(example(file), schemas), file).resolves.toBeDefined();
    }
  });
});

describe("assesskit validate: packages", () => {
  it("validates a ZIP file and exits with 0 when the package is valid", async () => {
    const path = example("packaging/simple/simple.zip");
    expect(await run(["validate", path])).toEqual({
      code: 0,
      stdout: `${path}: valid (0 errors, 0 warnings)\n`,
      stderr: "",
    });
  });

  it("validates an unpacked directory as it validates the ZIP file of the same files", async () => {
    const zip = example("packaging/items/items.zip");
    const pkg = await readPackageFile(zip);
    const unpacked = join(directory, "unpacked");
    for (const path of pkg.paths) write(join("unpacked", path), pkg.file(path) ?? new Uint8Array());
    const fromZip = await report(zip);
    const fromDirectory = await report(unpacked);
    expect(fromDirectory.code).toBe(fromZip.code);
    expect(fromDirectory.report.issues).toEqual(fromZip.report.issues);
    expect(fromDirectory.report.target).toBe(unpacked);
  });

  it("reports a file that the manifest does not list, as the directories of the examples hold their own ZIP file", async () => {
    const { code, report: found } = await report(example("packaging/simple"));
    expect(code).toBe(1);
    expect(found.issues).toMatchObject([
      {
        code: "assesskit/validate/unlisted-file",
        severity: "error",
        location: { path: "imsmanifest.xml", element: "manifest/resources" },
      },
    ]);
  });

  it("checks every XML file against its schema and then runs validatePackage, which gives the report of the libraries", async () => {
    const path = example("packaging/items/items.zip");
    const { code, report: found } = await report(path);
    expect(code).toBe(1);
    expect(found.issues).toEqual(await expectedForPackage(path));
    const codes = found.issues.map(({ code: each }) => each);
    expect(codes.indexOf("assesskit/node/xsd-invalid")).toBe(0);
    expect(found.summary.errors).toBe(found.issues.filter(({ severity }) => severity === "error").length);
  });

  it("does not hold an XML file of no schema, such as an LTI link, against the schemas", async () => {
    const path = example("packaging/testWithLti/testWithLti.zip");
    const { report: found } = await report(path);
    expect(found.issues.map(({ code: each }) => each)).not.toContain("assesskit/node/no-schema");
    expect(found.issues).toEqual(await expectedForPackage(path));
  });

  it("reports a package whose manifest cannot be read with the issues of the reader, with exit 1", async () => {
    const zip = write("no-manifest.zip", buildZip([{ name: "readme.txt", data: bytes("x") }]));
    const { code, report: found } = await report(zip);
    expect(code).toBe(1);
    expect(found.issues).toMatchObject([
      { severity: "error", message: "The package has no imsmanifest.xml at its root." },
    ]);
  });

  it("refuses a hostile ZIP file with exit 2 and a message on the standard error, and writes no report", async () => {
    const slip = write(
      "slip.zip",
      buildZip([
        { name: "imsmanifest.xml", data: bytes("<manifest/>") },
        { name: "../evil.xml", data: bytes("<x/>") },
      ]),
    );
    const refused = await run(["validate", slip]);
    expect(refused.code).toBe(2);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toMatch(/^assesskit: .*\.\.\/evil\.xml/);
    const bomb = write("bomb.zip", buildZip([{ name: "imsmanifest.xml", data: new Uint8Array(10_000_000) }]));
    const bombed = await run(["validate", bomb]);
    expect([bombed.code, bombed.stdout]).toEqual([2, ""]);
    expect(bombed.stderr).toMatch(/^assesskit: .*limit maxRatio of 250\./);
  });

  it("refuses a package directory that holds a symbolic link with exit 2", async () => {
    const unpacked = join(directory, "linked");
    write("linked/imsmanifest.xml", readFileSync(example("packaging/simple/imsmanifest.xml")));
    symlinkSync(join(directory, "doctype.xml"), join(unpacked, "link.xml"));
    const refused = await run(["validate", unpacked]);
    expect(refused.code).toBe(2);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toContain('"link.xml" is a symbolic link');
  });
});

describe("assesskit schemas fetch", () => {
  let server: Server;
  let base = "";
  /** The files that the server answers with other bytes than those in the schema directory, by file name. */
  const replaced = new Map<string, string>();

  beforeAll(async () => {
    server = createServer((request, response) => {
      const file = (request.url ?? "").slice(1);
      const body = replaced.get(file);
      (body === undefined ? readFile(join(schemaDirectory, file)) : Promise.resolve(body)).then(
        (content) => response.end(content),
        () => {
          response.statusCode = 404;
          response.end();
        },
      );
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("The fixture server has no port.");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
  });

  /** Sends the requests for the pinned addresses to the fixture server, and refuses any other address. */
  const fixtureFetch: typeof fetch = async (input) => {
    const schema = SCHEMA_FILES.find(({ url }) => url === String(input));
    if (schema === undefined) throw new Error(`The address ${String(input)} is not one of SCHEMA_FILES.`);
    return fetch(`${base}/${schema.file}`);
  };

  it("downloads the files of SCHEMA_FILES, checks their hashes, and gives a directory that validates", async () => {
    const target = join(directory, "fetched");
    expect(await run(["schemas", "fetch", "--dir", target], { fetch: fixtureFetch })).toEqual({
      code: 0,
      stdout: `Downloaded ${SCHEMA_FILES.length} schemas to ${target}.\n`,
      stderr: "",
    });
    for (const { file, sha256: pinned } of SCHEMA_FILES) {
      expect(sha256(new Uint8Array(readFileSync(join(target, file)))), file).toBe(pinned);
    }
    expect(await run(["schemas", "fetch", "--dir", target], { fetch: fixtureFetch })).toEqual({
      code: 0,
      stdout: `The schemas in ${target} are current.\n`,
      stderr: "",
    });
    const path = example("packaging/items/choice.xml");
    expect(await run(["validate", path, "--schemas", target])).toEqual({
      code: 0,
      stdout: `${path}: valid (0 errors, 0 warnings)\n`,
      stderr: "",
    });
  });

  it("downloads the other files and exits with 2 when the server changes one, and does not write that file", async () => {
    const target = join(directory, "partial");
    replaced.set("xml.xsd", "<changed/>");
    try {
      const { code, stdout, stderr } = await run(["schemas", "fetch", "--dir", target], { fetch: fixtureFetch });
      expect([code, stdout]).toEqual([2, ""]);
      const changed = sha256(new TextEncoder().encode("<changed/>"));
      const pinned = SCHEMA_FILES.find(({ file }) => file === "xml.xsd");
      expect(stderr).toBe(
        `assesskit: 1 of ${SCHEMA_FILES.length} schemas could not be downloaded to ${target}:\n- ${pinned?.url} has the SHA-256 ${changed}, not the pinned ${pinned?.sha256}.\nRun the command again to download the rest.\n`,
      );
    } finally {
      replaced.clear();
    }
    expect(await run(["schemas", "fetch", "--dir", target], { fetch: fixtureFetch })).toEqual({
      code: 0,
      stdout: `Downloaded 1 schema to ${target}.\n`,
      stderr: "",
    });
  });
});
