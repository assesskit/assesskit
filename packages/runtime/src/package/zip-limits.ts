import { limitsSchema } from "../checks-internal.js";

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
   * The most bytes one file may have when uncompressed. Reading a deflated file of this size keeps up to three and a half
   * times its bytes in memory while it inflates.
   *
   * @defaultValue `67108864` (64 MiB)
   */
  readonly maxEntryBytes: number;
  /**
   * The most bytes all files together may have when uncompressed. `readPackageFile` also refuses a ZIP file of more bytes than
   * this before it reads it.
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
 * largest ratio of 27.9. `maxEntries` is about 1,000 times its entries, `maxEntryBytes` about 13 times its largest entry,
 * `maxTotalBytes` about 200 times its size and `maxRatio` about 9 times its ratio.
 */
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 100_000,
  maxEntryBytes: 67_108_864,
  maxTotalBytes: 2_147_483_648,
  maxRatio: 250,
};

/** The size below which the ratio of an entry is not checked. */
export const RATIO_GRACE_BYTES = 102_400;

/** The schema of the limits that a caller sets, which reads them as all of {@link ZipLimits}: a limit left out has its default. */
export const zipLimitsSchema = limitsSchema(DEFAULT_ZIP_LIMITS);
