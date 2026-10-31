import { checkString, describe } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import * as v from "valibot";

/** Tells whether text is an absolute `https` URL; `URL.canParse` is outside the browser baseline that this shared file keeps. */
function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Checks that a value is an absolute `https` URL, which LTI Core (section 3.5), the CAT binding (section 4.1) and Caliper (section 5.4) require
 * of every URL of a message and a service.
 *
 * @param value - The value.
 * @param label - Names the value in the error message, such as `The option endpoint`.
 * @throws `DataError` when it is not.
 */
export function checkHttpsUrl(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  if (!isHttpsUrl(value)) throw new DataError(`${label} must be an absolute https URL, found ${describe(value)}.`);
}

/** An absolute `https` URL, which LTI (Core section 3.5), the CAT binding (section 4.1) and Caliper (section 5.4) require of every URL of a message and a service. */
export const httpsUrlSchema = v.pipe(
  v.string(),
  v.check(isHttpsUrl, (issue) => `expected an absolute https URL, found ${issue.received}`),
);
