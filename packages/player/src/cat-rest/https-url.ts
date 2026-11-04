import * as v from "valibot";

/** Tells whether text is an absolute `https` URL; `URL.canParse` is outside the browser baseline that this shared file keeps. */
function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

/** An absolute `https` URL, which the CAT binding requires of every URL of a service (section 4.1). */
export const httpsUrlSchema = v.pipe(
  v.string(),
  v.check(isHttpsUrl, (issue) => `expected an absolute https URL, found ${issue.received}`),
);
