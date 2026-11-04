import type { CallOptions } from "../protocol/index.js";

/** What a session store holds for one session. */
export interface StoredSession {
  /** The state, as the runtime's `serializeState` writes it. */
  readonly state: string;
  /** The principal that `start` bound the session to. */
  readonly principal: string;
  /** The version of the record, 0 when it was created and 1 more with each save. A save succeeds only against the latest. */
  readonly version: number;
  /** The sequence number of the latest request of the client that the host answered, 0 before the first. */
  readonly seq: number;
  /** The answer to that request: the view envelope as JSON, which a repeated request gets again. */
  readonly envelope: string;
}

/** What a store takes to save a step of a session. */
export interface SessionSave extends StoredSession {
  /** The action that made the step, as JSON with its time: the log of the session. */
  readonly action: string;
}

/**
 * The host's storage of sessions: the state, the principal it belongs to and the answer to the latest request.
 *
 * @remarks
 * A store that serves several processes must make `create` and `save` atomic.
 */
export interface SessionStore {
  /**
   * Creates the record of a new session at version 0 and sequence number 0.
   *
   * @param session - The identifier of the session.
   * @param record - The state, the principal and the first envelope.
   * @param options - See {@link CallOptions}. A store that cannot tell whether it stored the record ignores the signal,
   * because it rejects only when nothing was stored.
   * @returns `false` when the session already exists, and then stores nothing.
   */
  create(
    session: string,
    record: Pick<StoredSession, "state" | "principal" | "envelope">,
    options?: CallOptions,
  ): Promise<boolean>;
  /**
   * Returns the record of a session.
   *
   * @param session - The identifier of the session.
   * @param options - See {@link CallOptions}. A store may ignore them.
   * @returns The record, or `undefined` when there is none.
   */
  load(session: string, options?: CallOptions): Promise<StoredSession | undefined>;
  /**
   * Saves a step if the stored version is still `record.version`, and then stores `record.version + 1`.
   *
   * @param session - The identifier of the session.
   * @param record - The new record, with the version it was loaded at.
   * @param options - See {@link CallOptions}. A store that cannot tell whether it saved the record ignores the signal,
   * because it rejects only when nothing was saved.
   * @returns `false` when another save came first, and then stores nothing.
   */
  save(session: string, record: SessionSave, options?: CallOptions): Promise<boolean>;
}
