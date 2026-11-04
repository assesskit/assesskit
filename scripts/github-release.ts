import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PACKAGES } from "./family.ts";
import { folderOf } from "./identity.ts";

/**
 * The step of the Release workflow after `changeset publish`: one GitHub release for the run, named by its date, that lists the
 * versions published and their changelog entries, which Zenodo archives. `changeset publish` tags each version it publishes at
 * HEAD (`@scope/name@1.0.0`); a run that published nothing creates no release. `--dry-run` prints the command and the notes and
 * creates nothing.
 */

/** A version that the run published. */
export interface Published {
  readonly name: string;
  readonly version: string;
}

/** The versions of the family's packages among the tags at HEAD, in the order of the family's table. */
export function readPublished(tags: readonly string[]): Published[] {
  return PACKAGES.flatMap(({ name }) =>
    tags.flatMap((tag) => (tag.startsWith(`${name}@`) ? [{ name, version: tag.slice(name.length + 1) }] : [])),
  );
}

/** The entry of a version in a changelog that Changesets writes: the text below `## <version>` up to the next version. */
export function changelogEntry(changelog: string, version: string): string | undefined {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

/** The notes of the release: a section for each version published, with its changelog entry. */
export function releaseNotes(published: readonly Published[], changelogOf: (name: string) => string): string {
  return published
    .map(({ name, version }) => {
      const entry = changelogEntry(changelogOf(name), version) ?? "No changelog entry was found for this version.";
      return `## ${name} ${version}\n\n${entry.replace(/^### /gm, "#### ")}\n`;
    })
    .join("\n");
}

/** The tag of the release of a day: `release-<date>`, then `release-<date>.2` and on for later runs of the same day. */
export function releaseTag(date: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  let tag = `release-${date}`;
  for (let run = 2; taken.has(tag); run += 1) tag = `release-${date}.${run}`;
  return tag;
}

const git = (root: string, ...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" });

/** Creates the release of the run, or prints it with `--dry-run`, and returns the exit code. */
function main(dryRun: boolean): number {
  const root = resolve(import.meta.dirname, "..");
  const published = readPublished(git(root, "tag", "--points-at", "HEAD").split("\n").filter(Boolean));
  if (published.length === 0) {
    console.log("No package was published, so there is no release.");
    return 0;
  }
  const date = new Date().toISOString().slice(0, 10);
  const existing = git(root, "ls-remote", "--tags", "origin", `refs/tags/release-${date}*`)
    .split("\n")
    .flatMap((line) => /refs\/tags\/(\S+)$/.exec(line)?.[1] ?? []);
  const tag = releaseTag(date, existing);
  const notes = releaseNotes(published, (name) =>
    readFileSync(join(root, "packages", folderOf(name), "CHANGELOG.md"), "utf8"),
  );
  const file = join(mkdtempSync(join(tmpdir(), "release-")), "notes.md");
  writeFileSync(file, notes);
  const args = [
    "release",
    "create",
    tag,
    "--target",
    git(root, "rev-parse", "HEAD").trim(),
    "--title",
    date,
    "--notes-file",
    file,
  ];
  if (dryRun) {
    console.log(`gh ${args.join(" ")}\n\n${notes}`);
    return 0;
  }
  execFileSync("gh", args, { cwd: root, stdio: "inherit" });
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.includes("--dry-run"));
