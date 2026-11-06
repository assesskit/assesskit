/** The entry of a package's manifest that `subpathSources` reads: the exports map, and the name that prefixes each address. */
interface Manifest {
  readonly name: string;
  readonly exports?: Readonly<Record<string, string | { readonly types?: string }>>;
}

/**
 * Returns the source file of each subpath of each package, by the address that an import names: the `types` of an entry of
 * `exports` is in `dist/`, and the file it comes from is in `src/`. Entries that carry no types, such as the stylesheet of
 * the player, are left out.
 *
 * @param manifests - The text of the `package.json` files, by their path from the root of the repository.
 */
export function subpathSources(manifests: ReadonlyMap<string, string>): Map<string, string> {
  const sources = new Map<string, string>();
  for (const [file, text] of manifests) {
    const folder = /^packages\/([^/]+)\/package\.json$/.exec(file)?.[1];
    if (folder === undefined) continue;
    const { name, exports } = JSON.parse(text) as Manifest;
    for (const [subpath, target] of Object.entries(exports ?? {})) {
      const types = typeof target === "object" ? target.types : undefined;
      if (types === undefined) continue;
      sources.set(
        `${name}${subpath.slice(1)}`,
        `packages/${folder}/src/${types.replace(/^\.\/dist\//, "").replace(/\.d\.ts$/, ".ts")}`,
      );
    }
  }
  return sources;
}
