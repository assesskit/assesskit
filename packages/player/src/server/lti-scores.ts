import { checkFunction, checkRecord } from "@assesskit/runtime/checks";
import type { ItemKey } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { single } from "@assesskit/runtime/values";
import type { AgsScore } from "../lti/index.js";
import type { HostSession } from "../protocol/index.js";
import type { AgsScoreStore } from "./ags-score-store.js";
import type { StepEvents } from "./forward.js";

/** The options of {@link createLtiScoreIntake}. */
export interface LtiScoreIntakeOptions {
  /** The session host that the scores go to. `Pick<SessionHost, "session">` satisfies it. */
  readonly host: {
    /** Returns the host side of a session, of which the intake uses `apply`. */
    session(session: string): Pick<HostSession, "apply">;
  };
  /** Keeps the latest score of each line item. */
  readonly scores: AgsScoreStore;
  /**
   * Gives the IRI of the tool that scored the item, for the GradeEvent of Caliper. Needed when the session host forwards
   * to Caliper.
   *
   * @defaultValue none, so that the `supply-scores` action names no scorer
   */
  readonly scoredBy?: (session: string, item: ItemKey) => string | Promise<string>;
}

/** What the wiring of the scores of LTI items gives the host. */
export interface LtiScoreIntake {
  /**
   * Receives a score from the line item of an item instance. Pass it as `onScore` of `agsScores`.
   *
   * @remarks
   * It keeps the score if its time is later than that of the kept one, and ignores it otherwise. A score that is
   * `FullyGraded` is supplied to the session: its `scoreGiven` answers the `SCORE` request of the item and its
   * `scoreMaximum` the `MAXSCORE` request, and a later score replaces the values of an earlier one. Other progress is kept
   * and not supplied. When the session has not made the requests yet, nothing is supplied until {@link LtiScoreIntake.settle}
   * runs for the step that makes them.
   *
   * @throws `DataError` when the session refuses the score.
   */
  readonly onScore: (session: string, item: ItemKey, score: AgsScore) => Promise<void>;
  /**
   * Supplies the kept score of the LTI items whose requests a step made. A tool may post a `FullyGraded` score while the
   * candidate is still in the item, and the runtime makes the requests only when the item session is over. Call it with the
   * events of every step, from the `log` of the host's forwarding options.
   *
   * @throws `DataError` when the session refuses a score.
   */
  readonly settle: (step: StepEvents) => Promise<void>;
}

// An item that models a link to a tool has the outcomes SCORE and MAXSCORE, single floats that the tool scores; the id of the
// request for an outcome of an item instance is `item:<ref>:<instance>:<outcome>`. Both are part of the runtime's documented
// delivery contract, and the engine refuses a value that does not fit.
const ANSWERS: readonly (readonly [string, (score: AgsScore) => number | undefined])[] = [
  ["SCORE", (score) => score.scoreGiven],
  ["MAXSCORE", (score) => score.scoreMaximum],
];

const requestId = (item: ItemKey, outcome: string): string => `item:${item.ref}:${item.instance}:${outcome}`;

function checkIntakeOptions(options: unknown): asserts options is LtiScoreIntakeOptions {
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
 * Creates the wiring that turns the scores which the tool of an LTI item posts into the scores of the session: the
 * `onScore` of `agsScores`, and the function that supplies a kept score when the session asks for it.
 *
 * @remarks
 * - **Latest by time.** The line item keeps the score with the latest `timestamp`; a score that is not later is ignored.
 * - **Final scores only.** A score that is `FullyGraded` answers the requests of the item with `supply-scores`, scored by
 *   an external machine; `Pending`, `PendingManual` and the other progress is kept and not supplied.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-ags/v2p0#score-publish-service | LTI AGS 2.0, score publish service}
 * @param options - See {@link LtiScoreIntakeOptions}.
 * @returns The wiring.
 * @throws `DataError` when an option has the wrong type.
 */
export function createLtiScoreIntake(options: LtiScoreIntakeOptions): LtiScoreIntake {
  checkIntakeOptions(options);
  const { host, scores, scoredBy } = options;

  /** Supplies the requests of an item with a final score; a session that has not made them yet is left as it is. */
  const supply = async (session: string, item: ItemKey, score: AgsScore): Promise<void> => {
    if (score.gradingProgress !== "FullyGraded") return;
    const applyOptions = scoredBy === undefined ? {} : { scoredBy: await scoredBy(session, item) };
    for (const [outcome, answer] of ANSWERS) {
      const value = answer(score);
      const request = requestId(item, outcome);
      const step = await host.session(session).apply(
        {
          type: "supply-scores",
          request,
          value: value === undefined ? null : single("float", value),
          scorer: "externalMachine",
        },
        applyOptions,
      );
      if (step.refusal === undefined) continue;
      if (step.refusal.code === "unknown-request") return;
      throw new DataError(
        `The session ${JSON.stringify(session)} refused the score of the tool for ${request}: ${step.refusal.message}`,
      );
    }
  };

  return {
    onScore: async (session, item, score) => {
      if (await scores.keep(session, item, score)) await supply(session, item, score);
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
      for (const item of requested.values()) {
        const kept = await scores.latest(session, item);
        if (kept !== undefined) await supply(session, item, kept);
      }
    },
  };
}
