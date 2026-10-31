import { resolve } from "node:path";
import { build, type Metafile, type OutputFile } from "esbuild";
import { TARGETS } from "../scripts/build-static.js";

const SRC = resolve(import.meta.dirname, "../src");
const RUNTIME = resolve(import.meta.dirname, "../../runtime/src");

/** The subpaths of the runtime that the player imports, each a folder of its sources with an `index.ts`. */
const RUNTIME_FOLDERS = [
  "asi",
  "content",
  "delivery",
  "interactions",
  "package",
  "pci",
  "pnp",
  "values",
  "xml",
] as const;

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
 * Bundles a program of the sources of the player for a browser, as a host's bundler would, with the runtime from its
 * sources.
 *
 * @param program - The module to bundle, which resolves relative imports from `src/` of the player.
 * @param options - See {@link BundleOptions}.
 */
export async function bundle(program: string, options: BundleOptions = {}): Promise<Bundled> {
  const { minify = false, lazy = false } = options;
  const result = await build({
    stdin: { contents: program, resolveDir: SRC, loader: "ts" },
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "browser",
    target: TARGETS,
    minify,
    legalComments: "none",
    logLevel: "silent",
    outdir: "out",
    alias: {
      "@assesskit/runtime": `${RUNTIME}/index.ts`,
      "@assesskit/runtime/errors": `${RUNTIME}/errors.ts`,
      ...Object.fromEntries(
        RUNTIME_FOLDERS.map((folder) => [`@assesskit/runtime/${folder}`, `${RUNTIME}/${folder}/index.ts`]),
      ),
    },
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
