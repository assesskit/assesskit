import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** One schema of `SCHEMA_FILES` in `packages/olah/src/node/schema-files.json`. */
export interface SchemaFile {
  /** Where the 1EdTech or W3C schema is published. */
  readonly url: string;
  /** The file name in the cache directory. */
  readonly file: string;
  /** The SHA-256 of the file as lowercase hexadecimal. */
  readonly sha256: string;
}

const LIST_PATH = "packages/olah/src/node/schema-files.json";
const CACHE_PATH = ".cache/schemas";
/** Downloads that run at once; the schemas total about 190 MB. */
const CONCURRENCY = 4;

/** Returns the SHA-256 of some bytes as lowercase hexadecimal. */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Reads the list of schemas that the package pins. */
export function loadList(root: string): SchemaFile[] {
  return JSON.parse(readFileSync(join(root, LIST_PATH), "utf8"));
}

/** Returns the directory the schemas are downloaded to. */
export function schemaDirectory(root: string): string {
  return join(root, CACHE_PATH);
}

/**
 * Returns the schema directory for tests that validate against the schemas.
 *
 * @throws `Error` when the schemas are not downloaded.
 */
export function requireSchemas(root: string): string {
  const directory = schemaDirectory(root);
  if (!existsSync(directory))
    throw new Error(`The schemas are not downloaded to ${directory}: run pnpm schemas first.`);
  return directory;
}

/** Returns whether the file of a schema is in the directory with its pinned hash. */
export function isCurrent(directory: string, schema: SchemaFile): boolean {
  const path = join(directory, schema.file);
  return existsSync(path) && sha256(readFileSync(path)) === schema.sha256;
}

/** Downloads a schema. */
async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Downloading ${url} failed: HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Runs a function on every item, a few at a time, and returns the results in order. */
async function mapConcurrently<T, TResult>(
  items: readonly T[],
  run: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) results[index] = await run(items[index] as T);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

/**
 * Downloads the schemas that are not in the directory with their pinned hashes.
 *
 * @returns The files it downloaded.
 * @throws `Error` when a download differs from its pinned hash; that file is not written.
 */
export async function fetchSchemas(root: string): Promise<string[]> {
  const directory = schemaDirectory(root);
  mkdirSync(directory, { recursive: true });
  const missing = loadList(root).filter((schema) => !isCurrent(directory, schema));
  await mapConcurrently(missing, async (schema) => {
    const bytes = await download(schema.url);
    if (sha256(bytes) !== schema.sha256) {
      throw new Error(
        `${schema.url} has another SHA-256 than the pinned ${schema.sha256}: run pnpm schemas:pin if it changed.`,
      );
    }
    writeFileSync(join(directory, schema.file), bytes);
  });
  return missing.map((schema) => schema.file);
}

/** Downloads every schema and writes its SHA-256 into the list. */
export async function pinSchemas(root: string): Promise<void> {
  const list = loadList(root);
  const hashes = await mapConcurrently(list, async (schema) => sha256(await download(schema.url)));
  const pinned = list.map((schema, index) => ({ ...schema, sha256: hashes[index] }));
  writeFileSync(join(root, LIST_PATH), `${JSON.stringify(pinned, null, 2)}\n`);
  console.log(`Pinned ${pinned.length} schemas.`);
}

async function main(args: readonly string[]): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const [command] = args;
  if (command === "fetch") {
    const downloaded = await fetchSchemas(root);
    console.log(downloaded.length === 0 ? "The schemas are current." : `Downloaded ${downloaded.length} schemas.`);
  } else if (command === "pin") {
    await pinSchemas(root);
  } else {
    throw new Error("Usage: node scripts/schemas.ts fetch | pin");
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
