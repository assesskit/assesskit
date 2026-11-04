import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Bump,
  type PackageManifest,
  readRepository,
  releasedBumps,
  unpublishable,
  wrongFirstReleases,
} from "../check-release.ts";

const PUBLIC: PackageManifest = { name: "@assesskit/runtime", version: "0.0.0", publishConfig: { access: "public" } };

describe("releasedBumps", () => {
  it("names each package of the header of a changeset once, with the greatest bump among the changesets", () => {
    const first = '---\n"@assesskit/runtime": minor\n"@assesskit/player": patch\n---\n\nNotes.\n';
    const second = "---\n'@assesskit/runtime': major\n'@assesskit/player': minor\n---\n\nMore.\n";
    const third = '---\n"@assesskit/runtime": patch\n---\n\nLess.\n';
    expect([...releasedBumps([first, second, third])]).toStrictEqual([
      ["@assesskit/runtime", "major"],
      ["@assesskit/player", "minor"],
    ]);
  });

  it("ignores a changeset without a header and a line of the notes that looks like an entry", () => {
    expect([...releasedBumps(["Only notes.\n", '---\n---\n\n"x": major\n'])]).toStrictEqual([]);
  });
});

describe("unpublishable", () => {
  it("accepts a public package with public access", () => {
    expect(unpublishable(["@assesskit/runtime"], [PUBLIC])).toStrictEqual([]);
  });

  it("names a private package, which changeset publish skips without an error", () => {
    const core = { name: "@assesskit/runtime", private: true, publishConfig: { access: "public" } };
    expect(unpublishable(["@assesskit/runtime"], [core])).toStrictEqual([
      '@assesskit/runtime is in a changeset but is private, so `changeset publish` skips it; remove "private".',
    ]);
  });

  it("names a package without public access and one that is not a package of the repository", () => {
    expect(unpublishable(["@assesskit/runtime", "@assesskit/lost"], [{ name: "@assesskit/runtime" }])).toStrictEqual([
      '@assesskit/runtime is in a changeset but has no publishConfig.access "public"; add it.',
      "@assesskit/lost is in a changeset but is not a package of packages/.",
    ]);
  });
});

describe("wrongFirstReleases", () => {
  it("accepts major for a package at 0.0.0, and any bump for a package that has been released", () => {
    const bumps = new Map<string, Bump>([
      ["@assesskit/runtime", "major"],
      ["@assesskit/player", "minor"],
    ]);
    const released = { name: "@assesskit/player", version: "1.0.0" };
    expect(wrongFirstReleases(bumps, [PUBLIC, released])).toStrictEqual([]);
  });

  it("names a package never released that a minor or a patch would release below the first major", () => {
    const bumps = new Map<string, Bump>([
      ["@assesskit/runtime", "minor"],
      ["@assesskit/player", "patch"],
    ]);
    const player = { name: "@assesskit/player", version: "0.0.0" };
    expect(wrongFirstReleases(bumps, [PUBLIC, player])).toStrictEqual([
      "@assesskit/runtime is at 0.0.0 and its changesets give it minor; the first release takes major, which is 1.0.0.",
      "@assesskit/player is at 0.0.0 and its changesets give it patch; the first release takes major, which is 1.0.0.",
    ]);
  });
});

describe("the changesets of the repository", () => {
  it("release only packages that are published, and a package that is not yet released as 1.0.0", () => {
    const { changesets, manifests } = readRepository(join(import.meta.dirname, "../.."));
    const bumps = releasedBumps(changesets);
    expect([...bumps.keys()]).toContain("@assesskit/runtime");
    expect(unpublishable(bumps.keys(), manifests)).toStrictEqual([]);
    expect(wrongFirstReleases(bumps, manifests)).toStrictEqual([]);
  });
});
