import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { subpathSources } from "./subpaths.ts";

/** Returns the `.ts` files below a folder. */
function filesBelow(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return filesBelow(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Returns the text of the source files below a folder, by their path from the root.
 *
 * @param root - The root of the repository.
 * @param folder - The folder below it, such as `packages/runtime/src`.
 */
export function sourcesBelow(root: string, folder: string): Record<string, string> {
  return Object.fromEntries(
    filesBelow(join(root, folder)).map((path) => [relative(root, path), readFileSync(path, "utf8")]),
  );
}

/**
 * Returns what `runExample` of a test in Node needs to load the modules of an example: a package of the repository by its
 * sources, so that no build is needed, and any other module by `load`, which the test gives so that the module is found from
 * the package that the example belongs to.
 *
 * @param root - The root of the repository.
 * @param load - Imports any other module, such as `node:fs` or a dependency of the package.
 */
export function sourceLoader(
  root: string,
  load: (specifier: string) => Promise<object>,
): (specifier: string) => Promise<object> {
  const sources = subpathSources(
    new Map(
      readdirSync(join(root, "packages")).map((folder) => {
        const file = `packages/${folder}/package.json`;
        return [file, readFileSync(join(root, file), "utf8")];
      }),
    ),
  );
  return async (specifier) => {
    const source = sources.get(specifier);
    return source === undefined ? load(specifier) : import(/* @vite-ignore */ join(root, source));
  };
}
