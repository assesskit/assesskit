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

/** A GitHub repository whose files tests read, pinned to a commit and to the SHA-256 of every file. */
export interface CorpusSource {
  /** The repository, such as `1EdTech/qti-examples`. */
  readonly repository: string;
  /** The commit the files come from. */
  readonly commit: string;
  /** The directories (with a trailing slash) and files that `pin` collects. */
  readonly include: readonly string[];
  /** The SHA-256 of every file by its path in the repository. */
  readonly files: Readonly<Record<string, string>>;
}

/** The pinned corpus of `conformance/corpus.lock.json`. */
export interface CorpusLock {
  /** Where the sources are downloaded to, relative to the repository root. */
  readonly directory: string;
  /** The sources by name; each is downloaded to a directory of its name. */
  readonly sources: Readonly<Record<string, CorpusSource>>;
}

const LOCK_PATH = "conformance/corpus.lock.json";
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

/** Returns the SHA-256 of each selected file of a directory. */
export function hashFiles(directory: string, include: readonly string[]): Record<string, string> {
  return Object.fromEntries(selectFiles(directory, include).map((path) => [path, sha256(join(directory, path))]));
}

/** Returns what differs between the files of a directory and the hashes of a source: missing, changed and unexpected files. */
export function differences(directory: string, source: CorpusSource): string[] {
  const found = hashFiles(directory, source.include);
  const problems: string[] = [];
  for (const [path, hash] of Object.entries(source.files)) {
    if (found[path] === undefined) problems.push(`${path} is missing.`);
    else if (found[path] !== hash) problems.push(`${path} has another SHA-256 than the pinned ${hash}.`);
  }
  for (const path of Object.keys(found)) if (source.files[path] === undefined) problems.push(`${path} is not pinned.`);
  return problems;
}

/** Downloads the archive of a commit to a file and extracts it without its top directory. */
async function downloadCommit(repository: string, commit: string, directory: string): Promise<void> {
  const response = await fetch(`https://codeload.github.com/${repository}/tar.gz/${commit}`);
  if (!(response.ok && response.body))
    throw new Error(`Downloading ${repository}@${commit} failed: HTTP ${response.status}.`);
  const archive = join(directory, "archive.tar.gz");
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  const extracted = join(directory, "tree");
  mkdirSync(extracted);
  execFileSync("tar", ["-xzf", archive, "-C", extracted, "--strip-components=1"]);
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
 * Downloads a source into `<corpus>/<name>` unless the files there already match the pinned hashes.
 *
 * @throws `Error` when the download differs from the pinned hashes; nothing is written then.
 */
export async function fetchSource(
  corpus: string,
  name: string,
  source: CorpusSource,
): Promise<"downloaded" | "current"> {
  const target = join(corpus, name);
  if (existsSync(target) && differences(target, source).length === 0) return "current";
  await withScratch(corpus, async (scratch) => {
    await downloadCommit(source.repository, source.commit, scratch);
    const tree = join(scratch, "tree");
    const problems = differences(tree, source);
    if (problems.length > 0)
      throw new Error(`${name} does not match its pins:\n- ${problems.slice(0, 20).join("\n- ")}`);
    rmSync(target, { recursive: true, force: true });
    for (const path of Object.keys(source.files)) {
      const destination = resolve(target, path);
      if (relative(target, destination).startsWith("..")) throw new Error(`${path} leaves the corpus directory.`);
      mkdirSync(dirname(destination), { recursive: true });
      await copyFile(join(tree, path), destination);
    }
  });
  return "downloaded";
}

/** Reads the lock. */
export function loadLock(root: string): CorpusLock {
  return JSON.parse(readFileSync(join(root, LOCK_PATH), "utf8"));
}

/** Returns the directory the corpus is downloaded to; each source is a directory of its name below it. */
export function corpusDirectory(root: string): string {
  return join(root, loadLock(root).directory);
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

/** Pins a source to a commit, or to the head of its default branch, and writes the lock with the hashes of its files. */
async function pinSource(root: string, name: string, ref: string | undefined): Promise<void> {
  const lock = loadLock(root);
  const source = lock.sources[name];
  if (!source) throw new Error(`The lock has no source ${name}; add it with its repository and include list first.`);
  const commit = await resolveCommit(source.repository, ref ?? "HEAD");
  const files = await withScratch(join(root, lock.directory), async (scratch) => {
    await downloadCommit(source.repository, commit, scratch);
    return hashFiles(join(scratch, "tree"), source.include);
  });
  const pinned: CorpusLock = { ...lock, sources: { ...lock.sources, [name]: { ...source, commit, files } } };
  writeFileSync(join(root, LOCK_PATH), `${JSON.stringify(pinned, null, 2)}\n`);
  console.log(`Pinned ${name} to ${commit}: ${Object.keys(files).length} files.`);
}

async function main(args: readonly string[]): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const [command, ...names] = args;
  const lock = loadLock(root);
  if (command === "fetch") {
    for (const name of names.length > 0 ? names : Object.keys(lock.sources)) {
      const source = lock.sources[name];
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
