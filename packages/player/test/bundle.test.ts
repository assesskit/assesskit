import { resolve } from "node:path";
import { build, type Metafile } from "esbuild";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "../src");
const RUNTIME = resolve(import.meta.dirname, "../../runtime/src");

/** The files of the runtime's delivery engine, which hold answer keys, processing and the state of a session. */
const ENGINE_FILES = [
  "delivery/engine.ts",
  "delivery/course.ts",
  "delivery/session-step.ts",
  "delivery/item-action.ts",
  "delivery/navigation.ts",
  "delivery/scoring.ts",
  "delivery/results-assembly.ts",
  "delivery/state-json.ts",
  "delivery/stamp.ts",
  "processing/index.ts",
];

/** Bundles a program for a browser, as a host's bundler would, and returns the files that have code in the output. */
async function bundled(program: string): Promise<string[]> {
  const result = await build({
    stdin: { contents: program, resolveDir: SRC, loader: "ts" },
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "browser",
    target: "es2023",
    logLevel: "silent",
    alias: {
      "@assesskit/runtime": `${RUNTIME}/index.ts`,
      "@assesskit/runtime/errors": `${RUNTIME}/errors.ts`,
      "@assesskit/runtime/delivery": `${RUNTIME}/delivery/index.ts`,
      "@assesskit/runtime/asi": `${RUNTIME}/asi/index.ts`,
      "@assesskit/runtime/content": `${RUNTIME}/content/index.ts`,
      "@assesskit/runtime/interactions": `${RUNTIME}/interactions/index.ts`,
      "@assesskit/runtime/package": `${RUNTIME}/package/index.ts`,
      "@assesskit/runtime/pci": `${RUNTIME}/pci/index.ts`,
      "@assesskit/runtime/pnp": `${RUNTIME}/pnp/index.ts`,
      "@assesskit/runtime/values": `${RUNTIME}/values/index.ts`,
      "@assesskit/runtime/xml": `${RUNTIME}/xml/index.ts`,
    },
  });
  const metafile: Metafile = result.metafile;
  // `inputs` lists every file the bundler read; the outputs say which of them still have code after tree shaking.
  return Object.values(metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs).flatMap(([path, { bytesInOutput }]) => (bytesInOutput > 0 ? [resolve(path)] : [])),
  );
}

const engineFilesIn = (inputs: readonly string[]): string[] =>
  ENGINE_FILES.filter((file) => inputs.includes(resolve(RUNTIME, file)));

describe("the exam bundle", () => {
  it("holds none of the runtime's engine: the player and the remote session read views and write actions only", async () => {
    const inputs = await bundled(`
      import { mountDelivery } from "./player/index.ts";
      import { createRemoteSession } from "./client/index.ts";
      export { mountDelivery, createRemoteSession };
    `);
    expect(inputs.some((path) => path.endsWith("client/remote.ts"))).toBe(true);
    expect(inputs.some((path) => path.endsWith("player/delivery/mount.ts"))).toBe(true);
    expect(inputs.some((path) => path.endsWith("delivery/view-json.ts"))).toBe(true);
    expect(inputs.some((path) => path.endsWith("client/local.ts"))).toBe(false);
    expect(engineFilesIn(inputs)).toEqual([]);
  });

  it("holds the engine in a bundle that makes a local session, which is how the check sees it", async () => {
    const inputs = await bundled(`
      import { createLocalSession } from "./client/index.ts";
      export { createLocalSession };
    `);
    expect(engineFilesIn(inputs)).toContain("delivery/engine.ts");
  });
});
