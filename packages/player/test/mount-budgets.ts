/** How many times slower than the machine of the run the CPU is while the mount times are taken, as a mid-range phone is. */
export const CPU_SLOWDOWN = 4;

/** How many times each mount is timed: the fastest time counts, since a slower one is the machine's other work. */
export const SAMPLES = 5;

/** How many items of a page a lesson mounts alone. */
export const LESSON_ITEMS = 10;

/**
 * The most that the fastest sample of a mount may take, in milliseconds, with the CPU slowed by {@link CPU_SLOWDOWN}: about
 * four times what was measured (6 and 17 ms), so that the noise of a machine passes and a change that makes a mount several
 * times slower does not.
 */
export const MOUNT_BUDGETS = {
  /** `mountDelivery` over a test: until the first item is on the page. */
  delivery: 25,
  /** {@link LESSON_ITEMS} calls of `mountItem` on one page: until every item is on the page. */
  lesson: 60,
} as const;
