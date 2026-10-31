import { vi } from "vitest";

/**
 * The longest a wait lasts, in milliseconds. A test of the browsers has 15 seconds, so a wait that gives up sooner
 * reports the condition that failed and not the limit of the test.
 */
const WAIT_LIMIT = 10_000;

/**
 * Calls a function until it stops throwing and returns what it returns. It is `vi.waitFor` with a limit that a busy host
 * does not reach: the default of one second is shorter than a loaded browser needs to render a page or to answer a
 * command, and it fails a test that waits for a state that is certain to come. The wait ends as soon as the condition
 * holds, so the limit costs nothing when the host is quiet.
 */
export function waitFor<T>(callback: () => T | Promise<T>, options: { readonly timeout?: number } = {}): Promise<T> {
  return vi.waitFor(callback, { timeout: WAIT_LIMIT, ...options });
}
