/**
 * Calls each listener with a value. A listener that throws does not stop the others; its error goes to `report`.
 *
 * @param listeners - The listeners, which may remove themselves while they run.
 * @param value - The value to give them.
 * @param report - Receives the error of a listener.
 */
export function notifyListeners<T>(
  listeners: ReadonlySet<(value: T) => void>,
  value: T,
  report: (error: unknown) => void,
): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error) {
      report(error);
    }
  }
}
