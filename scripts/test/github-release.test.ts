import { describe, expect, it } from "vitest";
import { PACKAGES } from "../family.ts";
import { changelogEntry, readPublished, releaseNotes, releaseTag } from "../github-release.ts";

const [FIRST, SECOND] = PACKAGES;
const NAME = FIRST?.name ?? expect.unreachable("family.ts has no package.");
const OTHER = SECOND?.name ?? expect.unreachable("family.ts has one package.");

const CHANGELOG = `# ${NAME}

## 1.1.0

### Minor Changes

- abc1234: Reads one more thing.

## 1.0.0

### Major Changes

- def5678: The first release.
`;

describe("the GitHub release of a run", () => {
  it("reads the versions published from the tags at HEAD, in the order of the family's table", () => {
    expect(readPublished([`${OTHER}@2.0.0`, "v1", "@other/name@1.0.0", `${NAME}@1.1.0`])).toStrictEqual([
      { name: NAME, version: "1.1.0" },
      { name: OTHER, version: "2.0.0" },
    ]);
  });

  it("takes a version's entry from its changelog, up to the next version", () => {
    expect(changelogEntry(CHANGELOG, "1.1.0")).toBe("### Minor Changes\n\n- abc1234: Reads one more thing.");
    expect(changelogEntry(CHANGELOG, "1.0.0")).toBe("### Major Changes\n\n- def5678: The first release.");
    expect(changelogEntry(CHANGELOG, "9.9.9")).toBeUndefined();
  });

  it("writes a section for each version, its headings below the version's", () => {
    const notes = releaseNotes(
      [
        { name: NAME, version: "1.1.0" },
        { name: OTHER, version: "1.0.0" },
      ],
      (name) => (name === NAME ? CHANGELOG : ""),
    );
    expect(notes).toBe(
      `## ${NAME} 1.1.0\n\n#### Minor Changes\n\n- abc1234: Reads one more thing.\n\n## ${OTHER} 1.0.0\n\nNo changelog entry was found for this version.\n`,
    );
  });

  it("names the release by its date, and a later run of the same day by its number", () => {
    expect(releaseTag("2026-11-20", [])).toBe("release-2026-11-20");
    expect(releaseTag("2026-11-20", ["release-2026-11-20", "release-2026-11-20.2"])).toBe("release-2026-11-20.3");
  });
});
