import type { ItemKey } from "./plan.js";

/**
 * What happened in a step of a session, as neutral data for logs and analytics (E23):
 *
 * | Type                 | The step …                                                                                   |
 * | -------------------- | -------------------------------------------------------------------------------------------- |
 * | `presented`          | presented an item to the candidate, the first time or again after its session was suspended  |
 * | `responses-set`      | stored responses the candidate entered                                                       |
 * | `attempt-ended`      | ended an attempt; `detail` says how: `submit`, `skip`, `end-attempt` or `close`               |
 * | `response-processed` | ran the response processing of the attempt that ended                                        |
 * | `processing-failed`  | had template or response processing fail; `detail` is the error message (E26)                |
 */
export type DeliveryEventType =
  | "presented"
  | "responses-set"
  | "attempt-ended"
  | "response-processed"
  | "processing-failed";

/** An event of a step of a session. */
export interface DeliveryEvent {
  /** What happened. */
  readonly type: DeliveryEventType;
  /** When it happened: the time of the action, in epoch milliseconds. */
  readonly at: number;
  /** The item instance, for the events of an item. */
  readonly item?: ItemKey;
  /** More about the event, as its type says. */
  readonly detail?: string;
}
