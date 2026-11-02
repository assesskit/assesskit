import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build, type Metafile, type OutputFile } from "esbuild";
import { TARGETS } from "../scripts/build-static.js";

const SRC = resolve(import.meta.dirname, "../src");
const PACKAGES = resolve(import.meta.dirname, "../..");

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
   * Whether a dynamic `import()` stays out of the bundle, as the chunk it loads on demand is not part of it.
   *
   * @defaultValue false
   */
  readonly lazy?: boolean;
  /**
   * The platform the bundle runs on: `node` for the entry points that only Node.js loads, whose imports of Node.js stay out.
   *
   * @defaultValue "browser"
   */
  readonly platform?: "browser" | "node";
}

/** What a bundle made of a program holds. */
export interface Bundled {
  /** The files with code in the output, as absolute paths. */
  readonly inputs: readonly string[];
  /** The bytes of each input in the output, by absolute path. */
  readonly bytes: ReadonlyMap<string, number>;
  /** The output file. */
  readonly output: OutputFile;
}

/**
 * Bundles a program of the sources of the player or of the runtime, as a host's bundler would, with the runtime from its
 * sources.
 *
 * @param program - The module to bundle, which resolves relative imports from `src/` of the player.
 * @param options - See {@link BundleOptions}.
 */
export async function bundle(program: string, options: BundleOptions = {}): Promise<Bundled> {
  const { minify = false, lazy = false, platform = "browser" } = options;
  const result = await build({
    stdin: { contents: program, resolveDir: SRC, loader: "ts" },
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform,
    target: platform === "browser" ? TARGETS : "node22",
    minify,
    legalComments: "none",
    logLevel: "silent",
    outdir: "out",
    alias: Object.fromEntries(entrySources("runtime")),
    plugins: lazy
      ? [
          {
            name: "lazy",
            setup: (builder) => {
              builder.onResolve({ filter: /.*/ }, ({ kind, path }) =>
                kind === "dynamic-import" ? { path, external: true } : undefined,
              );
            },
          },
        ]
      : [],
  });
  const metafile: Metafile = result.metafile;
  // `inputs` lists every file the bundler read; the outputs say which of them still have code after tree shaking.
  const bytes = new Map(
    Object.values(metafile.outputs).flatMap((output) =>
      Object.entries(output.inputs).flatMap(([path, { bytesInOutput }]) =>
        bytesInOutput > 0 ? [[resolve(path), bytesInOutput] as const] : [],
      ),
    ),
  );
  const [output] = result.outputFiles;
  if (output === undefined) throw new Error("The bundle has no output.");
  return { inputs: [...bytes.keys()], bytes, output };
}
