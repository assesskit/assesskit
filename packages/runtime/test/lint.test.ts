import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const RESTRICTED_IMPORT = "lint/style/noRestrictedImports";

/** The imports each module may make besides errors.ts, checks.ts and random.ts: the table of docs/architecture.md. */
const LAYERS: Readonly<Record<string, readonly string[]>> = {
  xml: [],
  values: [],
  asi: ["xml", "values"],
  results: ["xml", "values"],
  usage: ["xml", "values"],
  pnp: ["xml"],
  metadata: ["xml", "asi"],
  processing: ["values", "asi"],
  interactions: ["values", "asi"],
  pci: ["values", "asi"],
  content: ["values", "asi", "pnp"],
  cat: ["values", "asi", "results", "metadata"],
  package: ["xml", "asi", "metadata", "usage"],
  validate: [
    "xml",
    "values",
    "asi",
    "results",
    "usage",
    "pnp",
    "metadata",
    "processing",
    "interactions",
    "pci",
    "content",
    "cat",
    "package",
  ],
  delivery: [
    "values",
    "asi",
    "results",
    "pnp",
    "processing",
    "interactions",
    "pci",
    "content",
    "cat",
    "package",
    "validate",
  ],
  node: ["xml", "package", "validate"],
  cli: ["xml", "asi", "results", "usage", "pnp", "node", "validate", "package"],
};
const MODULES = Object.keys(LAYERS);
const SHARED = ["errors", "checks", "random"];

interface Diagnostic {
  readonly category: string;
  readonly message: string;
  readonly location: { readonly path: string; readonly start: { readonly line: number } };
}

/** A diagnostic of one line of a file: the rule category, or the message of a plugin. */
interface Finding {
  readonly line: number;
  readonly what: string;
}

/** The files of a project that has the repository's Biome configuration and GritQL rules, by path. */
const sources = new Map<string, string>();
const findings = new Map<string, Finding[]>();
let project = "";

/** Registers a file of the project and returns its path, to look up what Biome reports for it after the run. */
function source(path: string, lines: readonly string[]): string {
  sources.set(path, `${lines.join("\n")}\n`);
  return path;
}

/** Returns the rule categories and plugin messages Biome reported for a file. */
function whatFor(path: string): string[] {
  return (findings.get(path) ?? []).map(({ what }) => what);
}

/** Returns the lines of a file that Biome reported with the given rule category. */
function linesFor(path: string, category: string): number[] {
  return (findings.get(path) ?? [])
    .filter(({ what }) => what === category)
    .map(({ line }) => line)
    .sort((a, b) => a - b);
}

const bans = [
  { ban: "Math.random", code: "Math.random()", message: "assesskit is deterministic" },
  { ban: "Date.now", code: "Date.now()", message: "assesskit never reads a clock" },
  { ban: "new Date without arguments", code: "new Date()", message: "assesskit never reads a clock" },
  { ban: "Date without arguments", code: "Date()", message: "assesskit never reads a clock" },
  { ban: "performance.now", code: "performance.now()", message: "assesskit never reads a clock" },
  { ban: "new RegExp", code: 'new RegExp("a", "u")', message: "never on a backtracking RegExp" },
  { ban: "RegExp called", code: "RegExp(pattern)", message: "never on a backtracking RegExp" },
].map((entry, i) => ({
  ...entry,
  path: source(`packages/runtime/src/${i % 2 === 0 ? "xml" : "cli"}/ban-${i}.ts`, [`export const a = ${entry.code};`]),
}));
const allowedCalls = source("packages/runtime/src/xml/allowed.ts", [
  "export const a = [new Date(0), new Date(2024, 0), /a+/u, Math.floor(1.5)];",
]);

const platform = {
  fetch: source("packages/runtime/src/xml/fetch.ts", ['export const a = fetch("https://example.org");']),
  env: source("packages/runtime/src/xml/env.ts", ["export const a = process.env.HOME;"]),
  timer: source("packages/runtime/src/xml/timer.ts", ["export const a = setTimeout(() => 1, 1);"]),
  fs: source("packages/runtime/src/xml/fs.ts", [
    'import { readFileSync } from "node:fs";',
    "export const a = readFileSync;",
  ]),
  evaluation: source("packages/runtime/src/xml/evaluation.ts", ['export const a = eval("1");']),
  console: source("packages/runtime/src/xml/console.ts", ['console.log("x");']),
  nodeFs: source("packages/runtime/src/node/fs.ts", [
    'import { readFileSync } from "node:fs";',
    "export const a = readFileSync;",
  ]),
  cliEnv: source("packages/runtime/src/cli/env.ts", ["export const a = process.env.HOME;"]),
  cliConsole: source("packages/runtime/src/cli/console.ts", ['console.log("x");']),
};

/** Every other module and the shared files, as a module imports them, in the order of the lines of its file. */
function targetsOf(module: string): string[] {
  return [...SHARED, ...MODULES].filter((target) => target !== module);
}
const layers = MODULES.map((module) => ({
  module,
  targets: targetsOf(module),
  path: source(
    `packages/runtime/src/${module}/layers.ts`,
    targetsOf(module).map((target) => `export * from "../${target}${SHARED.includes(target) ? ".js" : "/index.js"}";`),
  ),
}));
const rootFiles = {
  errors: source("packages/runtime/src/errors.ts", ['export * from "./checks.js";', 'export * from "./random.js";']),
  checks: source("packages/runtime/src/checks.ts", ['export * from "./errors.js";', 'export * from "./random.js";']),
  random: source("packages/runtime/src/random.ts", [
    'export * from "./errors.js";',
    'export * from "./checks.js";',
    'export * from "./xml/index.js";',
  ]),
};

const packages = {
  runtime: source("packages/runtime/src/xml/player.ts", ['export * from "@assesskit/player";']),
  runtimeTest: source("packages/runtime/test/player.test.ts", ['export * from "@assesskit/player/view";']),
  player: source("packages/player/src/imports.ts", [
    'export * from "../../runtime/src/xml/index.js";',
    'export * from "../../runtime/dist/index.js";',
    'export * from "@assesskit/runtime/xml";',
    'export * from "./imports.js";',
  ]),
};

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "runtime-lint-"));
  cpSync(join(ROOT, "biome.json"), join(project, "biome.json"));
  cpSync(join(ROOT, "biome"), join(project, "biome"), { recursive: true });
  for (const [path, code] of sources) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), code);
  }
  const run = spawnSync(
    join(ROOT, "node_modules/.bin/biome"),
    ["lint", "--vcs-enabled=false", "--reporter=json", "."],
    {
      cwd: project,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const result: { diagnostics: Diagnostic[] } = JSON.parse(run.stdout);
  for (const { category, message, location } of result.diagnostics) {
    const list = findings.get(location.path) ?? [];
    list.push({ line: location.start.line, what: category === "plugin" ? message : category });
    findings.set(location.path, list);
  }
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("GritQL rules", () => {
  for (const { ban, path, message } of bans) {
    it(`bans ${ban}`, () => {
      expect(whatFor(path).filter((what) => what.includes(message))).toHaveLength(1);
    });
  }

  it("allows a Date with arguments and a regular expression literal", () => {
    expect(whatFor(allowedCalls)).toEqual([]);
  });
});

describe("platform rules", () => {
  it("keeps the core free of platform APIs, eval and console", () => {
    for (const path of [platform.fetch, platform.env, platform.timer]) {
      expect(whatFor(path), path).not.toEqual([]);
    }
    expect(whatFor(platform.fs)).toContain("lint/correctness/noNodejsModules");
    expect(whatFor(platform.evaluation)).toContain("lint/security/noGlobalEval");
    expect(whatFor(platform.console)).toContain("lint/suspicious/noConsole");
  });

  it("lets node/ and cli/ use Node.js, and cli/ the console", () => {
    expect(whatFor(platform.nodeFs)).not.toContain("lint/correctness/noNodejsModules");
    expect(whatFor(platform.cliEnv)).not.toContain("lint/style/noProcessEnv");
    expect(whatFor(platform.cliConsole)).not.toContain("lint/suspicious/noConsole");
  });
});

describe("layering", () => {
  for (const { module, targets, path } of layers) {
    it(`lets ${module}/ import exactly its row of the table`, () => {
      const flagged = linesFor(path, RESTRICTED_IMPORT).map((line) => targets[line - 1]);
      const forbidden = targets.filter((target) => !SHARED.includes(target) && !LAYERS[module]?.includes(target));
      expect(flagged).toEqual(forbidden);
    });
  }

  it("limits errors.ts to nothing, checks.ts to errors.ts and random.ts to errors.ts and checks.ts", () => {
    expect(linesFor(rootFiles.errors, RESTRICTED_IMPORT)).toEqual([1, 2]);
    expect(linesFor(rootFiles.checks, RESTRICTED_IMPORT)).toEqual([2]);
    expect(linesFor(rootFiles.random, RESTRICTED_IMPORT)).toEqual([3]);
  });

  it("keeps the runtime from importing the player", () => {
    expect(whatFor(packages.runtime)).toContain(RESTRICTED_IMPORT);
    expect(whatFor(packages.runtimeTest)).toContain(RESTRICTED_IMPORT);
  });

  it("keeps the player to the published subpaths of the runtime", () => {
    expect(linesFor(packages.player, RESTRICTED_IMPORT)).toEqual([1, 2]);
  });
});
