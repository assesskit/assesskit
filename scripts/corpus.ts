import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { copyFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** A GitHub repository whose files tests read, pinned to a commit and to the SHA-256 of the archive of that commit. */
export interface CorpusSource {
  /** The repository, such as `1EdTech/qti-examples`. */
  readonly repository: string;
  /** The commit the files come from. */
  readonly commit: string;
  /** The SHA-256 of the `tar.gz` archive that GitHub serves for the commit. */
  readonly sha256: string;
  /** The directories (with a trailing slash) and files of the repository that tests read. */
  readonly include: readonly string[];
}

/** The pinned corpus of `scripts/corpus.lock.json`: the sources by name, each downloaded to a directory of its name. */
export type CorpusLock = Readonly<Record<string, CorpusSource>>;

const LOCK_PATH = "scripts/corpus.lock.json";
/** Where the sources are downloaded to, relative to the repository root. */
const CORPUS_PATH = ".cache/corpus";
/** The file in the directory of a source that holds the SHA-256 of the archive it was extracted from. */
const STAMP = ".archive-sha256";
/** Files that editors and operating systems add to repositories. */
const IGNORED = new Set([".DS_Store"]);

/** Returns the SHA-256 of a file as lowercase hexadecimal. */
export function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Returns the files below a directory that the include list selects, as sorted paths relative to it. */
export function selectFiles(directory: string, include: readonly string[]): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8", withFileTypes: true })
    .filter((entry) => entry.isFile() && !IGNORED.has(entry.name))
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .filter((path) => include.some((prefix) => path.startsWith(prefix)))
    .sort();
}

/** Downloads the archive of a commit to `<directory>/archive.tar.gz` and returns its SHA-256. */
async function downloadArchive(repository: string, commit: string, directory: string): Promise<string> {
  const response = await fetch(`https://codeload.github.com/${repository}/tar.gz/${commit}`);
  if (!(response.ok && response.body))
    throw new Error(`Downloading ${repository}@${commit} failed: HTTP ${response.status}.`);
  const archive = join(directory, "archive.tar.gz");
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  return sha256(archive);
}

/** Extracts the archive that `downloadArchive` wrote, without its top directory, and returns the directory. */
function extractArchive(directory: string): string {
  const tree = join(directory, "tree");
  mkdirSync(tree);
  execFileSync("tar", ["-xzf", join(directory, "archive.tar.gz"), "-C", tree, "--strip-components=1"]);
  return tree;
}

/** Returns the commit that a branch, tag or commit of a repository points to. */
async function resolveCommit(repository: string, ref: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${repository}/commits/${ref}`, {
    headers: { accept: "application/vnd.github.sha" },
  });
  if (!response.ok) throw new Error(`Resolving ${repository}@${ref} failed: HTTP ${response.status}.`);
  return (await response.text()).trim();
}

/** Runs a function with a temporary directory below the corpus directory, which it removes afterwards. */
async function withScratch<T>(parent: string, run: (directory: string) => Promise<T>): Promise<T> {
  mkdirSync(parent, { recursive: true });
  const scratch = mkdtempSync(join(parent, ".download-"));
  try {
    return await run(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Downloads a source into `<corpus>/<name>` unless it was extracted from the pinned archive already.
 *
 * @throws `Error` when the archive differs from its pinned SHA-256; nothing is written then.
 */
export async function fetchSource(
  corpus: string,
  name: string,
  source: CorpusSource,
): Promise<"downloaded" | "current"> {
  const target = join(corpus, name);
  const stamp = join(target, STAMP);
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === source.sha256) return "current";
  await withScratch(corpus, async (scratch) => {
    const found = await downloadArchive(source.repository, source.commit, scratch);
    if (found !== source.sha256)
      throw new Error(`The archive of ${name} has the SHA-256 ${found}, and the lock pins ${source.sha256}.`);
    const tree = extractArchive(scratch);
    rmSync(target, { recursive: true, force: true });
    for (const path of selectFiles(tree, source.include)) {
      const destination = resolve(target, path);
      if (relative(target, destination).startsWith("..")) throw new Error(`${path} leaves the corpus directory.`);
      mkdirSync(dirname(destination), { recursive: true });
      await copyFile(join(tree, path), destination);
    }
    writeFileSync(stamp, source.sha256);
  });
  return "downloaded";
}

/** Reads the lock. */
export function loadLock(root: string): CorpusLock {
  return JSON.parse(readFileSync(join(root, LOCK_PATH), "utf8"));
}

/** Returns the directory the corpus is downloaded to; each source is a directory of its name below it. */
export function corpusDirectory(root: string): string {
  return join(root, CORPUS_PATH);
}

/**
 * Returns the corpus directory for tests that read the corpus.
 *
 * @throws `Error` when the corpus is not downloaded.
 */
export function requireCorpus(root: string): string {
  const directory = corpusDirectory(root);
  if (!existsSync(directory)) throw new Error(`The corpus is not downloaded to ${directory}: run pnpm corpus first.`);
  return directory;
}

/** Pins a source to a commit, or to the head of its default branch, and writes the lock with the hash of its archive. */
async function pinSource(root: string, name: string, ref: string | undefined): Promise<void> {
  const lock = loadLock(root);
  const source = lock[name];
  if (!source) throw new Error(`The lock has no source ${name}; add it with its repository and include list first.`);
  const commit = await resolveCommit(source.repository, ref ?? "HEAD");
  const archive = await withScratch(corpusDirectory(root), (scratch) =>
    downloadArchive(source.repository, commit, scratch),
  );
  writeFileSync(
    join(root, LOCK_PATH),
    `${JSON.stringify({ ...lock, [name]: { ...source, commit, sha256: archive } }, null, 2)}\n`,
  );
  console.log(`Pinned ${name} to ${commit}, archive ${archive}.`);
}

async function main(args: readonly string[]): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const [command, ...names] = args;
  const lock = loadLock(root);
  if (command === "fetch") {
    for (const name of names.length > 0 ? names : Object.keys(lock)) {
      const source = lock[name];
      if (!source) throw new Error(`The lock has no source ${name}.`);
      console.log(`${name}: ${await fetchSource(corpusDirectory(root), name, source)}`);
    }
  } else if (command === "pin" && names[0]) {
    await pinSource(root, names[0], names[1]);
  } else {
    throw new Error("Usage: node scripts/corpus.ts fetch [source...] | pin <source> [commit]");
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
