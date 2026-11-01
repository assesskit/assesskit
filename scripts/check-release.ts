import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The fields of a `package.json` that decide whether `changeset publish` publishes the package. */
export interface PackageManifest {
  readonly name: string;
  readonly private?: boolean;
  readonly publishConfig?: { readonly access?: string };
}

/** The names of the packages that the changesets in the text of their files release, in the order they appear. */
export function releasedPackages(changesets: readonly string[]): string[] {
  const names = new Set<string>();
  for (const text of changesets) {
    const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
    for (const line of header.split(/\r?\n/)) {
      const name = /^\s*["']?(@?[^"':]+)["']?\s*:\s*(?:major|minor|patch)\s*$/.exec(line)?.[1];
      if (name !== undefined) names.add(name);
    }
  }
  return [...names];
}

/**
 * Returns what keeps a released package off npm, as sentences: it is not a package of this repository, it is private, which
 * Changesets versions and never publishes, or it lacks the public access that a scoped package needs.
 */
export function unpublishable(released: readonly string[], manifests: readonly PackageManifest[]): string[] {
  return released.flatMap((name) => {
    const manifest = manifests.find((candidate) => candidate.name === name);
    if (manifest === undefined) return [`${name} is in a changeset but is not a package of packages/.`];
    if (manifest.private === true)
      return [`${name} is in a changeset but is private, so \`changeset publish\` skips it; remove "private".`];
    if (manifest.publishConfig?.access !== "public")
      return [`${name} is in a changeset but has no publishConfig.access "public"; add it.`];
    return [];
  });
}

/** The text of the changesets and the manifests of the packages of a repository. */
export function readRepository(root: string): {
  readonly changesets: string[];
  readonly manifests: PackageManifest[];
} {
  const changesets = readdirSync(join(root, ".changeset"))
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .map((file) => readFileSync(join(root, ".changeset", file), "utf8"));
  const manifests = readdirSync(join(root, "packages")).map(
    (folder): PackageManifest => JSON.parse(readFileSync(join(root, "packages", folder, "package.json"), "utf8")),
  );
  return { changesets, manifests };
}

/** Checks that every package of a changeset is published, and returns the exit code. */
function main(): number {
  const { changesets, manifests } = readRepository(resolve(import.meta.dirname, ".."));
  const released = releasedPackages(changesets);
  const found = unpublishable(released, manifests);
  for (const line of found) console.error(line);
  console.log(
    found.length === 0
      ? `Every one of ${released.length} released packages is published.`
      : `${found.length} released packages would not be published.`,
  );
  return found.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
