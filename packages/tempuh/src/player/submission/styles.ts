/**
 * The stylesheet of the display of a submission. The colors, borders and focus come from the custom properties of
 * `player.css`, which the display adopts first, so that the themes and the PNP presentation reach it. Sizes are in `rem`
 * and the layout wraps, so that it follows the text size and a narrow screen without a media query.
 *
 * A content root sets the tokens again on its own host, which would give an item the light theme in a display that has
 * another. The rule of the display wins over the root's `:host`, and takes the tokens that the theme sets from the display.
 */
const SUBMISSION_CSS = `
.tempuh-submission { display: grid; gap: 1.5rem; }
.tempuh-submission h2, .tempuh-submission h3, .tempuh-submission h4 { margin: 0; line-height: 1.3; }
.tempuh-submission h2 { font-size: 1.5em; }
.tempuh-submission h3 { font-size: 1.25em; }
.tempuh-submission h4 { font-size: 1.1em; }
.tempuh-submission-section { display: grid; gap: 0.75rem; }
.tempuh-submission-facts, .tempuh-submission-fields, .tempuh-submission-variables { display: grid; gap: 0.5rem; margin: 0; }
.tempuh-submission-facts > div, .tempuh-submission-fields > div, .tempuh-submission-variables > div {
  display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; }
.tempuh-submission dt { flex: 0 1 12rem; font-weight: 600; }
.tempuh-submission dd { flex: 1 1 14rem; min-width: 0; margin: 0; }
.tempuh-submission-parts { display: grid; gap: 1rem; margin: 0; padding: 0; list-style: none; }
.tempuh-submission-part { display: grid; gap: 0.5rem; padding: 0.75rem; border: var(--tempuh-border-width) solid var(--tempuh-border);
  border-radius: 0.5rem; }
.tempuh-submission-note { margin: 0; padding: 0.5rem 0.75rem; border-inline-start: 0.25rem solid var(--tempuh-accent);
  background: var(--tempuh-accent-surface); }
.tempuh-submission-content { --tempuh-fg: inherit; --tempuh-bg: inherit; --tempuh-accent: inherit;
  --tempuh-on-accent: inherit; --tempuh-invalid: inherit; --tempuh-border: inherit; --tempuh-border-width: inherit;
  --tempuh-focus-width: inherit; }
.tempuh-submission-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.tempuh-submission-none { color: var(--tempuh-muted); font-style: italic; }
.tempuh-submission-list { margin: 0; padding-inline-start: 1.25rem; }
.tempuh-submission audio { display: block; inline-size: min(100%, 24rem); }
`;

/** Builds the stylesheet of a display; each display has one of its own, as each content root does. */
export function submissionStyleSheet(): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SUBMISSION_CSS);
  return sheet;
}
