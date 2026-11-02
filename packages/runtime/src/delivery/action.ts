import type { CatResponse } from "../cat/index.js";
import { isSessionEnd } from "../cat/index.js";
import { checkArray, checkBoolean, checkChoice, checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { isSupportName, type SupportName, type SupportSetting } from "../pnp/index.js";
import { normalizeValue, type Value } from "../values/index.js";
import { checkInstant } from "./datestamp.js";
import { checkItemAction, ITEM_ACTION_TYPES, type ItemAction } from "./item-action.js";
import { checkKey, type ItemKey } from "./plan.js";
import type { Scorer } from "./scoring.js";
import { checkSupportSetting } from "./support-json.js";

/**
 * An action of the candidate:
 *
 * | Type                      | The candidate …                                                                                           |
 * | ------------------------- | --------------------------------------------------------------------------------------------------------- |
 * | the types of `ItemAction` | acts on the item presented: responses, submit, skip, end attempt, next attempt, review, solution, comment |
 * | `mark`                    | marks an item instance presented for review, or takes the mark away                                       |
 * | `move`                    | goes to the next item, to the previous one, or to an item of a nonlinear test part                        |
 * | `support`                 | turns on or off a support that is an option                                                               |
 * | `support-settings`        | changes the settings of a support that is on, those of `ADJUSTABLE_SETTINGS`                              |
 * | `end-part`                | ends the test part                                                                                        |
 * | `end-test`                | ends the test                                                                                             |
 * | `suspend`                 | suspends the candidate session                                                                            |
 * | `resume`                  | resumes the candidate session                                                                             |
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
export type CandidateAction =
  | ItemAction
  | {
      /** Marks an item instance for review, or takes the mark away. */
      readonly type: "mark";
      /** Any item instance presented. */
      readonly item: ItemKey;
      /** Whether the item is to be marked. */
      readonly marked: boolean;
    }
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
      /** Changes the settings of a support that is on. */
      readonly type: "support-settings";
      /**
       * The settings of the support, whole: those in force with the candidate's changes. Only the settings of
       * `ADJUSTABLE_SETTINGS` may differ from those in force.
       */
      readonly settings: SupportSetting;
    }
  | {
      /** Ends the test part or the test, or suspends or resumes the candidate session. */
      readonly type: "end-part" | "end-test" | "suspend" | "resume";
    };

/**
 * An action of the host, which the client never sends:
 *
 * | Type            | The host …                                                                   |
 * | --------------- | ---------------------------------------------------------------------------- |
 * | `time`          | applies the deadlines that passed                                            |
 * | `supply-scores` | gives the value of the outcome that a scoring request asks for, in any state |
 * | `cat-response`  | gives the answer of the CAT engine to a CAT request, in any state            |
 */
export type HostAction =
  | {
      /** Applies the deadlines that passed. */
      readonly type: "time";
    }
  | {
      /** Supplies a score. */
      readonly type: "supply-scores";
      /** The identifier of the scoring request. */
      readonly request: string;
      /** The value of the outcome, or NULL; a second supply replaces the first. */
      readonly value: Value | null;
      /** Who scored it. */
      readonly scorer: Scorer;
    }
  | {
      /** Gives the CAT engine's answer. */
      readonly type: "cat-response";
      /** The identifier of the CAT request. */
      readonly request: string;
      /** The answer, as the kind of the request needs it. */
      readonly response: CatResponse;
    };

/** An action of the candidate or the host, with the time it happened: epoch milliseconds on the host's clock. */
export type Action = (CandidateAction | HostAction) & {
  /** When the action happened, in epoch milliseconds. */
  readonly at: number;
};

/** The types of the actions that are not actions on an item. */
const SESSION_ACTION_TYPES = [
  "mark",
  "move",
  "support",
  "support-settings",
  "end-part",
  "end-test",
  "suspend",
  "resume",
  "time",
  "supply-scores",
  "cat-response",
] as const;

const ACTION_TYPES: readonly Action["type"][] = [...ITEM_ACTION_TYPES, ...SESSION_ACTION_TYPES];

/** The scorers, for the checks. */
const SCORERS: readonly Scorer[] = ["human", "externalMachine"];

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
  checkInstant(action.at, "The time of the action");
  switch (action.type) {
    case "mark":
      checkKey(action.item);
      checkBoolean(action.marked, "The marked of mark");
      break;
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
    case "support-settings":
      checkSupportSetting(action.settings, "The settings of support-settings");
      break;
    case "supply-scores":
      checkString(action.request, "The request of supply-scores");
      checkChoice(action.scorer, "The scorer of supply-scores", SCORERS);
      if (action.value !== null) normalizeValue(action.value);
      break;
    case "cat-response":
      checkString(action.request, "The request of cat-response");
      checkCatResponse(action.response);
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

/** Checks the variables of a result that a CAT engine returned: the kinds this engine reads. */
function checkReportedVariables(variables: unknown, what: string): void {
  checkArray(variables, `The variables of ${what} must be an array`);
  for (const variable of variables) {
    checkRecord(variable, `A variable of ${what} must be an object`);
    checkString(variable.identifier, `The identifier of a variable of ${what}`);
    if (variable.kind === "outcome" && variable.value !== null) normalizeValue(variable.value);
  }
}

/** Checks the result report in the answer to Submit Results: the context, the test result and the item results. */
function checkReport(report: unknown): void {
  checkRecord(report, "The assessmentResult of a CAT answer must be an object");
  if (report.context !== undefined) {
    checkRecord(report.context, "The context of the assessmentResult of a CAT answer must be an object");
    checkArray(
      report.context.sessionIdentifiers,
      "The sessionIdentifiers of the context of a CAT answer must be an array",
    );
    for (const each of report.context.sessionIdentifiers) {
      checkRecord(each, "A session identifier of the context of a CAT answer must be an object");
      checkString(each.sourceId, "The sourceId of a session identifier of a CAT answer");
      checkString(each.identifier, "The identifier of a session identifier of a CAT answer");
    }
  }
  if (report.testResult !== undefined) {
    checkRecord(report.testResult, "The testResult of a CAT answer must be an object");
    checkReportedVariables(report.testResult.variables, "the testResult of a CAT answer");
  }
  checkArray(report.itemResults, "The itemResults of the assessmentResult of a CAT answer must be an array");
  for (const result of report.itemResults) {
    checkRecord(result, "An itemResult of a CAT answer must be an object");
    checkString(result.identifier, "The identifier of an itemResult of a CAT answer");
    checkReportedVariables(result.variables, "an itemResult of a CAT answer");
  }
}

/**
 * Checks the answer of a CAT engine as far as the engine reads it: an End Session answer, or an object whose fields,
 * when present, have their types. Whether it fits the request is decided when it is applied.
 *
 * @throws `DataError` when it is not an answer.
 */
function checkCatResponse(response: unknown): void {
  checkRecord(response, "The response of cat-response must be an object");
  if (response.ended !== undefined) {
    if (response.ended !== true) {
      throw new DataError(`The ended of the response of cat-response must be true, found ${describe(response.ended)}.`);
    }
    return;
  }
  const { sessionIdentifier, sessionState, nextItems, assessmentResult } = response;
  if (sessionIdentifier !== undefined)
    checkString(sessionIdentifier, "The sessionIdentifier of the response of cat-response");
  if (sessionState !== undefined) checkString(sessionState, "The sessionState of the response of cat-response");
  // isSessionEnd checks that the stage is an item stage.
  if (nextItems !== undefined && nextItems !== null) isSessionEnd(nextItems as Parameters<typeof isSessionEnd>[0]);
  if (assessmentResult !== undefined) checkReport(assessmentResult);
}
