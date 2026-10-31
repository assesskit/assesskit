import { checkPositiveInteger, checkRecord } from "../checks.js";

/** The limits that keep an archive or a directory from using more memory or time than a caller allows. */
export interface ZipLimits {
  /**
   * The most entries an archive may have, directories included, or the most files and directories a package directory
   * may have.
   *
   * @defaultValue `100000`
   */
  readonly maxEntries: number;
  /**
   * The most bytes one file may have when uncompressed.
   *
   * @defaultValue `536870912` (512 MiB)
   */
  readonly maxEntryBytes: number;
  /**
   * The most bytes all files together may have when uncompressed.
   *
   * @defaultValue `2147483648` (2 GiB)
   */
  readonly maxTotalBytes: number;
  /**
   * The most that an entry's uncompressed size may exceed its compressed size, as a ratio. Entries of up to 102,400
   * bytes (the grace of Apache POI's `ZipSecureFile`) are exempt, because a small file of repeated bytes compresses to
   * very little.
   *
   * @defaultValue `250`
   */
  readonly maxRatio: number;
}

/**
 * The default limits.
 *
 * @remarks
 * The largest package of the 1EdTech QTI 3.0 examples has 99 entries, an entry of 5.0 MiB, 11.0 MB uncompressed and a
 * largest ratio of 27.9. `maxEntries` is about 1,000 times its entries, `maxEntryBytes` about 100 times its largest entry,
 * `maxTotalBytes` about 200 times its size and `maxRatio` about 9 times its ratio.
 */
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 100_000,
  maxEntryBytes: 536_870_912,
  maxTotalBytes: 2_147_483_648,
  maxRatio: 250,
};

/** The size below which the ratio of an entry is not checked. */
export const RATIO_GRACE_BYTES = 102_400;

/**
 * Returns the default limits with the given ones in place of theirs.
 *
 * @param limits - The limits to change; a limit left out keeps its default.
 * @returns All the limits.
 * @throws `DataError` when `limits` is not an object or a limit is not a positive integer.
 */
export function resolveZipLimits(limits: Partial<ZipLimits>): ZipLimits {
  checkRecord(limits, "The option limits must be an object");
  const {
    maxEntries = DEFAULT_ZIP_LIMITS.maxEntries,
    maxEntryBytes = DEFAULT_ZIP_LIMITS.maxEntryBytes,
    maxTotalBytes = DEFAULT_ZIP_LIMITS.maxTotalBytes,
    maxRatio = DEFAULT_ZIP_LIMITS.maxRatio,
  } = limits;
  checkPositiveInteger(maxEntries, "The limit maxEntries");
  checkPositiveInteger(maxEntryBytes, "The limit maxEntryBytes");
  checkPositiveInteger(maxTotalBytes, "The limit maxTotalBytes");
  checkPositiveInteger(maxRatio, "The limit maxRatio");
  return { maxEntries, maxEntryBytes, maxTotalBytes, maxRatio };
}
