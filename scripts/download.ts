// Every download of the repository goes through one implementation, the one of `assesskit schemas fetch`, which aborts a
// download that brings no byte for 30 s and tries one that fails or stalls three times in all. It lives in the runtime
// package, which ships the command, and Node runs it as TypeScript from here by its file name, as `schemas.ts` does. A script
// reports each retry on the standard error, so that a log shows why a run is slow.
import { writeFile } from "node:fs/promises";
import { type DownloadOptions, downloadBytes as downloadBytesOnce } from "../packages/runtime/src/cli/fetch-schemas.ts";

const withLog = (options: DownloadOptions): DownloadOptions => ({ onRetry: console.error, ...options });

/** Downloads an address into memory, with the stall timeout and the retries, and returns its bytes. */
export function downloadBytes(url: string, options: DownloadOptions = {}): Promise<Uint8Array> {
  return downloadBytesOnce(url, withLog(options));
}

/** Downloads an address as UTF-8 text, with the stall timeout and the retries. */
export async function downloadText(url: string, options: DownloadOptions = {}): Promise<string> {
  return new TextDecoder().decode(await downloadBytes(url, options));
}

/** Downloads an address to a file, with the stall timeout and the retries; the file is written once all of it arrived. */
export async function downloadFile(url: string, file: string, options: DownloadOptions = {}): Promise<void> {
  await writeFile(file, await downloadBytes(url, options));
}
