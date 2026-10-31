import type { ReadingType } from "@assesskit/runtime/pnp";
import { PNP_READING_TYPES } from "@assesskit/runtime/pnp";
import { checkTerm } from "./checks.js";

/** The elements that this module hid from assistive technology, so that it removes only what it set. */
const HIDDEN = new WeakSet<Element>();

/** Returns whether the reading type keeps an element out of the accessible structure. */
function hides(element: Element, readingType: ReadingType | undefined): boolean {
  if (readingType === "screen-reader") {
    return ["screen-reader", "all"].includes(element.getAttribute("data-qti-suppress-tts") ?? "");
  }
  return (
    readingType === "computer-read-aloud" &&
    element.getAttribute("data-qti-a11y-content-role") === "screen-reader-orientation"
  );
}

/**
 * Applies the reading type of the candidate's spoken support to the accessible structure of a content root, which the
 * screen reader reads.
 *
 * @remarks
 * For `screen-reader`, an element with `data-qti-suppress-tts` of `screen-reader` or `all` gets `aria-hidden="true"`. For
 * `computer-read-aloud`, an element with the content role `screen-reader-orientation`, guidance for screen reader users
 * that a candidate who looks at the screen does not need, gets it. Any other value, and `undefined`, remove what an
 * earlier call set and nothing else: an `aria-hidden` of the content stays. Call it again when the support changes or the
 * content is replaced.
 *
 * @param root - A content root, or an element of one.
 * @param readingType - The reading type of the spoken support, or `undefined` for a candidate without one.
 * @throws `DataError` when `readingType` is neither a reading type nor `undefined`.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, reading type}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/vocab/ | QTI 3 Standardized Shared Vocabulary, text to speech suppression}
 */
export function applyReadingType(root: ParentNode, readingType: ReadingType | undefined): void {
  if (readingType !== undefined) checkTerm(readingType, PNP_READING_TYPES, "The reading type");
  for (const element of root.querySelectorAll("[data-qti-suppress-tts], [data-qti-a11y-content-role]")) {
    if (hides(element, readingType)) {
      if (element.getAttribute("aria-hidden") !== "true") {
        element.setAttribute("aria-hidden", "true");
        HIDDEN.add(element);
      }
    } else if (HIDDEN.delete(element)) {
      element.removeAttribute("aria-hidden");
    }
  }
}
