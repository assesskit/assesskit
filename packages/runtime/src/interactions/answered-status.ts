import { checkArray, describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { Value } from "../values/index.js";
import type { InteractionDescriptor } from "./descriptor.js";
import { checkResponse } from "./response-check.js";
import type { ResponseStatus } from "./response-status.js";

/**
 * Returns the answered status of an item from its interactions and their responses.
 *
 * @remarks
 * The item is `answered` when it has a response and every interaction's response is valid, which includes a missing
 * response that breaks no rule, such as an optional choice; `presented` when it has no response; and `attempted`
 * otherwise. An end attempt interaction does not count: its variable tells how the attempt ended, and it is not a
 * response. An item without interactions is `presented`; the engine reports `notpresented` for an item that was never
 * shown.
 *
 * @param descriptors - The descriptors of the interactions that were presented.
 * @param responses - The submitted responses by response identifier; a variable that is missing is NULL.
 * @returns The status.
 * @throws `DataError` when an argument has the wrong type.
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
export function answeredStatus(
  descriptors: readonly InteractionDescriptor[],
  responses: ReadonlyMap<string, Value | null>,
): ResponseStatus {
  checkArray(descriptors, "The descriptors must be an array");
  if (!(responses instanceof Map)) {
    throw new DataError(`The responses must be a Map from response identifier to value, found ${describe(responses)}.`);
  }
  let responded = false;
  let valid = true;
  for (const descriptor of descriptors) {
    if (descriptor.kind === "end-attempt-interaction") continue;
    const response = responses.get(descriptor.responseIdentifier) ?? null;
    responded ||= response !== null;
    valid &&= checkResponse(descriptor, response).reasons.length === 0;
  }
  if (!responded) return "presented";
  return valid ? "answered" : "attempted";
}
