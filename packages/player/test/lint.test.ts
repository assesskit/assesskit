import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const SRC = "packages/player/src";
const RESTRICTED_IMPORT = "lint/style/noRestrictedImports";

/** The units of the layering, and the units each one may import: the table of docs/player/architecture.md. */
const LAYERS: Readonly<Record<string, readonly string[]>> = {
  messages: [],
  protocol: ["messages"],
  player: ["messages", "protocol"],
  client: ["messages", "protocol"],
  scoring: ["messages", "protocol"],
  cat: ["messages", "protocol"],
  "cat-rest": ["messages", "protocol"],
  server: ["messages", "protocol", "scoring", "cat", "cat-rest"],
};
const FOLDERS = Object.keys(LAYERS);
const SHARED = ["errors", "checks"];

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

/** Returns the plugin messages of a file that start with the given text. */
function messagesFor(path: string, start: string): string[] {
  return whatFor(path).filter((what) => what.startsWith(start));
}

/** Returns the lines of a file that Biome reported with the given rule category. */
function linesFor(path: string, category: string): number[] {
  return (findings.get(path) ?? [])
    .filter(({ what }) => what === category)
    .map(({ line }) => line)
    .sort((a, b) => a - b);
}

/** Every other unit as a folder or a shared file imports it, in the order of the lines of its file. */
function targetsOf(unit: string): string[] {
  return [...SHARED, ...FOLDERS].filter((target) => target !== unit);
}
const importOf = (target: string): string =>
  `export * from "../${target}${SHARED.includes(target) ? ".js" : "/index.js"}";`;

const layers = FOLDERS.map((folder) => ({
  folder,
  targets: targetsOf(folder),
  path: source(`${SRC}/${folder}/layers.ts`, targetsOf(folder).map(importOf)),
}));
const rootFiles = {
  errors: source(`${SRC}/errors.ts`, ['export * from "./checks.js";', 'export * from "./messages/index.js";']),
  checks: source(`${SRC}/checks.ts`, ['export * from "./errors.js";', 'export * from "./messages/index.js";']),
  index: source(`${SRC}/index.ts`, [
    'export * from "./errors.js";',
    'export * from "./checks.js";',
    'export * from "./messages/index.js";',
    'export * from "./protocol/index.js";',
  ]),
};

const platform = {
  nodeInShared: source(`${SRC}/protocol/node.ts`, [
    'import { readFileSync } from "node:fs";',
    "export const a = readFileSync;",
  ]),
  nodeInBrowser: source(`${SRC}/player/node.ts`, [
    'import { readFileSync } from "node:fs";',
    "export const a = readFileSync;",
  ]),
  nodeInServer: source(`${SRC}/server/node.ts`, [
    'import { readFileSync } from "node:fs";',
    "export const a = readFileSync;",
  ]),
  nodeInSharedLayer3: ["scoring", "cat"].map((folder) =>
    source(`${SRC}/${folder}/node.ts`, ['import { readFileSync } from "node:fs";', "export const a = readFileSync;"]),
  ),
  nodeInCatRest: source(`${SRC}/cat-rest/node.ts`, [
    'import { readFileSync } from "node:fs";',
    "export const a = readFileSync;",
  ]),
  documentInShared: source(`${SRC}/protocol/document.ts`, ["export const a = document.title;"]),
  documentInBrowser: source(`${SRC}/player/document.ts`, ["export const a = document.title;"]),
  documentInServer: source(`${SRC}/server/document.ts`, ["export const a = document.title;"]),
  documentInSharedLayer3: ["scoring", "cat"].map((folder) =>
    source(`${SRC}/${folder}/document.ts`, ["export const a = document.title;"]),
  ),
  documentInCatRest: source(`${SRC}/cat-rest/document.ts`, ["export const a = document.title;"]),
  timerInShared: source(`${SRC}/protocol/timer.ts`, ["export const a = setTimeout(() => 1, 1);"]),
  timerInBrowser: source(`${SRC}/client/timer.ts`, ["export const a = setTimeout(() => 1, 1);"]),
  timerInSharedLayer3: ["scoring", "cat"].map((folder) =>
    source(`${SRC}/${folder}/timer.ts`, ["export const a = setTimeout(() => 1, 1);"]),
  ),
  timerInCatRest: source(`${SRC}/cat-rest/timer.ts`, ["export const a = setTimeout(() => 1, 1);"]),
  fetchInShared: source(`${SRC}/protocol/fetch.ts`, ['export const a = fetch("https://example.org");']),
  fetchInBrowser: source(`${SRC}/player/fetch.ts`, ['export const a = fetch("https://example.org");']),
  fetchInServer: source(`${SRC}/server/fetch.ts`, ['export const a = fetch("https://example.org");']),
  fetchInCatRest: source(`${SRC}/cat-rest/fetch.ts`, ['export const a = fetch("https://example.org");']),
  fetchOption: source(`${SRC}/cat-rest/option.ts`, [
    "export async function load(fetch: (url: string) => Promise<string>) {",
    '  return fetch("https://example.org");',
    "}",
  ]),
  env: source(`${SRC}/player/env.ts`, ["export const a = process.env.HOME;"]),
  evaluation: source(`${SRC}/server/evaluation.ts`, ['export const a = eval("1");']),
};

const official = {
  inPlayer: source(`${SRC}/player/official.ts`, ['export * from "../protocol/official.js";']),
  inClient: source(`${SRC}/client/official.ts`, ['export { markOfficial } from "../protocol/official";']),
  inScoring: source(`${SRC}/scoring/official.ts`, ['export * from "../protocol/official.js";']),
  inCatRest: source(`${SRC}/cat-rest/official.ts`, ['export * from "../protocol/official.js";']),
  inServer: source(`${SRC}/server/official.ts`, ['export * from "../protocol/official.js";']),
  inProtocol: source(`${SRC}/protocol/official-copy.ts`, ['export * from "./official.js";']),
};
const brand = {
  inPlayer: source(`${SRC}/player/brand.ts`, ['export { markOfficial } from "../protocol/internal.js";']),
  inClient: source(`${SRC}/client/brand.ts`, [
    'import { markOfficial } from "../protocol/internal.js";',
    "markOfficial({});",
  ]),
  inScoring: source(`${SRC}/scoring/brand.ts`, ['export { markOfficial } from "../protocol/internal";']),
  inCat: source(`${SRC}/cat/brand.ts`, ['export { markOfficial } from "../protocol/internal.js";']),
  inCatRest: source(`${SRC}/cat-rest/brand.ts`, ['export { markOfficial } from "../protocol/internal.js";']),
  inServer: source(`${SRC}/server/brand.ts`, ['export { markOfficial } from "../protocol/internal.js";']),
  otherName: source(`${SRC}/client/brand-other.ts`, ['export { readClock } from "../protocol/internal.js";']),
};
const runtimeByPath = {
  inShared: source(`${SRC}/protocol/runtime.ts`, ['export * from "../../../runtime/src/xml/index.js";']),
  inBrowser: source(`${SRC}/player/runtime.ts`, ['export * from "../../../runtime/dist/index.js";']),
  inServer: source(`${SRC}/server/runtime.ts`, ['export * from "@assesskit/runtime/xml";']),
  catOfRuntime: source(`${SRC}/cat-rest/runtime-cat.ts`, ['export * from "@assesskit/runtime/cat";']),
  catInProtocol: source(`${SRC}/protocol/runtime-cat.ts`, ['export type { CatPort } from "@assesskit/runtime/cat";']),
  catInClient: source(`${SRC}/client/runtime-cat.ts`, ['export type { CatPort } from "@assesskit/runtime/cat";']),
  catFolderInClient: source(`${SRC}/client/folder-cat.ts`, ['export * from "../cat/index.js";']),
};

const bans = [
  { ban: "Math.random", code: "Math.random()", message: "assesskit is deterministic" },
  { ban: "Date.now", code: "Date.now()", message: "assesskit never reads a clock" },
  { ban: "new Date without arguments", code: "new Date()", message: "assesskit never reads a clock" },
  { ban: "performance.now", code: "performance.now()", message: "assesskit never reads a clock" },
].flatMap((entry, i) =>
  ["protocol", "player", "server"].map((folder) => ({
    ...entry,
    folder,
    path: source(`${SRC}/${folder}/ban-${i}.ts`, [`export const a = ${entry.code};`]),
  })),
);
const clocks = [`${SRC}/client/clock.ts`, `${SRC}/server/clock.ts`].map((path) =>
  source(path, ["export const a = [Date.now(), new Date(), performance.now()];"]),
);
const allowedCalls = source(`${SRC}/player/allowed.ts`, [
  "export const a = [new Date(0), new Date(2024, 0), /a+/u, Math.floor(1.5)];",
]);

const DELIVERY = '"@assesskit/runtime/delivery"';
const WIRE = '"@assesskit/runtime/delivery/wire"';
const delivery = {
  allowed: source(`${SRC}/player/allowed-delivery.ts`, [
    `import { writeCandidateAction, readView } from ${WIRE};`,
    `import { readCandidateAction, type CandidateView, readView as read } from ${WIRE};`,
    `import type { CandidateAction, createEngine } from ${DELIVERY};`,
    `import {\n  type CandidateAction as Action,\n  type CandidateView as View,\n} from ${DELIVERY};`,
    `export type { CandidateView as Shown } from ${DELIVERY};`,
    `export { readView as shown } from ${WIRE};`,
    'import { buildContainer } from "@assesskit/runtime/values";',
  ]),
  denied: source(`${SRC}/client/denied-delivery.ts`, [
    `import { createEngine } from ${DELIVERY};`,
    `import { readView, type CandidateView } from ${DELIVERY};`,
    `import {\n  writeCandidateAction,\n  createEngine as engine,\n} from ${DELIVERY};`,
    `import * as delivery from ${DELIVERY};`,
    `import delivery2 from ${DELIVERY};`,
    `import ${DELIVERY};`,
    `export * from ${DELIVERY};`,
    `export { createEngine } from ${DELIVERY};`,
    `export const a = import(${DELIVERY});`,
  ]),
  local: source(`${SRC}/client/local/session.ts`, [
    `import { type CandidateView } from ${DELIVERY};`,
    `import { createEngine } from ${DELIVERY};`,
    `export const a = import(${DELIVERY});`,
  ]),
  server: source(`${SRC}/server/delivery.ts`, [
    `import { createEngine, readCandidateAction } from ${DELIVERY};`,
    `export const a = import(${DELIVERY});`,
  ]),
};
const spreadCalls = [
  "target.push(...values);",
  "target.unshift(...values);",
  "parent.append(...nodes);",
  "parent.prepend(...nodes);",
  "parent.replaceChildren(first, ...nodes);",
  "export const least = Math.min(...values);",
  "export const most = Math.max(0, ...values);",
];
const spreadHeader = [
  "declare const target: number[];",
  "declare const values: number[];",
  "declare const parent: Element;",
  "declare const nodes: Node[];",
  "declare const first: Node;",
  "declare const second: Node;",
];
const spread = {
  flagged: [`${SRC}/player`, `${SRC}/client`, `${SRC}/server`, "packages/runtime/src/delivery"].map((folder) =>
    source(`${folder}/spread.ts`, [...spreadHeader, ...spreadCalls]),
  ),
  literals: source(`${SRC}/player/spread-literals.ts`, [
    ...spreadHeader,
    "parent.append(...[first], second);",
    "parent.replaceChildren(...(nodes.length === 0 ? [] : [first]), ...[]);",
    "target.push(...[1, 2]);",
    "export const copy = [...values];",
    "export const node = { ...values };",
  ]),
  dom: source(`${SRC}/player/dom.ts`, [...spreadHeader, "parent.append(...nodes.slice(0, 10_000));"]),
};
const SPREAD = "A spread into the arguments of a call throws a RangeError";
const IMPORTS = "Browser code imports from @assesskit/runtime/delivery only";
const REEXPORTS = "Browser code re-exports from @assesskit/runtime/delivery only";
const LOADS = "Only client/local/session.ts loads @assesskit/runtime/delivery";

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "player-lint-"));
  cpSync(join(ROOT, "biome.json"), join(project, "biome.json"));
  cpSync(join(ROOT, "biome"), join(project, "biome"), { recursive: true });
  for (const [path, code] of sources) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), code);
  }
  const run = spawnSync(
    join(ROOT, "node_modules/.bin/biome"),
    ["lint", "--vcs-enabled=false", "--reporter=json", "."],
    { cwd: project, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
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

describe("layering", () => {
  for (const { folder, targets, path } of layers) {
    it(`lets ${folder}/ import exactly its row of the table`, () => {
      const flagged = linesFor(path, RESTRICTED_IMPORT).map((line) => targets[line - 1]);
      const forbidden = targets.filter((target) => !SHARED.includes(target) && !LAYERS[folder]?.includes(target));
      expect(flagged).toEqual(forbidden);
    });
  }

  it("limits errors.ts to nothing, checks.ts to errors.ts and index.ts to errors.ts and messages/", () => {
    expect(linesFor(rootFiles.errors, RESTRICTED_IMPORT)).toEqual([1, 2]);
    expect(linesFor(rootFiles.checks, RESTRICTED_IMPORT)).toEqual([2]);
    expect(linesFor(rootFiles.index, RESTRICTED_IMPORT)).toEqual([2, 4]);
  });

  it("lets only server/ import protocol/official.ts, which brands a report as official", () => {
    for (const path of [official.inPlayer, official.inClient, official.inScoring, official.inCatRest]) {
      expect(whatFor(path), path).toContain(RESTRICTED_IMPORT);
    }
    for (const path of [official.inServer, official.inProtocol]) {
      expect(whatFor(path), path).not.toContain(RESTRICTED_IMPORT);
    }
  });

  it("lets only server/ import markOfficial from the internal entry of protocol/", () => {
    for (const path of Object.values(brand).filter((each) => each !== brand.inServer && each !== brand.otherName)) {
      expect(whatFor(path), path).toContain(RESTRICTED_IMPORT);
    }
    for (const path of [brand.inServer, brand.otherName]) {
      expect(whatFor(path), path).not.toContain(RESTRICTED_IMPORT);
    }
  });

  it("keeps the player to the published subpaths of the runtime", () => {
    expect(whatFor(runtimeByPath.inShared)).toContain(RESTRICTED_IMPORT);
    expect(whatFor(runtimeByPath.inBrowser)).toContain(RESTRICTED_IMPORT);
    expect(whatFor(runtimeByPath.inServer)).not.toContain(RESTRICTED_IMPORT);
  });

  it("lets cat-rest/, client/ and protocol/ import the cat subpath of the runtime, though they may not import the cat/ folder", () => {
    for (const path of [runtimeByPath.catOfRuntime, runtimeByPath.catInProtocol, runtimeByPath.catInClient]) {
      expect(whatFor(path), path).not.toContain(RESTRICTED_IMPORT);
    }
    expect(whatFor(runtimeByPath.catFolderInClient)).toContain(RESTRICTED_IMPORT);
  });
});

describe("platform rules", () => {
  it("keeps Node.js out of the shared and browser folders and lets the server folders use it", () => {
    for (const path of [platform.nodeInShared, platform.nodeInBrowser, ...platform.nodeInSharedLayer3]) {
      expect(whatFor(path), path).toContain("lint/correctness/noNodejsModules");
    }
    for (const path of [platform.nodeInServer, platform.nodeInCatRest]) {
      expect(whatFor(path), path).not.toContain("lint/correctness/noNodejsModules");
    }
    expect(whatFor(platform.env)).toContain("lint/style/noProcessEnv");
  });

  it("keeps the DOM out of the shared and server folders and lets the browser folders use it", () => {
    for (const path of [
      platform.documentInShared,
      ...platform.documentInSharedLayer3,
      platform.documentInServer,
      platform.documentInCatRest,
    ]) {
      expect(whatFor(path), path).toContain("lint/style/noRestrictedGlobals");
    }
    expect(whatFor(platform.documentInBrowser)).not.toContain("lint/style/noRestrictedGlobals");
  });

  it("keeps timers out of the shared folders only", () => {
    for (const path of [platform.timerInShared, ...platform.timerInSharedLayer3]) {
      expect(whatFor(path), path).toContain("lint/style/noRestrictedGlobals");
    }
    for (const path of [platform.timerInBrowser, platform.timerInCatRest]) {
      expect(whatFor(path), path).not.toContain("lint/style/noRestrictedGlobals");
    }
  });

  it("lets fetch appear only as an option parameter", () => {
    for (const path of [
      platform.fetchInShared,
      platform.fetchInBrowser,
      platform.fetchInServer,
      platform.fetchInCatRest,
    ]) {
      expect(whatFor(path), path).toContain("lint/style/noRestrictedGlobals");
    }
    expect(whatFor(platform.fetchOption)).not.toContain("lint/style/noRestrictedGlobals");
  });

  it("bans eval everywhere", () => {
    expect(whatFor(platform.evaluation)).toContain("lint/security/noGlobalEval");
  });
});

describe("GritQL rules", () => {
  for (const { ban, folder, path, message } of bans) {
    it(`bans ${ban} in ${folder}/`, () => {
      expect(whatFor(path).filter((what) => what.includes(message))).toHaveLength(1);
    });
  }

  it("lets the clock files read the clock", () => {
    for (const path of clocks) expect(messagesFor(path, "assesskit never reads a clock"), path).toEqual([]);
  });

  it("allows a Date with arguments and a regular expression literal", () => {
    expect(messagesFor(allowedCalls, "assesskit")).toEqual([]);
  });
});

describe("browser-delivery-imports.grit", () => {
  it("lets browser folders import types from @assesskit/runtime/delivery, and anything from @assesskit/runtime/delivery/wire", () => {
    expect(messagesFor(delivery.allowed, "Browser code")).toEqual([]);
  });

  it("refuses every other import and re-export of @assesskit/runtime/delivery in the browser folders", () => {
    expect(messagesFor(delivery.denied, IMPORTS)).toHaveLength(6);
    expect(messagesFor(delivery.denied, REEXPORTS)).toHaveLength(2);
  });

  it("lets only client/local/session.ts load @assesskit/runtime/delivery with import()", () => {
    expect(messagesFor(delivery.denied, LOADS)).toHaveLength(1);
    expect(messagesFor(delivery.local, LOADS)).toEqual([]);
    expect(messagesFor(delivery.local, IMPORTS)).toHaveLength(1);
  });

  it("does not apply to the server folders", () => {
    expect(messagesFor(delivery.server, "Browser code")).toEqual([]);
    expect(messagesFor(delivery.server, "Only client")).toEqual([]);
  });
});

describe("no-spread-arguments.grit", () => {
  it("refuses a spread into push, unshift, append, prepend, replaceChildren, Math.min and Math.max in every folder of src", () => {
    for (const path of spread.flagged) {
      expect(messagesFor(path, SPREAD), path).toHaveLength(spreadCalls.length);
    }
  });

  it("lets a call spread an array literal, or a choice between array literals, whose length the code sets", () => {
    expect(messagesFor(spread.literals, SPREAD)).toEqual([]);
  });

  it("lets player/dom.ts append in steps, as appendAll does", () => {
    expect(messagesFor(spread.dom, SPREAD)).toEqual([]);
  });
});
