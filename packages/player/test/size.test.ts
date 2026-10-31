import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFrame, buildWorklet } from "../scripts/build-static.js";
import { bundle } from "./bundle.js";
import { SIZE_BUDGETS } from "./size-budgets.js";

// The sizes that a host loads for each entry point of the browser side, as its bundler makes them (minified, for the
// browsers of the baseline), against the budgets of size-budgets.ts. docs/player/size.md lists them.

const PLAYER = resolve(import.meta.dirname, "..");

/** The bytes of a file after gzip at its best level, which is what a server sends. */
const gzipped = (bytes: Uint8Array): number => gzipSync(bytes, { level: 9 }).length;

/** The entry points of the browser side, by the program that exports all of the entry point. */
const ENTRY_POINTS = {
  root: 'export * from "./index.ts";',
  protocol: 'export * from "./protocol/index.ts";',
  client: 'export * from "./client/index.ts";',
  player: 'export * from "./player/index.ts";',
} as const;

/** What a host's bundler gives an entry point, and the sources it takes the code from. */
async function entry(name: keyof typeof ENTRY_POINTS) {
  const { output, inputs } = await bundle(ENTRY_POINTS[name], { minify: true, lazy: true });
  return { raw: output.contents.length, gzip: gzipped(output.contents), inputs };
}

describe("the size of the entry points", () => {
  it.each(Object.keys(ENTRY_POINTS) as (keyof typeof ENTRY_POINTS)[])(
    "keeps the %s entry point within its budget",
    async (name) => {
      const { gzip } = await entry(name);
      expect(gzip, `The gzipped bytes of the entry point ${name}`).toBeLessThan(SIZE_BUDGETS[name]);
    },
  );

  it("keeps the engine of the runtime out of the first load of a client, and within its budget when the client loads it", async () => {
    const first = await entry("client");
    expect(first.inputs.some((path) => path.includes("/runtime/src/processing/"))).toBe(false);
    const { output } = await bundle('export * from "@assesskit/runtime/delivery";', { minify: true });
    expect(gzipped(output.contents), "The gzipped bytes of the engine").toBeLessThan(SIZE_BUDGETS.engine);
  });

  it("holds no server library and no XML parser in the root, the protocol and the client", async () => {
    for (const name of ["root", "protocol", "client"] as const) {
      const { inputs } = await entry(name);
      const libraries = inputs.filter((path) =>
        /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(jose|uuid|saxes)\//.test(path),
      );
      expect(libraries, `The libraries in the entry point ${name}`).toEqual([]);
    }
  });

  it("holds no server library in the player", async () => {
    const { inputs } = await entry("player");
    expect(
      inputs.filter((path) => /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(jose|uuid)\//.test(path)),
    ).toEqual([]);
  });
});

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
