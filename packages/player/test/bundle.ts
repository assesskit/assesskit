import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { TARGETS } from "../scripts/build-static.js";

const SRC = resolve(import.meta.dirname, "../src");
const PACKAGES = resolve(import.meta.dirname, "../..");
/** The repository, against which the metafile names the files that the bundler reads and writes. */
const ROOT = resolve(PACKAGES, "..");

/**
 * Returns the source file of each subpath of a package that exports code, by its specifier, from the `exports` of the
 * package's manifest: `./dist/<path>.js` is built from `src/<path>.ts`.
 *
 * @param folder - The folder of the package in `packages/`.
 */
export function entrySources(folder: "runtime" | "player"): ReadonlyMap<string, string> {
  const manifest: { name: string; exports: Record<string, string | { default: string }> } = JSON.parse(
    readFileSync(resolve(PACKAGES, folder, "package.json"), "utf8"),
  );
  return new Map(
    Object.entries(manifest.exports).flatMap(([subpath, target]) =>
      typeof target === "string"
        ? []
        : [
            [
              `${manifest.name}${subpath.slice(1)}`,
              resolve(PACKAGES, folder, target.default.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts")),
            ] as const,
          ],
    ),
  );
}

/** The options of {@link bundle}. */
export interface BundleOptions {
  /**
   * Whether to minify, for the size of a bundle.
   *
   * @defaultValue false
   */
  readonly minify?: boolean;
  /**
   * The platform the bundle runs on: `node` for the entry points that only Node.js loads, whose imports of Node.js stay out.
   *
   * @defaultValue "browser"
   */
  readonly platform?: "browser" | "node";
}

/** What a page loads of a program: its first load, and the files that only the chunks it loads on demand hold. */
export interface Bundled {
  /**
   * The files with code in the first load, as absolute paths: in the entry chunk, or in a chunk that it, or a chunk that loads
   * with it, imports statically.
   */
  readonly inputs: readonly string[];
  /** The files with code only in the chunks that `import()` loads on demand, as absolute paths. */
  readonly onDemand: readonly string[];
  /** The bytes of the first load. */
  readonly bytes: number;
  /** The bytes of the first load after gzip at its best level, which is what a server sends, file by file. */
  readonly gzip: number;
}

/**
 * Bundles a program of the sources of the player or of the runtime, as a host's bundler does for a page: esbuild with code
 * splitting, so that what `import()` loads is a chunk of its own, and the code that it shares with the first load is a chunk
 * that the first load imports. esbuild splits by file: a file that the first load reaches through any import goes in a chunk
 * of the first load, whatever of it the entry uses. The runtime comes from its sources.
 *
 * @param program - The module to bundle, which resolves relative imports from `src/` of the player.
 * @param options - See {@link BundleOptions}.
 */
export async function bundle(program: string, options: BundleOptions = {}): Promise<Bundled> {
  const { minify = false, platform = "browser" } = options;
  const result = await build({
    stdin: { contents: program, resolveDir: SRC, loader: "ts" },
    bundle: true,
    splitting: true,
    write: false,
    metafile: true,
    format: "esm",
    platform,
    target: platform === "browser" ? TARGETS : "node22",
    minify,
    legalComments: "none",
    logLevel: "silent",
    absWorkingDir: ROOT,
    // The folder of the chunks, which is never written: it names them in the metafile.
    outdir: "bundle",
    alias: Object.fromEntries(entrySources("runtime")),
  });
  const outputs = result.metafile.outputs;
  // The program is the one entry point; what `import()` loads is an entry point of the metafile too, with its source as its name.
  const entry = Object.keys(outputs).find((path) => outputs[path]?.entryPoint === "<stdin>");
  if (entry === undefined) throw new Error("The bundle has no entry chunk.");
  // The chunks that load with the entry: those that it, or a chunk that loads with it, imports statically.
  const first = new Set([entry]);
  for (const path of first) {
    for (const { path: imported, kind } of outputs[path]?.imports ?? []) {
      if (kind === "import-statement" && imported in outputs) first.add(imported);
    }
  }
  // `inputs` of an output lists every file that the bundler read for it; those with bytes in it still have code.
  const filesOf = (paths: readonly string[]): Set<string> =>
    new Set(
      paths.flatMap((path) =>
        Object.entries(outputs[path]?.inputs ?? {}).flatMap(([file, { bytesInOutput }]) =>
          bytesInOutput > 0 ? [resolve(ROOT, file)] : [],
        ),
      ),
    );
  const inputs = filesOf([...first]);
  const onDemand = [...filesOf(Object.keys(outputs).filter((path) => !first.has(path)))].filter(
    (file) => !inputs.has(file),
  );
  const files = result.outputFiles.filter(({ path }) => first.has(relative(ROOT, path)));
  return {
    inputs: [...inputs],
    onDemand,
    bytes: files.reduce((sum, { contents }) => sum + contents.byteLength, 0),
    gzip: files.reduce((sum, { contents }) => sum + gzipSync(contents, { level: 9 }).byteLength, 0),
  };
}
