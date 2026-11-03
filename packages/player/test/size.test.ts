import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFrame, buildWorklet } from "../scripts/build-static.js";
import { bundle, entrySources } from "./bundle.js";
import { ENTRY_BUDGETS, SIZE_BUDGETS } from "./size-budgets.js";

// The sizes that a host loads first for each entry point of both packages, as its bundler makes them (minified, for the
// browsers of the baseline, with code splitting), and the modules that each holds, against size-budgets.ts.
// docs/player/size.md and docs/runtime/performance.md list them.

const PLAYER = resolve(import.meta.dirname, "..");
const PACKAGES = resolve(PLAYER, "..");

/** The bytes of a file after gzip at its best level, which is what a server sends. */
const gzipped = (bytes: Uint8Array): number => gzipSync(bytes, { level: 9 }).length;

/** Every entry point of both packages that exports code, by its specifier, with its source file. */
const ENTRIES = new Map([...entrySources("runtime"), ...entrySources("player")]);

/** The entry points that only Node.js loads: the runtime's access to files and its command line. */
const NODE_ENTRIES = new Set(["@assesskit/runtime/node", "@assesskit/runtime/cli"]);

/**
 * The module that a file of a bundle belongs to: `runtime/<folder>` or `player/<folder>` for a source of either package
 * (`runtime/checks` for `src/checks.ts`), and the name of the package for a dependency.
 */
function moduleOf(path: string): string {
  const dependency = /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\//.exec(path);
  if (dependency?.[1] !== undefined) return dependency[1];
  const [folder = "", , first = ""] = relative(PACKAGES, path).split("/");
  return `${folder}/${first.replace(/\.ts$/, "")}`;
}

/**
 * What a host's bundler gives an entry point alone, minified: the bytes of its first load before and after gzip, the files
 * of its first load and of what it loads on demand, and the modules other than its own that have code in its first load, in
 * order.
 */
async function entry(specifier: string) {
  const source = ENTRIES.get(specifier) ?? "";
  const bundled = await bundle(`export * from ${JSON.stringify(source)};`, {
    minify: true,
    platform: NODE_ENTRIES.has(specifier) ? "node" : "browser",
  });
  const own = moduleOf(source);
  const modules = [...new Set(bundled.inputs.map(moduleOf))].filter((name) => name !== own).sort();
  return { ...bundled, modules };
}

/** Whether a file is one of the runtime's processing, which only the engine runs. */
const isProcessing = (path: string): boolean => path.includes("/runtime/src/processing/");

describe("every entry point alone", () => {
  it("has a budget for each entry point of both packages, and none for a name that is not one", () => {
    expect(Object.keys(ENTRY_BUDGETS).sort()).toEqual([...ENTRIES.keys()].sort());
  });

  it.each([...ENTRIES.keys()])("keeps %s within its budget, holding only the modules it lists", async (specifier) => {
    const { gzip, modules } = await entry(specifier);
    const budget = ENTRY_BUDGETS[specifier] ?? expect.unreachable(`No budget for ${specifier}.`);
    expect(gzip, `The gzipped bytes of ${specifier}`).toBeLessThan(budget.gzip);
    expect(modules, `The modules other than its own in ${specifier}`).toEqual(budget.holds);
  });
});

describe("the size of what a page loads", () => {
  it("keeps the engine of the runtime out of the first load of a client, which loads it on demand", async () => {
    const { inputs, onDemand } = await entry("@assesskit/player/client");
    expect(inputs.some(isProcessing)).toBe(false);
    expect(onDemand.some(isProcessing)).toBe(true);
  });

  it("keeps the engine out of an exam page, which imports only the remote session from the client", async () => {
    const { inputs, gzip } = await bundle('export { createRemoteSession } from "./client/index.ts";', { minify: true });
    expect(inputs.some(isProcessing)).toBe(false);
    expect(gzip, "The gzipped bytes of the first load of createRemoteSession").toBeLessThan(SIZE_BUDGETS.remote);
  });

  it("holds no server library and no XML parser in the root, the protocol and the client", async () => {
    for (const name of ["@assesskit/player", "@assesskit/player/protocol", "@assesskit/player/client"]) {
      const { modules } = await entry(name);
      expect(
        modules.filter((module) => ["jose", "uuid", "saxes"].includes(module)),
        `The libraries in the entry point ${name}`,
      ).toEqual([]);
    }
  });

  it("holds no catalog of Indonesian in the root, the protocol, the client, the player or the first load of an item", async () => {
    const firstLoads = [
      ...[
        "@assesskit/player",
        "@assesskit/player/protocol",
        "@assesskit/player/client",
        "@assesskit/player/player",
      ].map(async (name) => [name, (await entry(name)).inputs] as const),
      item().then(({ inputs }) => ["mountItem", inputs] as const),
    ];
    for (const [name, inputs] of await Promise.all(firstLoads)) {
      expect(
        inputs.filter((path) => path.endsWith("/messages/id/index.ts")),
        `The catalog of Indonesian in ${name}`,
      ).toEqual([]);
    }
  });

  it("holds no server library in the player", async () => {
    const { modules } = await entry("@assesskit/player/player");
    expect(modules.filter((module) => ["jose", "uuid"].includes(module))).toEqual([]);
  });

  it("keeps the first load of an item within its budget, with no server library", async () => {
    const { gzip, inputs } = await item();
    expect(gzip, "The gzipped bytes of mountItem").toBeLessThan(SIZE_BUDGETS.item);
    expect(inputs.map(moduleOf).filter((module) => ["jose", "uuid"].includes(module))).toEqual([]);
  });

  it("makes an item cost less than the player with its chrome and its tools", async () => {
    const first = await item();
    const delivery = await bundle('export { mountDelivery } from "./player/index.ts";', { minify: true });
    expect(first.gzip, "The gzipped bytes of mountItem against mountDelivery").toBeLessThan(delivery.gzip);
  });
});

/** The first load of `mountItem`, which shares the content and the interactions with `mountDelivery` and has none of its chrome. */
const item = () => bundle('export { mountItem } from "./player/index.ts";', { minify: true });

describe("the size of the static files", () => {
  let directory = "";
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "assesskit-size-"));
    await buildFrame(join(directory, "frame"));
    await buildWorklet(join(directory, "recorder-worklet.js"));
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it.each([
    ["the bridge of the frame of a portable custom interaction", "frame/bridge.js", "bridge"],
    ["RequireJS in that frame", "frame/require.js", "requirejs"],
    ["the script of the audio worklet", "recorder-worklet.js", "worklet"],
  ] as const)("keeps %s within its budget", (_, file, budget) => {
    const gzip = gzipped(readFileSync(join(directory, file)));
    expect(gzip, `The gzipped bytes of ${file}`).toBeLessThan(SIZE_BUDGETS[budget]);
  });

  it("keeps the stylesheet within its budget", () => {
    const gzip = gzipped(readFileSync(join(PLAYER, "player.css")));
    expect(statSync(join(PLAYER, "player.css")).size).toBeGreaterThan(0);
    expect(gzip, "The gzipped bytes of player.css").toBeLessThan(SIZE_BUDGETS.stylesheet);
  });
});
