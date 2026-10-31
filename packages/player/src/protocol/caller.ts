import * as v from "valibot";
import { nonEmptyStringSchema, parseWith, type Schema } from "../checks.js";

/**
 * The identity that the host's authentication gives to a request. It never comes from the client: envelopes carry no
 * session identifier, so a candidate cannot name another candidate's session.
 */
export interface Caller {
  /** The identifier of the session the request is about. */
  readonly session: string;
  /** The identifier of the authenticated principal. A session belongs to the principal that started it. */
  readonly principal: string;
}

const callerSchema: Schema<Caller> = v.object({ session: nonEmptyStringSchema, principal: nonEmptyStringSchema });

/**
 * Checks a caller, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with a non-empty `session` and `principal`.
 */
export function checkCaller(value: unknown): asserts value is Caller {
  parseWith(callerSchema, value, "The caller");
}
