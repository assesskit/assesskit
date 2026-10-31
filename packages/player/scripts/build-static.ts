import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { build, transform } from "esbuild";

const FRAME_SOURCE = resolve(import.meta.dirname, "../src/player/pci/frame");
const WORKLET_SOURCE = resolve(import.meta.dirname, "../src/player/recording/worklet/recorder-worklet.ts");

/** The browsers of docs/player/baseline.md as esbuild targets. */
export const TARGETS = ["chrome111", "firefox115", "safari16.4"];

/**
 * Builds the files that the host serves for the frame of a portable custom interaction: `frame.html`, the classic script
 * `bridge.js` that bundles `bridge.ts` with what it imports, and RequireJS as `require.js`, both minified. A classic script,
 * because a module script of an opaque origin needs CORS headers on the static files. A `package.json` beside them marks the
 * scripts as CommonJS.
 *
 * @param directory - Where to write the three files; it is created.
 */
export async function buildFrame(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await build({
    entryPoints: [join(FRAME_SOURCE, "bridge.ts")],
    outfile: join(directory, "bridge.js"),
    bundle: true,
    minify: true,
    format: "iife",
    target: TARGETS,
    legalComments: "none",
  });
  await copyFile(join(FRAME_SOURCE, "frame.html"), join(directory, "frame.html"));
  // The license comment of RequireJS stays in the minified script.
  const loader = await readFile(createRequire(import.meta.url).resolve("requirejs/require.js"), "utf8");
  const { code } = await transform(loader, { minify: true, target: TARGETS, legalComments: "inline" });
  await writeFile(join(directory, "require.js"), code);
  // The scripts are not ES modules, whatever the `type` of the package says; tools that read the exports need to know.
  await writeFile(join(directory, "package.json"), '{ "type": "commonjs" }\n');
}

/**
 * Builds the script that the page loads into the audio worklet of a WAV recording: `recorder-worklet.ts` and what it
 * imports as one classic script. A worklet loads its module from a URL, so the host serves the file from `staticUrl`.
 *
 * @param file - Where to write the script.
 */
export async function buildWorklet(file: string): Promise<void> {
  await build({
    entryPoints: [WORKLET_SOURCE],
    outfile: file,
    bundle: true,
    minify: true,
    format: "iife",
    target: TARGETS,
    legalComments: "none",
  });
}

if (import.meta.main) {
  await buildFrame(resolve(process.argv[2] ?? "dist/pci-frame"));
  await buildWorklet(resolve(process.argv[3] ?? "dist/recorder-worklet.js"));
}
