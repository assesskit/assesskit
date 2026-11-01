import { isRecord, parseWith, type Schema } from "@assesskit/runtime/checks";
import * as v from "valibot";

/**
 * What a client sends to a session host when it has no action to send and wants the latest view: a candidate whom a proctor
 * paused has no action, so the client learns of the resume only by asking.
 */
export interface ViewRequest {
  /** Always `"view"`. */
  readonly type: "view";
}

const viewRequestSchema: Schema<ViewRequest> = v.strictObject({ type: v.literal("view") });

/**
 * Tells whether a request that arrived as JSON claims to be a view request, so that the host reads it as one and refuses it
 * when it holds more than the type.
 *
 * @param value - The parsed JSON.
 * @returns Whether it is an object whose `type` is `"view"`.
 */
export function isViewRequest(value: unknown): boolean {
  return isRecord(value) && value.type === "view";
}

/**
 * Checks the shape of a view request that arrived as JSON.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` when it is not an object with the property `type` only, `"view"`.
 */
export function checkViewRequest(value: unknown): asserts value is ViewRequest {
  parseWith(viewRequestSchema, value, "A view request");
}
