import type { FileValue } from "@assesskit/runtime/values";

/** The host's storage of the files that candidates upload, record or draw: file values are references to it. */
export interface FileStore {
  /**
   * Stores the bytes of a file.
   *
   * @param bytes - The content.
   * @param mimeType - The media type.
   * @param fileName - The name that the candidate's file had.
   * @returns The file value, whose reference names the stored file.
   */
  put(bytes: Uint8Array, mimeType: string, fileName?: string): Promise<FileValue>;
  /**
   * Returns the bytes of a stored file.
   *
   * @param file - The file value.
   * @returns The bytes, or `undefined` when there are none.
   */
  read(file: FileValue): Promise<Uint8Array | undefined>;
}
