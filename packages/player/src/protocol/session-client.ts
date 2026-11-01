import type { CandidateAction, CandidateView, Refusal } from "@assesskit/runtime/delivery";
import type { ViewDocuments } from "./documents.js";
import type { SessionCallOptions } from "./host-session.js";

/** What a session client answers to an action: the view after it, and the engine's refusal when it did not apply. */
export interface DispatchResult {
  /** The view after the action; when it was refused, the view of the state as it was. */
  readonly view: CandidateView;
  /**
   * Why the engine refused the action.
   *
   * @defaultValue none, the action was applied
   */
  readonly refusal?: Refusal;
}

/** The one interface the player mounts against, whether the engine runs on a server (exam mode) or on the device (practice). */
export interface SessionClient {
  /** The latest view. */
  readonly view: CandidateView;
  /** The documents the content of the latest view comes from, which the references in it resolve against. */
  readonly documents: ViewDocuments;
  /**
   * Returns the milliseconds since `view` was built or received, on the client's clock: the timers of a view count down
   * from the moment it was made.
   *
   * @returns The age in milliseconds.
   */
  age(): number;
  /**
   * Turns the path of a file in the package into the URL to load it from: the base URL of the longest asset prefix of the
   * latest view that holds the path, plus the path.
   *
   * @param path - The path in the package.
   * @returns The URL.
   */
  assets(path: string): string;
  /**
   * Sends an action and resolves with the view after it. A client may hold back `set-responses` actions, which it sends
   * together after a pause; the promise then resolves when they were answered.
   *
   * @param action - The action.
   * @param options - See {@link SessionCallOptions}.
   * @returns The view after the action, and the refusal when the engine did not apply it.
   * @throws `DataError` when the host refuses the action as outside the policy or malformed.
   * @throws `ServiceError` when the host cannot be reached or cannot save.
   * @throws `signal.reason` when the signal aborts. An action that had not started is dropped. A request of a remote client
   * that is in flight stays in doubt, and the client sends it again before the next one. Held `set-responses` are sent
   * all the same.
   */
  dispatch(action: CandidateAction, options?: SessionCallOptions): Promise<DispatchResult>;
  /**
   * Asks the session for its latest view and resolves with it, for a candidate who waits for someone else to act: a proctor
   * who pauses a test lists no action for the candidate, and a resume reaches the client only when it asks.
   *
   * @remarks
   * A remote client sends the responses it holds, sends again a request that got no answer, and then sends the view
   * request `{ "type": "view" }`, which the host answers as `SessionHost.view` does and which changes nothing there. A
   * local client builds the view of the state at the time of the call. Both call the listeners with the view they get.
   *
   * @param options - See {@link SessionCallOptions}.
   * @returns The latest view.
   * @throws `DataError` when the client is closed or the host refuses the request.
   * @throws `ServiceError` when the host cannot be reached or cannot save.
   * @throws `signal.reason` when the signal aborts. Nothing is sent when it aborted before the call, and a view request in
   * flight is not in doubt, because it changes nothing at the host.
   */
  refresh(options?: SessionCallOptions): Promise<CandidateView>;
  /**
   * Calls the listener with every new view.
   *
   * @param listener - The function to call.
   * @returns The function that removes the listener.
   */
  subscribe(listener: (view: CandidateView) => void): () => void;
  /** Stops the timers and the listeners of the client. The client belongs to the host's page, so unmounting the player does not close it. */
  close(): void;
}
