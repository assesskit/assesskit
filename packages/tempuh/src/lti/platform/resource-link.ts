import type { ItemKey } from "@luthfanwakan/olah/delivery";
import { encodeBase64Url } from "../base64url.js";

/**
 * Returns the identifier of the resource link of an item instance of a session: stable for the instance, different for
 * every other, opaque to the tool, and at most 255 characters (LTI 1.3 Core §5.3.5). The launch and the line item
 * (`resourceLinkId`, LTI AGS 2.0 §3.2.9) name the same link.
 */
export async function resourceLinkId(session: string, item: ItemKey): Promise<string> {
  const key = JSON.stringify([session, item.ref, item.instance]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return encodeBase64Url(new Uint8Array(digest));
}
