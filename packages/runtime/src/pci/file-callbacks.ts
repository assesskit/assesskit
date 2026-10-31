/** Reads the files of values for `encodePciValue`. The host stores the bytes, and a value only refers to them. */
export interface PciFileLoader {
  /**
   * Returns the bytes of the stored file that `reference` names, as base64.
   *
   * @param reference - The reference that the file value holds.
   */
  readonly load: (reference: string) => string;
}

/** Stores the files of values for `decodePciValue`. The host keeps the bytes, and a value only refers to them. */
export interface PciFileStore {
  /**
   * Stores a file given as base64 and returns its reference.
   *
   * @param data - The bytes as base64.
   * @param mimeType - The MIME type of the file.
   * @param fileName - The name of the file, when the PCI gives one.
   */
  readonly store: (data: string, mimeType: string, fileName?: string) => string;
}
