import type { SupportView } from "@assesskit/runtime/delivery/wire";
import type { SupportName } from "@assesskit/runtime/pnp";
import { html } from "../internal.js";
import { CAPTION_KINDS, DESCRIPTION_KINDS } from "../media/index.js";
import { activeSupport } from "./check.js";

/**
 * The kinds of text track that a support turns on.
 *
 * @see {@link https://html.spec.whatwg.org/multipage/media.html#attr-track-kind | HTML Standard, the kind of a track}
 */
const TRACK_KINDS: ReadonlyMap<SupportName, readonly string[]> = new Map([
  ["captions", CAPTION_KINDS],
  ["audio-description", DESCRIPTION_KINDS],
]);

/**
 * Returns the kinds of text track that the supports that are on ask to show: the captions and subtitles for `captions`,
 * the descriptions for `audio-description`.
 *
 * @param supports - The supports of the view.
 * @returns The track kinds; the media module shows them.
 * @see {@link https://www.w3.org/TR/WCAG22/#captions-prerecorded | WCAG 2.2, captions}
 * @see {@link https://www.w3.org/TR/WCAG22/#audio-description-prerecorded | WCAG 2.2, audio description}
 */
export function trackKindsOf(supports: readonly SupportView[]): readonly string[] {
  return [...TRACK_KINDS].flatMap(([name, kinds]) => (activeSupport(supports, name) === undefined ? [] : kinds));
}

/**
 * Shows the alternative text of the images in a root as text after each image, for a candidate whose `alternative-text`
 * support is on: the `alt` that the author gave.
 *
 * @remarks
 * An image whose `alt` is empty is decoration and gets nothing.
 *
 * @param root - The root that holds the images.
 * @param supports - The supports of the view.
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
