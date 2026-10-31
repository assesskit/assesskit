import type { StepEvents } from "@assesskit/player/server";
import type { GradeProgress, Outbox } from "./outbox.ts";

/** What the outbox keeps for one session. */
interface SessionRecord {
  readonly steps: StepEvents[];
  readonly handled: Map<string, string | undefined>;
  through: number;
  covers: number;
  lastAttempt: number;
  failed?: string;
  claimed: boolean;
}

const keyOf = (step: StepEvents["step"]): string => JSON.stringify(step);

/** An outbox in memory that keeps the records of the sessions, which the tests read. */
export interface MemoryOutbox extends Outbox {
  /** The time of each attempt to publish that `nextAttempt` gave, by session, in order. */
  readonly attempts: Map<string, number[]>;
}

/**
 * Creates an outbox in memory. A host replaces it with its database; the rules are the same: `append` is idempotent by session
 * and step, `nextAttempt` is atomic and never goes back, and `claim` is exclusive.
 */
export function memoryOutbox(): MemoryOutbox {
  const records = new Map<string, SessionRecord>();
  const attempts = new Map<string, number[]>();
  const recordOf = (session: string): SessionRecord => {
    let record = records.get(session);
    if (record === undefined) {
      record = {
        steps: [],
        handled: new Map(),
        through: 0,
        covers: 0,
        lastAttempt: Number.NEGATIVE_INFINITY,
        claimed: false,
      };
      records.set(session, record);
    }
    return record;
  };
  return {
    attempts,
    append: async (step) => {
      const { steps } = recordOf(step.session);
      if (!steps.some((each) => keyOf(each.step) === keyOf(step.step))) steps.push(step);
    },
    steps: async (session) => [...recordOf(session).steps],
    unhandled: async (session) => {
      const { steps, handled } = recordOf(session);
      return steps.filter((step) => !handled.has(keyOf(step.step)));
    },
    markHandled: async (session, step, refusal) => {
      recordOf(session).handled.set(keyOf(step), refusal);
    },
    progress: async (session): Promise<GradeProgress> => {
      const { through, failed } = recordOf(session);
      return { through, ...(failed === undefined ? {} : { failed }) };
    },
    nextAttempt: async (session, floor, covers) => {
      const record = recordOf(session);
      const at = Math.max(Date.parse(floor), record.lastAttempt + 1);
      record.lastAttempt = at;
      record.covers = covers;
      attempts.set(session, [...(attempts.get(session) ?? []), at]);
      return new Date(at).toISOString();
    },
    markSent: async (session) => {
      const record = recordOf(session);
      record.through = Math.max(record.through, record.covers);
    },
    markFailed: async (session, reason) => {
      recordOf(session).failed = reason;
    },
    claim: async (session) => {
      const record = recordOf(session);
      if (record.claimed) return undefined;
      record.claimed = true;
      return async () => {
        record.claimed = false;
      };
    },
  };
}
