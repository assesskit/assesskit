import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const SOURCE = resolve(import.meta.dirname, "../src/player/pci/frame");

/** The browsers of docs/baseline.md as esbuild targets. */
const TARGETS = ["chrome111", "firefox115", "safari16.4"];

/**
 * Builds the files that the host serves for the frame of a portable custom interaction: `frame.html`, the classic script
 * `bridge.js` that bundles `bridge.ts` with what it imports, and RequireJS as `require.js`. A classic script, because a
 * module script of an opaque origin needs CORS headers on the static files. A `package.json` beside them marks the
 * scripts as CommonJS.
 *
 * @param directory - Where to write the three files; it is created.
 */
export async function buildFrame(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await build({
    entryPoints: [join(SOURCE, "bridge.ts")],
    outfile: join(directory, "bridge.js"),
    bundle: true,
    format: "iife",
    target: TARGETS,
    legalComments: "none",
  });
  await copyFile(join(SOURCE, "frame.html"), join(directory, "frame.html"));
  await copyFile(createRequire(import.meta.url).resolve("requirejs/require.js"), join(directory, "require.js"));
  // The scripts are not ES modules, whatever the `type` of the package says; tools that read the exports need to know.
  await writeFile(join(directory, "package.json"), '{ "type": "commonjs" }\n');
}

if (import.meta.main) await buildFrame(resolve(process.argv[2] ?? "dist/pci-frame"));
