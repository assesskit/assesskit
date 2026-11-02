import { createStyleAdopter } from "../internal.js";

/**
 * The stylesheet of the parts of the supports that live in the chrome: the panel of options, the controls of reading
 * aloud and the notice of the variant.
 *
 * @remarks
 * It uses the system colors, so that it follows the color scheme and the forced colors of the browser, and sizes in
 * `rem`, so that it follows the text size. Every control is at least 2.75rem, more than the 24 CSS pixels of the target
 * size criterion. Text and background come from the pair `CanvasText` and `Canvas`, never from `ButtonText` and
 * `ButtonFace`, which are no pair in every engine.
 *
 * @see {@link https://www.w3.org/TR/WCAG22/#target-size-minimum | WCAG 2.2, target size}
 */
const SUPPORTS_CSS = `
.ak-supports, .ak-read-aloud, .ak-variant { color: CanvasText; background: Canvas; }
.ak-supports[hidden], .ak-read-aloud[hidden], .ak-variant[hidden] { display: none; }
.ak-supports ul { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.ak-read-aloud { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.ak-support-button { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
  min-width: 2.75rem; min-height: 2.75rem; padding: 0 0.75rem; font: inherit; color: CanvasText;
  background: color-mix(in srgb, CanvasText 10%, Canvas); border: 2px solid CanvasText; border-radius: 0.375rem;
  cursor: pointer; }
.ak-support-state { display: inline-flex; align-items: center; box-sizing: border-box; min-height: 2.75rem;
  padding: 0 0.75rem; border: 2px dashed CanvasText; border-radius: 0.375rem; }
.ak-support-button[aria-pressed="true"] { color: Canvas; background: CanvasText; font-weight: 700;
  box-shadow: inset 0 -0.25rem 0 currentColor; }
.ak-support-field { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.ak-support-select { box-sizing: border-box; min-height: 2.75rem; padding: 0 0.5rem; font: inherit; color: CanvasText;
  background: Canvas; border: 2px solid CanvasText; border-radius: 0.375rem; }
.ak-supports :focus-visible, .ak-read-aloud :focus-visible {
  outline: 3px solid CanvasText; outline-offset: 2px; box-shadow: 0 0 0 2px Canvas; }
.ak-read-aloud-word { min-width: 6rem; padding: 0.25rem 0.5rem; border: 1px solid CanvasText; border-radius: 0.375rem; }
.ak-variant { margin: 0; padding: 0.5rem 0.75rem; border: 2px solid CanvasText; border-radius: 0.375rem; }
`;

/**
 * Adopts the stylesheet of the supports into the document or shadow root that holds a node.
 *
 * @param node - The node.
 * @returns A function that releases it; the root drops the stylesheet when no component uses it any more.
 */
export const adoptSupportStyles = createStyleAdopter(SUPPORTS_CSS);
