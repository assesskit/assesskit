import { definedSchema, nonNegativeIntegerSchema, parseWith, type Schema } from "@assesskit/runtime/checks";
import * as v from "valibot";

/** What a client sends to a session host: one candidate action in the runtime's JSON form, with its sequence number. */
export interface ActionEnvelope {
  /**
   * The sequence number of the request. A repeated number returns the answer already given and a stale one is refused,
   * so a retry changes nothing.
   */
  readonly seq: number;
  /** The action as the runtime's `writeCandidateAction` writes it. Untrusted until the runtime's `readCandidateAction` has read it. */
  readonly action: unknown;
}

const actionEnvelopeSchema: Schema<ActionEnvelope> = v.strictObject({
  seq: nonNegativeIntegerSchema,
  action: definedSchema,
});

/**
 * Checks the shape of an action envelope that arrived as JSON.
 *
 * @remarks
 * The action is not read here: the runtime's `readCandidateAction` reads it, with its size limits.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` when it is not an object with the properties `seq` and `action` only, `seq` a non-negative integer.
 */
export function checkActionEnvelope(value: unknown): asserts value is ActionEnvelope {
  parseWith(actionEnvelopeSchema, value, "An action envelope");
}
