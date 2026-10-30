import { checkBoolean, checkChoice, checkFinite, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { isSupportName, type SupportName } from "../pnp/index.js";
import { checkItemAction, ITEM_ACTION_TYPES, type ItemAction } from "./item-action.js";
import { checkKey, type ItemKey } from "./plan.js";

/**
 * An action of the candidate (INFO §2.2.1, §2.8):
 *
 * | Type                      | The candidate …                                                                   |
 * | ------------------------- | --------------------------------------------------------------------------------- |
 * | the types of `ItemAction` | acts on the item presented: responses, submit, skip, end attempt, next attempt, review, solution, comment |
 * | `move`                    | goes to the next item, to the previous one, or to an item of a nonlinear test part |
 * | `support`                 | turns on or off a support that is an option (BPIG §5.3)                           |
 * | `end-part`                | ends the test part                                                                |
 * | `end-test`                | ends the test                                                                     |
 * | `suspend`                 | suspends the candidate session                                                    |
 * | `resume`                  | resumes the candidate session                                                     |
 */
export type CandidateAction =
  | ItemAction
  | {
      /** Moves. */
      readonly type: "move";
      /** The next item, the previous one, or an item instance of the test part. */
      readonly to: "next" | "previous" | ItemKey;
    }
  | {
      /** Turns a support on or off. */
      readonly type: "support";
      /** The support, as the PNP names it. */
      readonly name: SupportName;
      /** Whether the support is to be on. */
      readonly active: boolean;
    }
  | {
      /** Ends the test part or the test, or suspends or resumes the candidate session. */
      readonly type: "end-part" | "end-test" | "suspend" | "resume";
    };

/** An action of the host: `time` applies the deadlines that passed (E7). */
export interface HostAction {
  /** Applies the deadlines that passed. */
  readonly type: "time";
}

/** An action of the candidate or the host, with the time it happened: epoch milliseconds on the host's clock (E5). */
export type Action = (CandidateAction | HostAction) & {
  /** When the action happened, in epoch milliseconds. */
  readonly at: number;
};

/** The types of the actions that are not actions on an item. */
const SESSION_ACTION_TYPES = ["move", "support", "end-part", "end-test", "suspend", "resume", "time"] as const;

const ACTION_TYPES: readonly Action["type"][] = [...ITEM_ACTION_TYPES, ...SESSION_ACTION_TYPES];

/** The places that `move` names by a word. */
const MOVES: readonly string[] = ["next", "previous"];

/**
 * Checks an action: its type, its time, and the fields that its type has.
 *
 * @throws `DataError` when it is not an action.
 */
export function checkAction(action: unknown): asserts action is Action {
  checkRecord(action, "The action must be an object with a type and a time");
  checkChoice(action.type, "The type of the action", ACTION_TYPES);
  checkFinite(action.at, "The time of the action");
  switch (action.type) {
    case "move":
      if (typeof action.to !== "string") checkKey(action.to);
      else if (!MOVES.includes(action.to)) {
        throw new DataError(
          `The place of move must be "next", "previous" or an item instance, found ${describe(action.to)}.`,
        );
      }
      break;
    case "support":
      if (!isSupportName(action.name)) {
        throw new DataError(
          `The name of support must be the name of a support of a PNP, found ${describe(action.name)}.`,
        );
      }
      checkBoolean(action.active, "The active of support");
      break;
    case "end-part":
    case "end-test":
    case "suspend":
    case "resume":
    case "time":
      break;
    default:
      checkItemAction(action);
  }
}
