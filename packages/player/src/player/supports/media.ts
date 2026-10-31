import type { SupportView } from "@assesskit/runtime/delivery";
import type { SupportName } from "@assesskit/runtime/pnp";
import { html } from "../dom.js";
import { CAPTION_KINDS, DESCRIPTION_KINDS } from "../media/tracks.js";
import { activeSupport } from "./check.js";

/** The kinds of text track that a support turns on (HTML Standard §4.8.11.12.1). */
const TRACK_KINDS: ReadonlyMap<SupportName, readonly string[]> = new Map([
  ["captions", CAPTION_KINDS],
  ["audio-description", DESCRIPTION_KINDS],
]);

/**
 * Returns the kinds of text track that the supports that are on ask to show: the captions and subtitles for `captions`,
 * the descriptions for `audio-description` (WCAG 1.2.2, 1.2.3, 1.2.5). The media module shows them.
 */
export function trackKindsOf(supports: readonly SupportView[]): readonly string[] {
  return [...TRACK_KINDS].flatMap(([name, kinds]) => (activeSupport(supports, name) === undefined ? [] : kinds));
}

/**
 * Shows the alternative text of the images in a root as text after each image, for a candidate whose `alternative-text`
 * support is on (T84): the `alt` that the author gave. An image whose `alt` is empty is decoration and gets nothing.
 *
 * @returns A function that takes the text away.
 */
export function showAlternativeText(root: ParentNode, supports: readonly SupportView[]): () => void {
  if (activeSupport(supports, "alternative-text") === undefined) return () => undefined;
  const added = [...root.querySelectorAll("img")].flatMap((image) => {
    const alternative = image.getAttribute("alt");
    if (alternative === null || alternative.trim() === "") return [];
    const text = html("span", { class: "ak-alternative-text", "data-ak-card": "alternative-text" }, alternative);
    image.after(text);
    return [text];
  });
  return () => {
    for (const text of added) text.remove();
  };
}
