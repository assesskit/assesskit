import { type CallOptions, checkCallOptions, checkFunction, checkRecord } from "@assesskit/runtime/checks";
import type { ItemKey } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { buildSingle } from "@assesskit/runtime/values";
import type { HostApplyOptions, HostSession } from "../protocol/index.js";
import type { StepSink } from "./forward.js";
import type { ToolScore, ToolScoreStore } from "./tool-score-store.js";

/** The options of {@link createToolScoreIntake}. */
export interface ToolScoreIntakeOptions {
  /** The session host that the scores go to. `Pick<SessionHost, "session">` satisfies it. */
  readonly host: {
    /** Returns the host side of a session, of which the intake uses `apply` and `pending`. */
    session(session: string): Pick<HostSession, "apply" | "pending">;
  };
  /** Keeps the latest score of each item instance. */
  readonly scores: ToolScoreStore;
  /**
   * Gives who scored, for the `scoredBy` of the step that the score makes. It runs after the score is kept and before any
   * action is applied, and it receives the `signal` of {@link ToolScoreIntake.onScore}.
   *
   * @defaultValue none, so that the steps carry no scorer
   */
  readonly scoredBy?: (session: string, item: ItemKey, options?: CallOptions) => string | Promise<string>;
}

/** What the wiring of the scores of tool items gives the host. */
export interface ToolScoreIntake {
  /**
   * Receives the score of the tool of an item instance.
   *
   * @remarks
   * It keeps the score if its time is not earlier than that of the kept one, and ignores it otherwise. A final score is
   * supplied to the session: its `scoreGiven` answers the `SCORE` request of the item and its `scoreMaximum` the
   * `MAXSCORE` request, and a later score replaces the values of an earlier one. A score that is not final is kept and not
   * supplied. When the session has not made the requests yet, nothing is supplied until {@link ToolScoreIntake.settle} runs for
   * the step that makes them.
   *
   * A failure after the score is kept leaves it kept: the call rejects, and a retry at the same or a later time supplies
   * both outcomes. A tool that never retries leaves the request in `pending()` for a rater, or for `settle` on a later
   * job. The `signal` ends this wait before the save; after it, the step completes.
   *
   * @throws `DataError` when the session refuses the score.
   * @throws the error of the store, of `scoredBy` or of the session host, as each rejects.
   */
  readonly onScore: (session: string, item: ItemKey, score: ToolScore, options?: CallOptions) => Promise<void>;
  /**
   * A step sink that supplies the kept final score of each item whose requests the step made, for the requests that are
   * still open. A tool may give a final score while the candidate is still in the item, and the runtime makes the requests
   * only when the item session is over. Calling it again for the same step supplies nothing, because an answered request
   * is skipped.
   *
   * @remarks
   * It takes no signal, so a host that runs it inside `log` bounds the time itself; a host's job may run it outside any step.
   *
   * @throws `DataError` when the session refuses a score.
   */
  readonly settle: StepSink;
}

// An item that models a link to a tool has the outcomes SCORE and MAXSCORE, single floats that the tool scores; the id of the
// request for an outcome of an item instance is `item:<ref>:<instance>:<outcome>`. Both are part of the runtime's documented
// delivery contract, and the engine refuses a value that does not fit.
const ANSWERS: readonly (readonly [string, (score: ToolScore) => number | undefined])[] = [
  ["SCORE", (score) => score.scoreGiven],
  ["MAXSCORE", (score) => score.scoreMaximum],
];

const requestId = (item: ItemKey, outcome: string): string => `item:${item.ref}:${item.instance}:${outcome}`;

function checkIntakeOptions(options: unknown): asserts options is ToolScoreIntakeOptions {
  checkRecord(options, "The options must be an object");
  checkRecord(options.host, "The option host must be an object");
  checkFunction(options.host.session, "The function session of the option host must be a function");
  checkRecord(options.scores, "The option scores must be an object");
  for (const name of ["keep", "latest"]) {
    checkFunction(options.scores[name], `The function ${name} of the option scores must be a function`);
  }
  if (options.scoredBy !== undefined) checkFunction(options.scoredBy, "The option scoredBy must be a function");
}

/**
 * Creates the wiring that turns the scores which the tool of an item gives into the scores of the session: `onScore` for
 * the tool's call, and `settle` for the step that makes the requests.
 *
 * @remarks
 * - **Latest by time.** The store keeps the score with the latest `timestampMs`; a score that is earlier is ignored.
 * - **Final scores only.** A final score answers the requests of the item with `supply-scores`, scored by an external
 *   machine; any other score is kept and not supplied.
 * - **Safe to repeat.** `onScore` at the same time supplies again and replaces the values; `settle` supplies only the
 *   requests that are open.
 *
 * @param options - See {@link ToolScoreIntakeOptions}.
 * @returns The wiring.
 * @throws `DataError` when an option has the wrong type.
 */
export function createToolScoreIntake(options: ToolScoreIntakeOptions): ToolScoreIntake {
  checkIntakeOptions(options);
  const { host, scores, scoredBy } = options;

  /** Gives the options of an action: the signal of the call, and who scored. */
  const applyOptionsOf = async (
    session: string,
    item: ItemKey,
    callOptions: CallOptions | undefined,
  ): Promise<HostApplyOptions> => {
    const signal = callOptions?.signal;
    return {
      ...(signal === undefined ? {} : { signal }),
      ...(scoredBy === undefined ? {} : { scoredBy: await scoredBy(session, item, callOptions) }),
    };
  };

  /** Supplies one request, and returns whether the session has it: a session that has not made the request is left as it is. */
  const supplyOne = async (
    session: string,
    request: string,
    value: number | undefined,
    applyOptions: HostApplyOptions,
  ): Promise<boolean> => {
    const step = await host.session(session).apply(
      {
        type: "supply-scores",
        request,
        value: value === undefined ? null : buildSingle("float", value),
        scorer: "externalMachine",
      },
      applyOptions,
    );
    if (step.refusal === undefined) return true;
    if (step.refusal.reason === "unknown-request") return false;
    throw new DataError(
      `The session ${JSON.stringify(session)} refused the score of the tool for ${request}: ${step.refusal.message}`,
    );
  };

  /** Supplies the requests of an item with a final score, those in `only` when it is given. */
  const supply = async (
    session: string,
    item: ItemKey,
    score: ToolScore,
    callOptions: CallOptions | undefined,
    only?: ReadonlySet<string>,
  ): Promise<void> => {
    if (!score.final) return;
    const applyOptions = await applyOptionsOf(session, item, callOptions);
    for (const [outcome, answer] of ANSWERS) {
      const request = requestId(item, outcome);
      if (only?.has(request) === false) continue;
      if (!(await supplyOne(session, request, answer(score), applyOptions))) return;
    }
  };

  return {
    onScore: async (session, item, score, callOptions) => {
      checkCallOptions(callOptions);
      if (await scores.keep(session, item, score, callOptions)) await supply(session, item, score, callOptions);
    },
    settle: async ({ session, events }) => {
      // An LTI item makes two requests in one step, so its key appears twice.
      const requested = new Map(
        events.flatMap((event) =>
          event.type === "scoring-requested" && event.item
            ? [[JSON.stringify([event.item.ref, event.item.instance]), event.item] as const]
            : [],
        ),
      );
      let open: ReadonlySet<string> | undefined;
      for (const item of requested.values()) {
        const kept = await scores.latest(session, item);
        if (kept === undefined || !kept.final) continue;
        open ??= new Set((await host.session(session).pending()).scoring.map(({ id }) => id));
        await supply(session, item, kept, undefined, open);
      }
    },
  };
}
