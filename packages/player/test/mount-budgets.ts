/** How many times slower than the machine of the run the CPU is while the mount times are taken, as a mid-range phone is. */
export const CPU_SLOWDOWN = 4;

/** How many times each mount is timed: the fastest time counts, since a slower one is the machine's other work. */
export const SAMPLES = 5;

/** How many items of a page a lesson mounts alone. */
export const LESSON_ITEMS = 10;

/**
 * The most that the fastest sample of a mount may take, in milliseconds, with the CPU slowed by {@link CPU_SLOWDOWN}: five
 * times the fastest sample measured (5 and 16 ms), rounded up to one significant digit, as docs/player/size.md explains.
 */
export const MOUNT_BUDGETS = {
  /** `mountDelivery` over a test: until the first item is on the page. */
  delivery: 30,
  /** {@link LESSON_ITEMS} calls of `mountItem` on one page: until every item is on the page. */
  lesson: 80,
} as const;
