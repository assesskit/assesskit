import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** What a changeset says about a package, from the least change to the greatest. */
export const BUMPS = ["patch", "minor", "major"] as const;

/** A bump of a changeset. */
export type Bump = (typeof BUMPS)[number];

/** The fields of a `package.json` that decide whether and as which version `changeset publish` publishes the package. */
export interface PackageManifest {
  readonly name: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly publishConfig?: { readonly access?: string };
}

/** The version of a package that has never been released. */
const UNRELEASED = "0.0.0";

/** Each package that the changesets in the text of their files release, with the greatest bump among them, in the order they appear. */
export function releasedBumps(changesets: readonly string[]): Map<string, Bump> {
  const bumps = new Map<string, Bump>();
  for (const text of changesets) {
    const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
    for (const line of header.split(/\r?\n/)) {
      const entry = /^\s*["']?(@?[^"':]+)["']?\s*:\s*(major|minor|patch)\s*$/.exec(line);
      if (entry?.[1] === undefined || entry[2] === undefined) continue;
      const bump = entry[2] as Bump;
      const before = bumps.get(entry[1]);
      if (before === undefined || BUMPS.indexOf(bump) > BUMPS.indexOf(before)) bumps.set(entry[1], bump);
    }
  }
  return bumps;
}

/**
 * Returns what keeps a released package off npm, as sentences: it is not a package of this repository, it is private, which
 * Changesets versions and never publishes, or it lacks the public access that a scoped package needs.
 */
export function unpublishable(released: Iterable<string>, manifests: readonly PackageManifest[]): string[] {
  return [...released].flatMap((name) => {
    const manifest = manifests.find((candidate) => candidate.name === name);
    if (manifest === undefined) return [`${name} is in a changeset but is not a package of packages/.`];
    if (manifest.private === true)
      return [`${name} is in a changeset but is private, so \`changeset publish\` skips it; remove "private".`];
    if (manifest.publishConfig?.access !== "public")
      return [`${name} is in a changeset but has no publishConfig.access "public"; add it.`];
    return [];
  });
}

/**
 * Returns the packages whose first release would not be 1.0.0, as sentences. A package at 0.0.0 takes `major` at its first
 * release; `minor` would release 0.1.0, and 1.0.0 is the first version that every package of the family takes.
 */
export function wrongFirstReleases(bumps: ReadonlyMap<string, Bump>, manifests: readonly PackageManifest[]): string[] {
  return [...bumps].flatMap(([name, bump]) => {
    const manifest = manifests.find((candidate) => candidate.name === name);
    return manifest?.version === UNRELEASED && bump !== "major"
      ? [
          `${name} is at ${UNRELEASED} and its changesets give it ${bump}; the first release takes major, which is 1.0.0.`,
        ]
      : [];
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

/** Checks that every package of a changeset is published, and as 1.0.0 when it is a first release, and returns the exit code. */
function main(): number {
  const { changesets, manifests } = readRepository(resolve(import.meta.dirname, ".."));
  const bumps = releasedBumps(changesets);
  const found = [...unpublishable(bumps.keys(), manifests), ...wrongFirstReleases(bumps, manifests)];
  for (const line of found) console.error(line);
  console.log(
    found.length === 0
      ? `Every one of ${bumps.size} released packages is published, and a first release is 1.0.0.`
      : `${found.length} released packages would not be published as they should.`,
  );
  return found.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
