// This file is also loaded by Node.js directly, through `scripts/schemas.ts`, `scripts/corpus.ts`, `scripts/unicode.ts` and
// `scripts/conformance.ts`, so that `pnpm schemas`, `assesskit schemas fetch` and every other download of the repository run
// one implementation, with the same stall timeout and retries. It therefore imports only `node:*` modules and types.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SchemaFile } from "../node/index.js";

export type { SchemaFile };

/** Downloads that run at once; the schemas total about 140 MB. */
const CONCURRENCY = 4;

/** How long a download may go without a byte before it counts as stalled, in milliseconds. */
const STALL_MS = 30_000;
/** The tries of a download that fails or stalls, the first included. */
const DOWNLOAD_TRIES = 3;
/** The wait before a download is tried again, in milliseconds, doubled at each try. */
const RETRY_MS = 2000;

/** The statuses below 500 that a server answers when it may answer otherwise later: a timeout and too many requests. */
const PASSING_STATUSES: ReadonlySet<number> = new Set([408, 429]);

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

/** A download that the server answered with a status other than 2xx. */
export class DownloadStatusError extends Error {
  override name = "DownloadStatusError";
  readonly status: number;

  constructor(url: string, status: number) {
    super(`Downloading ${url} failed: HTTP ${status}.`);
    this.status = status;
  }
}

/** What a download may set. */
export interface DownloadOptions {
  /**
   * Downloads an address.
   *
   * @defaultValue the global `fetch`
   */
  readonly fetch?: typeof fetch;
  /**
   * The headers of the request.
   *
   * @defaultValue none
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * How long the server may take to answer the request, in milliseconds.
   *
   * @defaultValue 30,000
   */
  readonly answerMs?: number;
  /**
   * How long the body of the answer may go without a byte, in milliseconds.
   *
   * @defaultValue 30,000
   */
  readonly stallMs?: number;
  /**
   * The tries, the first included.
   *
   * @defaultValue 3
   */
  readonly tries?: number;
  /**
   * The wait before the second try, in milliseconds, doubled at each further one.
   *
   * @defaultValue 2,000
   */
  readonly retryMs?: number;
  /**
   * Called with a sentence when a failed download is about to be tried again, so that a log shows why a run is slow.
   *
   * @defaultValue none
   */
  readonly onRetry?: (message: string) => void;
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

/** Tells whether a failed download may succeed when it is tried again: a network failure, a stall, or a passing status. */
function isPassing(error: unknown): boolean {
  return !(error instanceof DownloadStatusError) || error.status >= 500 || PASSING_STATUSES.has(error.status);
}

/**
 * Runs a download again after a failure that may pass, up to `tries` times in all, waiting longer each time.
 *
 * @param run - Makes one try.
 * @param options - The tries, the wait and where to tell of a retry; the other options of a download are ignored.
 * @returns What the first successful try returned.
 * @throws The last failure after the tries, or at once a failure that will not change, such as the status 404.
 */
export async function withRetries<T>(run: () => Promise<T>, options: DownloadOptions = {}): Promise<T> {
  const { tries = DOWNLOAD_TRIES, retryMs = RETRY_MS, onRetry } = options;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= tries || !isPassing(error)) throw error;
      onRetry?.(`${reasonOf(error)} Trying again (${attempt + 1} of ${tries}).`);
      await new Promise((done) => setTimeout(done, retryMs * 2 ** (attempt - 1)));
    }
  }
}

/**
 * Requests an address and reads the body of its answer: it aborts when the server does not answer within `answerMs`, and when
 * the body brings no byte for `stallMs` once the answer began, so that a stalled connection fails fast instead of holding the
 * process. The clock of the body starts with the answer, so the time a request takes to reach the server never counts as a
 * stall. The body is read chunk by chunk from the stream of `fetch`.
 */
async function once(url: string, options: DownloadOptions): Promise<Uint8Array> {
  const { fetch: fetchUrl = fetch, headers, answerMs = STALL_MS, stallMs = STALL_MS } = options;
  const controller = new AbortController();
  const stall = () => controller.abort(new Error(`No byte of ${url} arrived for ${stallMs} ms.`));
  let timer = setTimeout(() => controller.abort(new Error(`${url} did not answer in ${answerMs} ms.`)), answerMs);
  try {
    const response = await fetchUrl(url, { signal: controller.signal, headers: { ...headers } });
    clearTimeout(timer);
    timer = setTimeout(stall, stallMs);
    if (!response.ok) throw new DownloadStatusError(url, response.status);
    const chunks: Uint8Array[] = [];
    const reader = response.body?.getReader();
    for (let chunk = await reader?.read(); chunk !== undefined && !chunk.done; chunk = await reader?.read()) {
      clearTimeout(timer);
      timer = setTimeout(stall, stallMs);
      chunks.push(chunk.value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads an address into memory, with the stall timeout and the retries.
 *
 * @param url - The address.
 * @param options - The function to download with, the timeouts and the tries.
 * @returns The bytes of the response.
 * @throws `Error` when the request fails or stalls on every try, or the status is not a success.
 */
export function downloadBytes(url: string, options: DownloadOptions = {}): Promise<Uint8Array> {
  return withRetries(() => once(url, options), options);
}

/** Downloads an address as UTF-8 text, with the stall timeout and the retries. */
export async function downloadText(url: string, options: DownloadOptions = {}): Promise<string> {
  return new TextDecoder().decode(await downloadBytes(url, options));
}

/** Downloads an address to a file, with the stall timeout and the retries; the file is written once all of it arrived. */
export async function downloadFile(url: string, file: string, options: DownloadOptions = {}): Promise<void> {
  await writeFile(file, await downloadBytes(url, options));
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
async function fetchOne(directory: string, schema: SchemaFile, options: DownloadOptions): Promise<string | undefined> {
  try {
    const bytes = await downloadBytes(schema.url, options);
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
 * @param options - The function to download with, the timeouts and the tries of each download.
 * @returns The schemas that were downloaded and those that failed.
 */
export async function fetchSchemas(
  directory: string,
  schemas: readonly SchemaFile[],
  options: DownloadOptions = {},
): Promise<FetchResult> {
  await mkdir(directory, { recursive: true });
  const current = await mapConcurrently(schemas, (schema) => isCurrent(directory, schema));
  const missing = schemas.filter((_, index) => !current[index]);
  const reasons = await mapConcurrently(missing, (schema) => fetchOne(directory, schema, options));
  const downloaded: SchemaFile[] = [];
  const failures: SchemaFailure[] = [];
  missing.forEach((schema, index) => {
    const reason = reasons[index];
    if (reason === undefined) downloaded.push(schema);
    else failures.push({ schema, reason });
  });
  return { downloaded, failures };
}
