/** How many times slower than the machine of the run the CPU is while the mount times are taken, as a mid-range phone is. */
export const CPU_SLOWDOWN = 4;

/** How many times each mount is timed: the fastest time counts, since a slower one is the machine's other work. */
export const SAMPLES = 5;

/** How many items of a page a lesson mounts alone. */
export const LESSON_ITEMS = 10;

/** How many words the passage has over which the highlighter is opened: about four pages of text. */
export const HIGHLIGHT_WORDS = 2_000;

/**
 * The most that the fastest sample of a mount may take, in milliseconds, with the CPU slowed by {@link CPU_SLOWDOWN}: five
 * times the fastest sample that the CI runner took, rounded up to one significant digit, as docs/player/size.md explains.
 * The samples are the fastest of five runs of the build on main on 2026-11-05: 20.4, 30.1 and 33.5 ms, for the three rows in
 * order.
 */
export const MOUNT_BUDGETS = {
  /** `mountDelivery` over a test: until the first item is on the page. */
  delivery: 200,
  /** {@link LESSON_ITEMS} calls of `mountItem` on one page: until every item is on the page. */
  lesson: 200,
  /** `update` of the tools that turns the highlighter on over {@link HIGHLIGHT_WORDS} words: the words found, measured and drawn. */
  highlighter: 200,
} as const;

/**
 * The most that the fastest sample of the lesson page from its documents may take, as a multiple of the fastest sample of
 * the same page in the Amp-up player (`qti3-item-player`), with the CPU slowed by {@link CPU_SLOWDOWN}: 1.5 times the
 * highest of the ratios that the CI runner gave in five runs of the build on 2026-11-05, 0.80 to 0.98 with a median of 0.89,
 * rounded up to the next half (docs/player/size.md).
 */
export const AMP_UP_RATIO = 1.5;
