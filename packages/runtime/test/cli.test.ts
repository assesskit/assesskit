import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runGuideSamples } from "../../../scripts/guide-samples.js";
import { runCli } from "../src/cli/index.js";
import {
  buildReport,
  EXIT_CODES,
  exitCodeOf,
  fetchSchemas,
  formatJson,
  formatText,
  mapConcurrently,
  packageVersion,
  parseCommand,
  resolveOptions,
  sha256,
  USAGE,
  UsageError,
} from "../src/cli/internal.js";
import { DataError, type Issue } from "../src/index.js";
import { defaultSchemaDirectory, SCHEMA_FILES, type SchemaFile } from "../src/node/index.js";
import { FUZZ } from "./fuzz.js";

/** The SHA-256 of "abc" is the vector of FIPS 180-4 B.1; the others come from `shasum -a 256`. */
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const BETA = "f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753";
const GAMMA = "be9d587defa1f0c09ef49eb17e206983a5f8f8289e4281860bd0ee5a19592c67";
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** What the fixture server answers for a path. */
interface Route {
  readonly status: number;
  readonly body: string;
}

const routes = new Map<string, Route>();
let requests: string[] = [];
let inFlight = 0;
let mostInFlight = 0;
let delay = 0;
let server: Server;
let base = "";
let directory = "";

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "runtime-cli-"));
  server = createServer((request, response) => {
    const path = request.url ?? "";
    requests.push(path);
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    const route = routes.get(path) ?? { status: 404, body: "" };
    setTimeout(() => {
      inFlight -= 1;
      response.statusCode = route.status;
      response.end(route.body);
    }, delay);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The fixture server has no port.");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  routes.clear();
  requests = [];
  inFlight = 0;
  mostInFlight = 0;
  delay = 0;
});

/** The schemas of three small files that the fixture server serves, each and all. */
function fixtureSchemas(): { a: SchemaFile; b: SchemaFile; c: SchemaFile; all: SchemaFile[] } {
  routes.set("/a.xsd", { status: 200, body: "abc" });
  routes.set("/b.xsd", { status: 200, body: "beta" });
  routes.set("/c.xsd", { status: 200, body: "gamma" });
  const a = { url: `${base}/a.xsd`, file: "a.xsd", sha256: ABC };
  const b = { url: `${base}/b.xsd`, file: "b.xsd", sha256: BETA };
  const c = { url: `${base}/c.xsd`, file: "c.xsd", sha256: GAMMA };
  return { a, b, c, all: [a, b, c] };
}

/** Makes a directory of its own, so that no test sees the files of another. */
function freshDirectory(name: string): string {
  return mkdtempSync(join(directory, `${name}-`));
}

/** The output of a run of the command line. */
async function run(args: readonly string[], options: Parameters<typeof runCli>[1] = {}) {
  let stdout = "";
  let stderr = "";
  const code = await runCli(args, {
    schemaDirectory: join(directory, "none"),
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

describe("running the command line", () => {
  it("prints the usage to the standard output for --help and -h", async () => {
    for (const flag of ["--help", "-h"]) {
      expect(await run([flag])).toEqual({ code: 0, stdout: USAGE, stderr: "" });
    }
  });

  it("exits with 2 and prints the usage to the standard error for a command line that is wrong", async () => {
    const cases: [string[], string][] = [
      [[], "A command is required."],
      [["launch"], 'The command "launch" is unknown.'],
      [["validate"], "The command validate takes one path."],
      [["validate", "a.xml", "b.xml"], "The command validate takes one path."],
      [["validate", "a.xml", "--format", "xml"], 'The option --format must be "text" or "json", found "xml".'],
      [["schemas"], 'The command schemas takes the subcommand "fetch".'],
      [["schemas", "download"], 'The command schemas takes the subcommand "fetch".'],
      [["schemas", "fetch", "dir"], "The command schemas fetch takes no path."],
    ];
    for (const [args, message] of cases) {
      expect(await run(args), args.join(" ")).toEqual({
        code: 2,
        stdout: "",
        stderr: `assesskit: ${message}\n\n${USAGE}`,
      });
    }
  });

  it("exits with 2 for an option that the command does not have or that lacks its value", async () => {
    const cases: [string[], string][] = [
      [["validate", "a.xml", "--bogus"], "Unknown option '--bogus'"],
      [["validate", "a.xml", "--dir", "d"], "Unknown option '--dir'"],
      [["schemas", "fetch", "--schemas", "d"], "Unknown option '--schemas'"],
      [["validate", "a.xml", "--format"], "Option '--format <value>' argument missing"],
      [["schemas", "fetch", "--dir"], "Option '--dir <value>' argument missing"],
    ];
    for (const [args, message] of cases) {
      const { code, stdout, stderr } = await run(args);
      expect([args.join(" "), code, stdout]).toEqual([args.join(" "), 2, ""]);
      expect(stderr.startsWith(`assesskit: ${message}`), stderr).toBe(true);
      expect(stderr.endsWith(`\n\n${USAGE}`)).toBe(true);
    }
  });

  it("takes a path that starts with a dash after --", async () => {
    const { code, stderr } = await run(["validate", "--", "--weird.xml"]);
    expect(code).toBe(2);
    expect(stderr).toContain("does not hold the pinned schemas");
    expect(stderr).not.toContain("Usage:");
  });

  it("exits with 2 when the directory of the schemas lacks them, and says how to download them", async () => {
    const own = freshDirectory("empty");
    const byDefault = await run(["validate", "a.xml"], { schemaDirectory: own });
    expect(byDefault).toEqual({
      code: 2,
      stdout: "",
      stderr: `assesskit: The directory ${own} does not hold the pinned schemas. Run assesskit schemas fetch to download them.\n`,
    });
    const named = await run(["validate", "a.xml", "--schemas", own]);
    expect(named.stderr).toBe(
      `assesskit: The directory ${own} does not hold the pinned schemas. Run assesskit schemas fetch --dir ${JSON.stringify(own)} to download them.\n`,
    );
  });

  it("exits with 2 and lists every schema that cannot be downloaded", async () => {
    const target = freshDirectory("offline");
    const { code, stdout, stderr } = await run(["schemas", "fetch", "--dir", target], {
      fetch: async () => new Response("", { status: 404 }),
    });
    expect([code, stdout]).toEqual([2, ""]);
    const lines = stderr.split("\n");
    expect(lines[0]).toBe(
      `assesskit: ${SCHEMA_FILES.length} of ${SCHEMA_FILES.length} schemas could not be downloaded to ${target}:`,
    );
    expect(lines.slice(1, -2)).toEqual(SCHEMA_FILES.map(({ url }) => `- Downloading ${url} failed: HTTP 404.`));
    expect(lines.at(-2)).toBe("Run the command again to download the rest.");
    expect(readdirSync(target)).toEqual([]);
  });

  it("tells on the standard error that it tries a failed download again, three times in all, before it lists the failure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let asked = 0;
      let finished = false;
      const running = run(["schemas", "fetch", "--dir", freshDirectory("flaky")], {
        fetch: async () => {
          asked += 1;
          return new Response("", { status: 503 });
        },
      }).finally(() => {
        finished = true;
      });
      // The waits are armed after the files of the directory are read, so the clock moves until the command ends: each
      // schema waits 2 s and then 4 s, four at a time.
      while (!finished) await vi.advanceTimersByTimeAsync(1000);
      const { code, stderr } = await running;
      const first = SCHEMA_FILES[0]?.url;
      expect(code).toBe(2);
      expect(asked).toBe(SCHEMA_FILES.length * 3);
      expect(stderr).toContain(`assesskit: Downloading ${first} failed: HTTP 503. Trying again (2 of 3).\n`);
      expect(stderr).toContain(`assesskit: Downloading ${first} failed: HTTP 503. Trying again (3 of 3).\n`);
      expect(stderr).toContain(`- Downloading ${first} failed: HTTP 503.\n`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exits with 2 and writes no file for a download with another hash than the pinned one", async () => {
    const target = freshDirectory("changed");
    const { code, stderr } = await run(["schemas", "fetch", "--dir", target], {
      fetch: async () => new Response("not a schema"),
    });
    expect(code).toBe(2);
    expect(stderr).toContain(
      `${SCHEMA_FILES[0]?.url} has the SHA-256 ${sha256(new TextEncoder().encode("not a schema"))}, not the pinned ${SCHEMA_FILES[0]?.sha256}.`,
    );
    expect(readdirSync(target)).toEqual([]);
  });

  it("downloads into the default directory of the options when --dir is not given", async () => {
    const target = join(freshDirectory("default"), "schemas");
    const { code, stderr } = await run(["schemas", "fetch"], {
      schemaDirectory: target,
      fetch: async () => new Response("", { status: 404 }),
    });
    expect(code).toBe(2);
    expect(stderr).toContain(`could not be downloaded to ${target}:`);
    expect(readdirSync(target)).toEqual([]);
  });

  it("rejects arguments of other types, as JavaScript or JSON pass them", async () => {
    await expect(runCli(JSON.parse('"validate"'))).rejects.toThrow(
      new DataError('The arguments must be an array, found "validate".'),
    );
    await expect(runCli(JSON.parse("null"))).rejects.toThrow(
      new DataError("The arguments must be an array, found null."),
    );
    await expect(runCli(JSON.parse('["validate",1]'))).rejects.toThrow(
      new DataError("An argument must be a string, found 1."),
    );
    await expect(runCli([], JSON.parse("null"))).rejects.toThrow(
      new DataError("The options must be an object, found null."),
    );
  });
});

describe("options of the command line", () => {
  it("fills in what the options leave out", () => {
    const resolved = resolveOptions({});
    expect(resolved.schemaDirectory).toBe(defaultSchemaDirectory());
    expect(resolved.fetch).toBe(fetch);
    expect(typeof resolved.stdout).toBe("function");
    expect(typeof resolved.stderr).toBe("function");
  });

  it("keeps what the options give", () => {
    const stdout = () => undefined;
    expect(resolveOptions({ stdout, schemaDirectory: "/schemas" })).toMatchObject({
      stdout,
      schemaDirectory: "/schemas",
    });
  });

  it("rejects options of other types, as JavaScript or JSON pass them", () => {
    const wrong: [string, string][] = [
      ["null", "The options must be an object, found null."],
      ['{"stdout":1}', "The option stdout must be a function of a text, found 1."],
      ['{"stderr":"x"}', 'The option stderr must be a function of a text, found "x".'],
      ['{"schemaDirectory":[]}', "The option schemaDirectory must be a string, found an array."],
      ['{"fetch":{}}', "The option fetch must be a function of an address, found an object."],
      ['{"schemaDirectory":null}', "The option schemaDirectory must be a string, found null."],
    ];
    for (const [json, message] of wrong) {
      expect(() => resolveOptions(JSON.parse(json)), json).toThrow(new DataError(message));
    }
  });
});

describe("parsing a command", () => {
  it("separates the positional arguments from the options, which take the next argument or follow an equals sign", () => {
    const options = { schemas: { type: "string" }, format: { type: "string" } } as const;
    expect(parseCommand(["a.xml", "--schemas", "dir", "--format=json"], options)).toEqual({
      values: { schemas: "dir", format: "json" },
      positionals: ["a.xml"],
    });
    expect(parseCommand(["--", "--a.xml"], options)).toEqual({ values: {}, positionals: ["--a.xml"] });
  });

  it("throws a UsageError for an option that is unknown", () => {
    expect(() => parseCommand(["--x"], {})).toThrow(UsageError);
  });
});

describe("the report", () => {
  const error: Issue = {
    severity: "error",
    rule: "assesskit/node/xsd-invalid",
    message: "Element 'x': Not expected.",
    location: { path: "items/a.xml", line: 12, column: 5 },
  };
  const warning: Issue = {
    severity: "warning",
    rule: "assesskit/validate/unbound-response",
    message: "The response variable is bound to no interaction.",
    location: { path: "items/b.xml", element: "qti-assessment-item/qti-response-declaration" },
  };
  const bare: Issue = { severity: "warning", rule: "assesskit/x/y", message: "No place." };

  it("counts the issues of each severity, and is valid when none is an error", () => {
    expect(buildReport("t", "1.2.3", [warning, bare])).toEqual({
      tool: "assesskit",
      version: "1.2.3",
      target: "t",
      valid: true,
      summary: { errors: 0, warnings: 2 },
      issues: [warning, bare],
    });
    expect(buildReport("t", "1.2.3", [error, warning])).toMatchObject({
      valid: false,
      summary: { errors: 1, warnings: 1 },
    });
    expect(buildReport("t", "1.2.3", [])).toMatchObject({ valid: true, summary: { errors: 0, warnings: 0 } });
  });

  it("exits with 0 for a valid report and 1 for a report with an error", () => {
    expect(EXIT_CODES).toEqual({ valid: 0, invalid: 1, failed: 2 });
    expect(exitCodeOf(buildReport("t", "v", [warning]))).toBe(0);
    expect(exitCodeOf(buildReport("t", "v", [error]))).toBe(1);
  });

  it("writes a line for each issue and the verdict as text", () => {
    expect(formatText(buildReport("pkg", "v", [error, warning, bare]))).toBe(
      [
        "items/a.xml:12:5: error: Element 'x': Not expected. [assesskit/node/xsd-invalid]",
        "items/b.xml (qti-assessment-item/qti-response-declaration): warning: The response variable is bound to no interaction. [assesskit/validate/unbound-response]",
        "pkg: warning: No place. [assesskit/x/y]",
        "pkg: invalid (1 error, 2 warnings)",
        "",
      ].join("\n"),
    );
    expect(formatText(buildReport("pkg", "v", []))).toBe("pkg: valid (0 errors, 0 warnings)\n");
  });

  it("writes the report as JSON with its fields in order", () => {
    const text = formatJson(buildReport("pkg", "1.2.3", [error]));
    expect(text.endsWith("}\n")).toBe(true);
    const parsed = JSON.parse(text);
    expect(Object.keys(parsed)).toEqual(["tool", "version", "target", "valid", "summary", "issues"]);
    expect(parsed).toEqual({
      tool: "assesskit",
      version: "1.2.3",
      target: "pkg",
      valid: false,
      summary: { errors: 1, warnings: 0 },
      issues: [error],
    });
  });
});

describe("the version", () => {
  it("is the version in the package.json of the runtime", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    expect(packageVersion()).toBe(manifest.version);
  });
});

describe("hashing", () => {
  it("hashes the vectors of FIPS 180-4", () => {
    expect(sha256(new TextEncoder().encode("abc"))).toBe(ABC);
    expect(sha256(new Uint8Array())).toBe(EMPTY);
  });
});

describe("running downloads a few at a time", () => {
  it("returns the results in the order of the items, whatever order they finish in", async () => {
    const results = await mapConcurrently([30, 1, 20, 2, 10], async (milliseconds) => {
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
      return milliseconds;
    });
    expect(results).toEqual([30, 1, 20, 2, 10]);
  });

  it("runs at most four at once", async () => {
    let running = 0;
    let most = 0;
    await mapConcurrently(
      Array.from({ length: 12 }, (_, index) => index),
      async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
      },
    );
    expect(most).toBe(4);
  });

  it("applies the function to every item exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer()), async (items) => {
        const seen: number[] = [];
        const results = await mapConcurrently(items, async (item) => {
          seen.push(item);
          return item * 2;
        });
        expect(results).toEqual(items.map((item) => item * 2));
        expect(seen.toSorted((a, b) => a - b)).toEqual(items.toSorted((a, b) => a - b));
      }),
      FUZZ,
    );
  });
});

describe("fetching the schemas", () => {
  it("downloads the files into the directory, creating it, and lists them in the order of the list", async () => {
    const { all } = fixtureSchemas();
    const target = join(freshDirectory("fetch"), "nested", "schemas");
    const result = await fetchSchemas(target, all);
    expect(result).toEqual({ downloaded: all, failures: [] });
    expect(readdirSync(target).sort()).toEqual(["a.xsd", "b.xsd", "c.xsd"]);
    expect(readFileSync(join(target, "b.xsd"), "utf8")).toBe("beta");
  });

  it("requests only the files that are not in the directory with their pinned hashes", async () => {
    const { all } = fixtureSchemas();
    const target = freshDirectory("current");
    await fetchSchemas(target, all);
    requests = [];
    expect(await fetchSchemas(target, all)).toEqual({ downloaded: [], failures: [] });
    expect(requests).toEqual([]);
    rmSync(join(target, "a.xsd"));
    const changed = join(target, "b.xsd");
    await writeFile(changed, "changed");
    const again = await fetchSchemas(target, all);
    expect(again.downloaded.map(({ file }) => file)).toEqual(["a.xsd", "b.xsd"]);
    expect(requests.sort()).toEqual(["/a.xsd", "/b.xsd"]);
    expect(readFileSync(changed, "utf8")).toBe("beta");
  });

  it("writes no file whose bytes have another hash than the pinned one, and still writes the others", async () => {
    const { b, all } = fixtureSchemas();
    routes.set("/b.xsd", { status: 200, body: "tampered" });
    const target = freshDirectory("tampered");
    const result = await fetchSchemas(target, all);
    expect(result.downloaded.map(({ file }) => file)).toEqual(["a.xsd", "c.xsd"]);
    const tampered = sha256(new TextEncoder().encode("tampered"));
    expect(result.failures).toEqual([
      { schema: b, reason: `${base}/b.xsd has the SHA-256 ${tampered}, not the pinned ${BETA}.` },
    ]);
    expect(readdirSync(target).sort()).toEqual(["a.xsd", "c.xsd"]);
  });

  it("reports a status that is not a success and a server that cannot be reached, in the order of the list", async () => {
    const { a, b, c } = fixtureSchemas();
    routes.set("/a.xsd", { status: 500, body: "" });
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const address = closed.address();
    await new Promise((resolve) => closed.close(resolve));
    if (address === null || typeof address === "string") throw new Error("The server has no port.");
    const unreachable = `http://127.0.0.1:${address.port}/c.xsd`;
    const result = await fetchSchemas(freshDirectory("failing"), [a, b, { ...c, url: unreachable }], { retryMs: 1 });
    expect(result.downloaded.map(({ file }) => file)).toEqual(["b.xsd"]);
    expect(result.failures.map(({ schema }) => schema.file)).toEqual(["a.xsd", "c.xsd"]);
    expect(result.failures[0]?.reason).toBe(`Downloading ${base}/a.xsd failed: HTTP 500.`);
    expect(result.failures[1]?.reason).toMatch(/^fetch failed: .*ECONNREFUSED/);
  });

  it("downloads at most four files at once", async () => {
    const schemas = Array.from({ length: 10 }, (_, index) => {
      routes.set(`/s${index}.xsd`, { status: 200, body: "abc" });
      return { url: `${base}/s${index}.xsd`, file: `s${index}.xsd`, sha256: ABC };
    });
    delay = 20;
    await fetchSchemas(freshDirectory("concurrent"), schemas);
    expect(mostInFlight).toBe(4);
  });

  it("uses the function it is given in place of the global fetch", async () => {
    const { a } = fixtureSchemas();
    const asked: string[] = [];
    const fetchUrl: typeof fetch = async (input) => {
      asked.push(String(input));
      return new Response("abc");
    };
    const result = await fetchSchemas(freshDirectory("own"), [a], { fetch: fetchUrl });
    expect(asked).toEqual([`${base}/a.xsd`]);
    expect(result.failures).toEqual([]);
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = readFileSync(new URL("../../../docs/runtime/cli.md", import.meta.url), "utf8");
    const cli = await import("../src/cli/index.js");
    expect(await runGuideSamples(guide, { "@assesskit/runtime/cli": cli })).toBeGreaterThan(0);
  });
});
