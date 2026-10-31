import type { ItemKey } from "./plan.js";

/**
 * What happened in a step of a session, as neutral data for logs and analytics:
 *
 * | Type                 | The step …                                                                                                                                                                                          |
 * | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
 * | `presented`          | presented an item to the candidate, the first time or again after its session was suspended                                                                                                         |
 * | `responses-set`      | stored responses the candidate entered                                                                                                                                                              |
 * | `attempt-ended`      | ended an attempt; `detail` says how: `submit`, `skip`, `end-attempt` or `close`                                                                                                                     |
 * | `response-processed` | ran the response processing of the attempt that ended                                                                                                                                               |
 * | `processing-failed`  | had processing fail: template or response processing of `item`, or the outcome processing, a pre-condition, a branch rule or a template default of the test, `scope`; `detail` is the error message |
 * | `outcome-processed`  | ran the outcome processing of the test, `scope`, after the responses submitted in the step                                                                                                          |
 * | `moved`              | made `item` the current item                                                                                                                                                                        |
 * | `section-entered`    | entered the section `scope`                                                                                                                                                                         |
 * | `part-ended`         | ended the test part `scope`: the attempts open in it ended                                                                                                                                          |
 * | `test-ended`         | ended the test `scope`                                                                                                                                                                              |
 * | `time-limit-passed`  | passed the maximum time of `item` or of the test, part or section `scope`, which allows late submission                                                                                             |
 * | `time-out`           | closed `item` or the test, part or section `scope` at its maximum time                                                                                                                              |
 * | `late-submission`    | ended an attempt of `item` after a maximum time that allows late submission passed                                                                                                                  |
 * | `suspended`          | suspended the candidate session                                                                                                                                                                     |
 * | `resumed`            | resumed the candidate session                                                                                                                                                                       |
 * | `support-changed`    | turned a support on or off; `detail` is its name, a space, and `on` or `off`                                                                                                                        |
 * | `variant-selected`   | chose the variant that `item` presents; `detail` is the identifier of its resource                                                                                                                  |
 * | `hazard-unavoidable` | presents `item` with hazards the candidate avoids, as no variant is free of them; `detail` lists them                                                                                               |
 * | `scoring-requested`  | made a scoring request for the outcome of `item`, or of the test `scope`; `detail` is the identifier of the request                                                                                 |
 * | `scores-applied`     | applied the first score supplied for a request; `detail` is its identifier                                                                                                                          |
 * | `scores-replaced`    | replaced a score that an earlier supply gave; `detail` is the identifier of the request                                                                                                             |
 * | `cat-requested`      | made a request of a CAT engine for the adaptive section `scope`; `detail` is `<kind> <identifier>`                                                                                                  |
 * | `cat-stage-added`    | added the items of a stage to the adaptive section `scope`; `detail` lists their identifiers                                                                                                        |
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export type DeliveryEventType =
  | "presented"
  | "responses-set"
  | "attempt-ended"
  | "response-processed"
  | "processing-failed"
  | "outcome-processed"
  | "moved"
  | "section-entered"
  | "part-ended"
  | "test-ended"
  | "time-limit-passed"
  | "time-out"
  | "late-submission"
  | "suspended"
  | "resumed"
  | "support-changed"
  | "variant-selected"
  | "hazard-unavoidable"
  | "scoring-requested"
  | "scores-applied"
  | "scores-replaced"
  | "cat-requested"
  | "cat-stage-added";

/** An event of a step of a session. */
export interface DeliveryEvent {
  /** What happened. */
  readonly type: DeliveryEventType;
  /** When it happened, in epoch milliseconds: the time of the action, or of the deadline that passed. */
  readonly at: number;
  /** The item instance, for the events of an item. */
  readonly item?: ItemKey;
  /** The identifier of the test, test part or section, for the events of a scope. */
  readonly scope?: string;
  /** More about the event, as its type says. */
  readonly detail?: string;
}
