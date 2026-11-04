import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { isAllowed } from "../../../scripts/check-licenses.ts";
import { TARGETS } from "../../player/scripts/build-static.ts";

const PACKAGE = resolve(import.meta.dirname, "..");
const RUNTIME = resolve(PACKAGE, "../runtime/src");

/** An interaction's module: its source folder in `src/`, and the files of a dependency that it loads beside it. */
interface ModuleSource {
  readonly name: string;
  /**
   * Files and folders copied below `<name>/`, by the path they go to: what the module loads at run time, and the license
   * that goes with them.
   */
  readonly assets: ReadonlyMap<string, string>;
}

/** The module of each interaction of the package. */
export const MODULES: readonly ModuleSource[] = [
  {
    name: "math-entry",
    // MathLive's fonts are KaTeX's, under the SIL Open Font License 1.1, whose text goes with them.
    assets: new Map([
      ["fonts", resolve(PACKAGE, "node_modules/mathlive/fonts")],
      ["fonts/OFL.txt", resolve(PACKAGE, "licenses/katex-fonts-ofl.txt")],
    ]),
  },
];

/** A package of `node_modules` whose code a module holds: its name, version, license and the text of its license file. */
export interface BundledPackage {
  readonly name: string;
  readonly version: string;
  readonly license: string;
}

/** The package that a file of `node_modules` belongs to, by the folder that holds its `package.json`. */
function packageFolderOf(file: string): string | undefined {
  const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(file);
  return match?.[1];
}

/** The license notice of a bundled package for the head of a module: its license file, as a comment that nothing closes early. */
async function noticeOf(folder: string, bundled: BundledPackage): Promise<string> {
  const files = ["LICENSE", "LICENSE.txt", "LICENSE.md"];
  for (const file of files) {
    try {
      const text = (await readFile(join(folder, file), "utf8")).replaceAll("*/", "* /").trim();
      return `/*! ${bundled.name} ${bundled.version} (${bundled.license})\n${text}\n*/\n`;
    } catch {
      // The package names its license file otherwise; the next name is tried.
    }
  }
  throw new Error(`${bundled.name} has no license file among ${files.join(", ")}, which its module must carry.`);
}

/**
 * Builds the AMD module of an interaction: its source with what it imports as one classic script for the browsers of the
 * player's baseline, minified, headed by the license of each package it holds, and the files that the module loads beside it.
 * A package whose license is not one of those that `pnpm check:licenses` allows fails the build.
 *
 * @param source - The module to build.
 * @param directory - The folder of the modules: the script is `<name>.js` and its files are below `<name>/`.
 * @returns The packages that the module holds.
 */
export async function buildModule(source: ModuleSource, directory: string): Promise<readonly BundledPackage[]> {
  const result = await build({
    entryPoints: [resolve(PACKAGE, "src", source.name, "module.ts")],
    bundle: true,
    minify: true,
    format: "iife",
    target: TARGETS,
    legalComments: "none",
    metafile: true,
    write: false,
    logLevel: "silent",
    // The metafile names the files it read relative to the package.
    absWorkingDir: PACKAGE,
    outfile: join(directory, `${source.name}.js`),
    // The runtime's errors come from its sources, so that a module builds without a build of the runtime.
    alias: { "@assesskit/runtime/errors": resolve(RUNTIME, "errors.ts") },
  });
  const folders = [
    ...new Set(Object.keys(result.metafile.inputs).flatMap((file) => packageFolderOf(resolve(PACKAGE, file)) ?? [])),
  ].sort();
  const bundled: BundledPackage[] = [];
  let notices = "";
  for (const folder of folders) {
    const manifest: BundledPackage = JSON.parse(await readFile(join(folder, "package.json"), "utf8"));
    const entry = { name: manifest.name, version: manifest.version, license: manifest.license };
    if (!isAllowed(entry.license))
      throw new Error(`${entry.name} has the license ${entry.license}, which is not allowed.`);
    bundled.push(entry);
    notices += await noticeOf(folder, entry);
  }
  const [script] = result.outputFiles;
  if (script === undefined) throw new Error(`esbuild wrote no script for ${source.name}.`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${source.name}.js`), notices + script.text);
  for (const [to, from] of source.assets) await cp(from, join(directory, source.name, to), { recursive: true });
  return bundled;
}

/**
 * Builds the module of every interaction into a folder.
 *
 * @param directory - The folder of the modules.
 */
export async function buildModules(directory: string): Promise<void> {
  for (const source of MODULES) await buildModule(source, directory);
}

if (import.meta.main) await buildModules(resolve(process.argv[2] ?? join(PACKAGE, "modules")));
