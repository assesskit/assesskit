// This file is also loaded by Node.js directly, through `scripts/schemas.ts`, so that `pnpm schemas` and
// `assesskit schemas fetch` run one implementation. It therefore imports only `node:*` modules and types.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SchemaFile } from "../node/index.js";

export type { SchemaFile };

/** Downloads that run at once; the schemas total about 140 MB. */
const CONCURRENCY = 4;

/** A schema that could not be downloaded, and why. */
interface SchemaFailure {
  /** The schema. */
  readonly schema: SchemaFile;
  /** A full sentence that names the address and says what went wrong. */
  readonly reason: string;
}

/** What {@link fetchSchemas} did. */
export interface FetchResult {
  /** The schemas that the directory lacked, or held with another hash, and that were downloaded, in the order of the list. */
  readonly downloaded: readonly SchemaFile[];
  /** The schemas that could not be downloaded or whose download had another hash; none of them was written. */
  readonly failures: readonly SchemaFailure[];
}

/**
 * Returns the SHA-256 of some bytes as lowercase hexadecimal.
 *
 * @param bytes - The bytes.
 * @returns The hash as lowercase hexadecimal.
 */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

/**
 * Downloads a file.
 *
 * @param url - The address.
 * @param fetchUrl - Downloads an address.
 * @returns The bytes of the response.
 * @throws `Error` when the request fails or the status is not a success.
 */
export async function download(url: string, fetchUrl: typeof fetch = fetch): Promise<Uint8Array> {
  const response = await fetchUrl(url);
  if (!response.ok) throw new Error(`Downloading ${url} failed: HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Runs a function on every item, a few at a time, and returns the results in order.
 *
 * @param items - The items.
 * @param run - The function to run on one item.
 * @returns The results, in the order of the items.
 */
export async function mapConcurrently<T, TResult>(
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

/** Returns whether the file of a schema is in the directory with its pinned hash. */
async function isCurrent(directory: string, schema: SchemaFile): Promise<boolean> {
  try {
    return sha256(await readFile(join(directory, schema.file))) === schema.sha256;
  } catch {
    // A file that is missing or cannot be read is downloaded again.
    return false;
  }
}

/** Downloads a schema and writes it when its hash is the pinned one; returns why it did not. */
async function fetchOne(directory: string, schema: SchemaFile, fetchUrl: typeof fetch): Promise<string | undefined> {
  try {
    const bytes = await download(schema.url, fetchUrl);
    const hash = sha256(bytes);
    if (hash !== schema.sha256) return `${schema.url} has the SHA-256 ${hash}, not the pinned ${schema.sha256}.`;
    await writeFile(join(directory, schema.file), bytes);
    return undefined;
  } catch (error) {
    return reasonOf(error);
  }
}

/**
 * Downloads the schemas that are not in the directory with their pinned hashes, and writes a file only when the bytes it
 * got have the pinned hash. A failed download does not stop the others, so that running it again completes the set.
 *
 * @param directory - The directory to write to; it is created when it is missing.
 * @param schemas - The schemas, which are the ones `SCHEMA_FILES` pins.
 * @param fetchUrl - Downloads an address.
 * @returns The schemas that were downloaded and those that failed.
 * @defaultValue the global `fetch`
 */
export async function fetchSchemas(
  directory: string,
  schemas: readonly SchemaFile[],
  fetchUrl: typeof fetch = fetch,
): Promise<FetchResult> {
  await mkdir(directory, { recursive: true });
  const current = await mapConcurrently(schemas, (schema) => isCurrent(directory, schema));
  const missing = schemas.filter((_, index) => !current[index]);
  const reasons = await mapConcurrently(missing, (schema) => fetchOne(directory, schema, fetchUrl));
  const downloaded: SchemaFile[] = [];
  const failures: SchemaFailure[] = [];
  missing.forEach((schema, index) => {
    const reason = reasons[index];
    if (reason === undefined) downloaded.push(schema);
    else failures.push({ schema, reason });
  });
  return { downloaded, failures };
}
