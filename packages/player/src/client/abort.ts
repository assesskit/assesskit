/**
 * Ends the wait for a promise when a signal aborts. The promise itself goes on.
 *
 * @param promise - What the caller waits for.
 * @param signal - The signal of the caller, if it passed one.
 * @returns The promise, or a promise that rejects with `signal.reason` as soon as the signal aborts.
 */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
