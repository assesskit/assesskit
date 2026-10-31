/**
 * The longest delay in milliseconds that `setTimeout` takes, 2^31 - 1; a longer one fires at once.
 *
 * @see {@link https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers | HTML Standard, timers}
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;
