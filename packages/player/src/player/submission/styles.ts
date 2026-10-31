/**
 * The stylesheet of the display of a submission.
 *
 * @remarks
 * The colors, borders and focus come from the custom properties of `player.css`, which the display adopts first, so that
 * the themes and the PNP presentation reach it. Sizes are in `rem` and the layout wraps, so that it follows the text size
 * and a narrow screen without a media query. A content root sets the tokens again on its own host, which would give an item
 * the light theme in a display that has another. The rule of the display wins over the root's `:host`, and takes the tokens
 * that the theme sets from the display.
 */
const SUBMISSION_CSS = `
.ak-submission { display: grid; gap: 1.5rem; }
.ak-submission h2, .ak-submission h3, .ak-submission h4 { margin: 0; line-height: 1.3; }
.ak-submission h2 { font-size: 1.5em; }
.ak-submission h3 { font-size: 1.25em; }
.ak-submission h4 { font-size: 1.1em; }
.ak-submission-section { display: grid; gap: 0.75rem; }
.ak-submission-facts, .ak-submission-fields, .ak-submission-variables { display: grid; gap: 0.5rem; margin: 0; }
.ak-submission-facts > div, .ak-submission-fields > div, .ak-submission-variables > div {
  display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; }
.ak-submission dt { flex: 0 1 12rem; font-weight: 600; }
.ak-submission dd { flex: 1 1 14rem; min-width: 0; margin: 0; }
.ak-submission-parts { display: grid; gap: 1rem; margin: 0; padding: 0; list-style: none; }
.ak-submission-part { display: grid; gap: 0.5rem; padding: 0.75rem; border: var(--ak-border-width) solid var(--ak-border);
  border-radius: 0.5rem; }
.ak-submission-note { margin: 0; padding: 0.5rem 0.75rem; border-inline-start: 0.25rem solid var(--ak-accent);
  background: var(--ak-accent-surface); }
.ak-submission-content { --ak-fg: inherit; --ak-bg: inherit; --ak-accent: inherit;
  --ak-on-accent: inherit; --ak-invalid: inherit; --ak-border: inherit; --ak-border-width: inherit;
  --ak-focus-width: inherit; }
.ak-submission-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.ak-submission-none { color: var(--ak-muted); font-style: italic; }
.ak-submission-list { margin: 0; padding-inline-start: 1.25rem; }
.ak-submission audio { display: block; inline-size: min(100%, 24rem); }
`;

/**
 * Builds the stylesheet of a display; each display has one of its own, as each content root does.
 *
 * @returns The sheet.
 */
export function submissionStyleSheet(): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SUBMISSION_CSS);
  return sheet;
}
