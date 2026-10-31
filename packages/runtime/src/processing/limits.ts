/** The limits on what processing builds. */
export interface ProcessingLimits {
  /**
   * The most values that a container built by an expression may hold, such as the result of `qti-repeat`.
   *
   * @defaultValue `10000`
   */
  readonly maxContainerSize: number;
}

/**
 * The default limits: `maxContainerSize` is about 1,000 times the largest container of the 1EdTech QTI 3.0 examples, a
 * mapping of 9 entries.
 */
export const DEFAULT_PROCESSING_LIMITS: ProcessingLimits = { maxContainerSize: 10_000 };
