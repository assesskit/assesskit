import type { ItemKey } from "@luthfanwakan/olah/delivery";
import type { FileValue } from "@luthfanwakan/olah/values";
import type { AgsScore } from "../lti/index.js";

/** What a session store holds for one session. */
export interface StoredSession {
  /** The state, as olah's `serializeState` writes it. */
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
 * The host's storage of sessions: the state, the principal it belongs to and the answer to the latest request. A
 * store that serves several processes must make `create` and `save` atomic (T69, [CERT] T-14).
 */
export interface SessionStore {
  /**
   * Creates the record of a new session at version 0 and sequence number 0.
   *
   * @returns `false` when the session already exists, and then stores nothing.
   */
  create(session: string, record: Pick<StoredSession, "state" | "principal" | "envelope">): Promise<boolean>;
  /** Returns the record of a session, or `undefined` when there is none. */
  load(session: string): Promise<StoredSession | undefined>;
  /**
   * Saves a step if the stored version is still `record.version`, and then stores `record.version + 1`.
   *
   * @returns `false` when another save came first, and then stores nothing.
   */
  save(session: string, record: SessionSave): Promise<boolean>;
}

/**
 * The host's scheduler of time-outs, such as a job queue. A job calls `SessionHost.host` with a `time` action at the
 * time it was scheduled for; the job is lost with nothing but a restart of the queue if the queue is not durable, so a
 * durable one is the host's choice.
 */
export interface Scheduler {
  /** Schedules a `time` action for a session at an epoch millisecond. Calling it again for the same pair changes nothing. */
  schedule(session: string, at: number): Promise<void>;
}

/** The host's storage of the files that candidates upload, record or draw: file values are references to it (olah D7). */
export interface FileStore {
  /** Stores the bytes of a file and returns the reference that names it. */
  put(bytes: Uint8Array, mimeType: string, fileName?: string): Promise<FileValue>;
  /** Returns the bytes of a stored file, or `undefined` when there are none. */
  read(file: FileValue): Promise<Uint8Array | undefined>;
}

/**
 * The host's record of the latest score that the tool of each LTI item posted to its line item, by the session and the item
 * instance. A store that serves several processes must make `keep` atomic.
 */
export interface AgsScoreStore {
  /**
   * Keeps a score if its time is later than that of the score kept for the line item, or if none is kept.
   *
   * @param score - A score that passed the checks of `agsScores`. Keep it whole, whatever its `gradingProgress`: the
   * interim ones tell the host how far the tool is.
   * @returns `false` when the kept score is as late as the new one or later, and then stores nothing. The service requires
   * a platform to leave a result alone when the last timestamp on record is later than the incoming score.
   */
  keep(session: string, item: ItemKey, score: AgsScore): Promise<boolean>;
  /** Returns the score kept for a line item, or `undefined` when the tool has posted none. */
  latest(session: string, item: ItemKey): Promise<AgsScore | undefined>;
}
