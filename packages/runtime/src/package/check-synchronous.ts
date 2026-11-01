import { isRecord } from "../checks.js";
import { DataError } from "../errors.js";

/**
 * Checks that the value a callback returned is not a promise: the runtime calls its callbacks and uses what they return at
 * once. Any thenable is refused.
 *
 * @param label - Names the callback in the error message, such as `The resolver items`.
 * @throws `DataError` when it is a promise.
 */
export function checkSynchronous(value: unknown, label: string): void {
  if (isRecord(value) && typeof value.then === "function") {
    throw new DataError(`${label} must return its value synchronously, found a promise.`);
  }
}
