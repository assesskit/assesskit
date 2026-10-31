import type { CandidateView } from "@assesskit/runtime/delivery";

/**
 * Calls each listener with a view. A listener that throws does not stop the others; its error goes to `reportError`.
 *
 * @param listeners - The listeners, which may remove themselves while they run.
 * @param view - The view to give them.
 */
export function notifyListeners(listeners: ReadonlySet<(view: CandidateView) => void>, view: CandidateView): void {
  for (const listener of [...listeners]) {
    try {
      listener(view);
    } catch (error) {
      reportError(error);
    }
  }
}
