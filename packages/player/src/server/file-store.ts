import type { FileValue } from "@assesskit/runtime/values";
import type { CallOptions } from "../protocol/index.js";

/** The host's storage of the files that candidates upload, record or draw: file values are references to it. */
export interface FileStore {
  /**
   * Stores the bytes of a file.
   *
   * @param bytes - The content.
   * @param mimeType - The media type.
   * @param fileName - The name that the candidate's file had.
   * @param options - Its `signal` ends the wait of the call that asked.
   * @returns The file value, whose reference names the stored file.
   */
  put(bytes: Uint8Array, mimeType: string, fileName?: string, options?: CallOptions): Promise<FileValue>;
  /**
   * Returns the bytes of a stored file.
   *
   * @param file - The file value.
   * @param options - Its `signal` ends the wait of the call that asked.
   * @returns The bytes, or `undefined` when there are none.
   */
  read(file: FileValue, options?: CallOptions): Promise<Uint8Array | undefined>;
}
