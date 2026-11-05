import * as v from "valibot";
import type { CatResponse } from "../cat/index.js";
import type { Schema } from "../checks.js";
import type { SupportName, SupportSetting } from "../pnp/index.js";
import type { Value } from "../values/index.js";
import type { ItemAction } from "./item-action.js";
import type { ItemKey } from "./item-key.js";
import type { Scorer } from "./scoring.js";
import { supportNameSchema, supportSettingSchema } from "./support-json.js";

/** The places that `move` names by a word. */
const MOVES = ["next", "previous"] as const;

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
      readonly to: (typeof MOVES)[number] | ItemKey;
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

/**
 * The types of the actions of the candidate, in the order a view lists them.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export const CANDIDATE_ACTION_TYPES = [
  "set-responses",
  "submit",
  "end-attempt",
  "next-attempt",
  "skip",
  "review",
  "solution",
  "comment",
  "mark",
  "move",
  "support",
  "support-settings",
  "end-part",
  "end-test",
  "suspend",
  "resume",
] as const satisfies readonly CandidateAction["type"][];

/** The types of the actions of the host, which a candidate never sends. */
export const HOST_ACTION_TYPES = [
  "time",
  "supply-scores",
  "cat-response",
] as const satisfies readonly HostAction["type"][];

/** What the two forms of an action read differently: JSON holds entries and no other property, memory holds maps. */
export interface ActionForm {
  /** Reads the object of an action; a form refuses a property it does not know, or leaves it. */
  readonly object: typeof v.strictObject;
  /** Reads an item instance. */
  readonly item: Schema<ItemKey>;
  /** Reads the responses of `set-responses`. */
  readonly responses: Schema<ReadonlyMap<string, Value | null>>;
  /** Reads the states of portable custom interactions of `set-responses`. */
  readonly pciStates: Schema<ReadonlyMap<string, string>>;
}

/**
 * Returns the schemas of the actions of the candidate in a form, one for each group of types with the same fields: the one
 * description of those fields, which `v.variant` reads by the type.
 *
 * @param form - How the form reads what differs; see {@link ActionForm}.
 */
export function candidateActionSchemas({ object, item, responses, pciStates }: ActionForm) {
  return [
    object({ type: v.literal("set-responses"), item, responses, pciStates: v.optional(pciStates) }),
    object({ type: v.picklist(["submit", "skip", "next-attempt", "review", "solution"]), item }),
    object({ type: v.literal("end-attempt"), item, interaction: v.string() }),
    object({ type: v.literal("comment"), item, text: v.string() }),
    object({ type: v.literal("mark"), item, marked: v.boolean() }),
    object({
      type: v.literal("move"),
      to: v.union([v.picklist(MOVES), item], 'The place of move must be "next", "previous" or an item instance.'),
    }),
    object({ type: v.literal("support"), name: supportNameSchema, active: v.boolean() }),
    object({ type: v.literal("support-settings"), settings: supportSettingSchema }),
    object({ type: v.picklist(["end-part", "end-test", "suspend", "resume"]) }),
  ] as const;
}
