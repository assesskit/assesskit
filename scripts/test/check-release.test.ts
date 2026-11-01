import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type PackageManifest, readRepository, releasedPackages, unpublishable } from "../check-release.ts";

const PUBLIC: PackageManifest = { name: "@assesskit/runtime", publishConfig: { access: "public" } };

describe("releasedPackages", () => {
  it("names each package of the header of a changeset once, whatever its bump", () => {
    const first = '---\n"@assesskit/player": major\n"@assesskit/runtime": patch\n---\n\nNotes.\n';
    const second = "---\n'@assesskit/runtime': minor\n---\n\nMore.\n";
    expect(releasedPackages([first, second])).toStrictEqual(["@assesskit/player", "@assesskit/runtime"]);
  });

  it("ignores a changeset without a header and a line of the notes that looks like an entry", () => {
    expect(releasedPackages(["Only notes.\n", '---\n---\n\n"x": major\n'])).toStrictEqual([]);
  });
});

describe("unpublishable", () => {
  it("accepts a public package with public access", () => {
    expect(unpublishable(["@assesskit/runtime"], [PUBLIC])).toStrictEqual([]);
  });

  it("names a private package, which changeset publish skips without an error", () => {
    const player = { name: "@assesskit/player", private: true, publishConfig: { access: "public" } };
    expect(unpublishable(["@assesskit/player"], [player])).toStrictEqual([
      '@assesskit/player is in a changeset but is private, so `changeset publish` skips it; remove "private".',
    ]);
  });

  it("names a package without public access and one that is not a package of the repository", () => {
    expect(unpublishable(["@assesskit/player", "@assesskit/lost"], [{ name: "@assesskit/player" }])).toStrictEqual([
      '@assesskit/player is in a changeset but has no publishConfig.access "public"; add it.',
      "@assesskit/lost is in a changeset but is not a package of packages/.",
    ]);
  });
});

describe("the changesets of the repository", () => {
  it("release only packages that are published", () => {
    const { changesets, manifests } = readRepository(join(import.meta.dirname, "../.."));
    const released = releasedPackages(changesets);
    expect(released).toContain("@assesskit/player");
    expect(unpublishable(released, manifests)).toStrictEqual([]);
  });
});
