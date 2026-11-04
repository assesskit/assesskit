import { closeSync, openSync, readSync } from "node:fs";
import { AssesskitError, DataError } from "../errors.js";
import type { ByteSource } from "../package/internal.js";
import { createReadError } from "../xml/internal.js";

/** The most bytes asked of one `readSync`, which refuses a length of 2 GiB or more. */
const READ_STEP_BYTES = 1_073_741_824;

/**
 * The source of a ZIP file that is read by ranges: the reader of archives asks for its end, its central directory and the bytes of
 * an entry, and nothing else. The file is opened for each read and closed after it, so that a package keeps no handle open.
 *
 * @remarks
 * A file that changes after it was opened is read as it is then: the local header, the size and the CRC-32 of an entry are checked
 * against the central directory that was read, so the bytes of an entry never exceed the size it declared.
 *
 * @param path - The ZIP file.
 * @param length - The size of the file in bytes, from the `stat` that opened the package.
 */
export function fileSource(path: string, length: number): ByteSource {
  const read = (offset: number, size: number): Uint8Array => {
    const bytes = new Uint8Array(size);
    try {
      const file = openSync(path, "r");
      try {
        for (let done = 0; done < size; ) {
          const count = readSync(file, bytes, done, Math.min(size - done, READ_STEP_BYTES), offset + done);
          if (count === 0) throw createReadError("assesskit/package/zip", "The data of the archive is cut off.");
          done += count;
        }
      } finally {
        closeSync(file);
      }
    } catch (error) {
      if (error instanceof AssesskitError) throw error;
      throw new DataError(
        `The package ${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    return bytes;
  };
  return { length, read, copy: read };
}
