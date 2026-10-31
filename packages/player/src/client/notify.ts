/**
 * Calls each listener with a value. A listener that throws does not stop the others; its error goes to `reportError`.
 *
 * @param listeners - The listeners, which may remove themselves while they run.
 * @param value - The value to give them.
 */
export function notifyListeners<T>(listeners: ReadonlySet<(value: T) => void>, value: T): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error) {
      reportError(error);
    }
  }
}
