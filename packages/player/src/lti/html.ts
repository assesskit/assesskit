import { encodeBase64 } from "@assesskit/runtime/values";

/** Encodes text for an HTML attribute value or text. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Builds the content security policy of a page with one inline script: nothing is allowed but that script, named by its
 * hash, and the forms that go to the given sources.
 *
 * @param script - The text of the script, as it stands between the tags.
 * @param formAction - The sources a form may submit to, such as `'self'` or an origin.
 * @param frameAncestors - The origins that may frame the page; the policy leaves it out when there are none to name.
 */
export async function pagePolicy(script: string, formAction: string, frameAncestors?: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script)));
  const directives = [
    "default-src 'none'",
    `script-src 'sha256-${encodeBase64(digest)}'`,
    "base-uri 'none'",
    `form-action ${formAction}`,
  ];
  if (frameAncestors !== undefined) directives.push(`frame-ancestors ${frameAncestors}`);
  return directives.join("; ");
}
