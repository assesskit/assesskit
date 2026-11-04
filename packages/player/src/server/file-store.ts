import type { CallOptions } from "@assesskit/runtime/checks";
import type { FileValue } from "@assesskit/runtime/values";

/** The host's storage of the files that candidates upload, record or draw: file values are references to it. */
export interface FileStore {
  /**
   * Stores the bytes of a file.
   *
   * @param bytes - The content.
   * @param mimeType - The media type.
   * @param options - Its `fileName` is the name that the candidate's file had; its `signal` ends the wait of the call that
   * asked.
   * @returns The file value, whose reference names the stored file.
   */
  put(bytes: Uint8Array, mimeType: string, options?: CallOptions & { readonly fileName?: string }): Promise<FileValue>;
  /**
   * Returns the bytes of a stored file.
   *
   * @param file - The file value.
   * @param options - Its `signal` ends the wait of the call that asked.
   * @returns The bytes, or `undefined` when there are none.
   */
  read(file: FileValue, options?: CallOptions): Promise<Uint8Array | undefined>;
}
