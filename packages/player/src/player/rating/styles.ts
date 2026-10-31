/**
 * The stylesheet of the rating form.
 *
 * @remarks
 * The colors, borders and focus come from the custom properties of `player.css`, which the form adopts first, so that the
 * themes and the PNP presentation reach it, and the radio buttons have its target size. Sizes are in `rem` and the layout
 * wraps, so that it follows the text size, a narrow screen (reflow at 320 CSS pixels) and the text spacing a person sets.
 * The state of a choice is the native radio button and never a color alone, so the form stays whole where the browser
 * forces colors.
 */
const RATING_CSS = `
.ak-rating { display: grid; gap: 1rem; max-inline-size: 100%; }
.ak-rating-criterion { display: grid; gap: 0.5rem; min-inline-size: 0; margin: 0; padding: 0.75rem;
  border: var(--ak-border-width) solid var(--ak-border); border-radius: 0.5rem; }
.ak-rating legend { padding: 0 0.25rem; font-weight: 600; overflow-wrap: anywhere; }
.ak-rating-weight { margin-inline-start: 0.5rem; color: var(--ak-muted); font-weight: 400; }
.ak-rating-level { display: flex; align-items: flex-start; gap: 0.75rem; min-block-size: var(--ak-target-size);
  padding: 0.25rem; border-radius: 0.25rem; overflow-wrap: anywhere; cursor: pointer; }
.ak-rating-points { color: var(--ak-muted); }
.ak-rating-criterion[aria-invalid="true"] { border-color: var(--ak-invalid); border-width: calc(var(--ak-border-width) * 3); }
.ak-rating-error { margin: 0; color: var(--ak-invalid); font-weight: 600; }
.ak-rating-chosen { display: grid; gap: 0.5rem; margin: 0; }
.ak-rating-chosen > .ak-rating-criterion { grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
.ak-rating-chosen dt { font-weight: 600; }
.ak-rating-chosen dd { margin: 0; }
.ak-rating-none { color: var(--ak-muted); font-style: italic; }
.ak-rating-none::first-letter { text-transform: uppercase; }
.ak-rating-score { font-weight: 700; }
`;

/**
 * Builds the stylesheet of a form; each form has one of its own, as each display of a submission has.
 *
 * @returns The sheet.
 */
export function ratingStyleSheet(): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(RATING_CSS);
  return sheet;
}
