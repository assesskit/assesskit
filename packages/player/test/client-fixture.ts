import type { CandidateView } from "@assesskit/runtime/delivery/wire";
import type { SessionClient } from "../src/protocol/index.js";

/** A test's own views, which a mount follows as it follows any session client. */
export interface FedViews {
  /** Wraps the client that the mount follows, so that the views shown also reach it. */
  wrap(client: SessionClient): SessionClient;
  /** Gives a view to the mounts that follow the wrapped client, as a host's own `SessionClient` does. */
  show(view: CandidateView): void;
}

/** Returns the means to show a mount views of a test's own, through the client it follows. */
export function feedViews(): FedViews {
  const listeners = new Set<(view: CandidateView) => void>();
  return {
    wrap: (client) =>
      Object.create(client, {
        subscribe: {
          value: (listener: (view: CandidateView) => void) => {
            listeners.add(listener);
            const stop = client.subscribe(listener);
            return () => {
              listeners.delete(listener);
              stop();
            };
          },
        },
      }),
    show: (view) => {
      for (const listener of listeners) listener(view);
    },
  };
}
