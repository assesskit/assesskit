import type { CandidateAction, CandidateView, Refusal } from "@assesskit/runtime/delivery";
import type { ViewDocuments } from "./documents.js";

/** What a session client answers to an action: the view after it, and the engine's refusal when it did not apply. */
export interface DispatchResult {
  /** The view after the action; when it was refused, the view of the state as it was. */
  readonly view: CandidateView;
  /** Why the engine refused the action. Default: none, the action was applied. */
  readonly refusal?: Refusal;
}

/**
 * The one interface the player mounts against, whether the engine runs on a server (exam mode) or on the device
 * (practice): it never knows the mode (the player design §2.3).
 */
export interface SessionClient {
  /** The latest view. */
  readonly view: CandidateView;
  /** The documents the content of the latest view comes from, which the references in it resolve against. */
  readonly documents: ViewDocuments;
  /**
   * Returns the milliseconds since `view` was built or received, on the client's clock: the timers of a view count down
   * from the moment it was made.
   */
  age(): number;
  /** Turns the path of a file in the package into the URL to load it from: the base URL of the longest asset prefix of the latest view that holds the path, plus the path. */
  assets(path: string): string;
  /**
   * Sends an action and resolves with the view after it. A client may hold back `set-responses` actions, which it sends
   * together after a pause; the promise then resolves when they were answered.
   *
   * @throws `DataError` when the host refuses the action as outside the policy or malformed.
   * @throws `ServiceError` when the host cannot be reached or cannot save.
   */
  dispatch(action: CandidateAction): Promise<DispatchResult>;
  /** Calls the listener with every new view, and returns the function that removes it. */
  subscribe(listener: (view: CandidateView) => void): () => void;
  /** Stops the timers and the listeners of the client. The client belongs to the host's page, so unmounting the player does not close it. */
  close(): void;
}
