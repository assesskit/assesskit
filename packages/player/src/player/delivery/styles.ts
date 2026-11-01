import { lazyStyleSheet } from "../internal.js";
import { FOCUS_RING } from "./base-styles.js";

/**
 * The stylesheet of the chrome, which a player with chrome adopts after the one that every mount shares.
 *
 * @remarks
 * Every control is at least 2.75rem high and wide, more than the 24 CSS pixels of the target size criterion. The current
 * question has a heavier border and a mark, and every state is written.
 *
 * @see {@link https://www.w3.org/TR/WCAG22/#target-size-minimum | WCAG 2.2, target size}
 */
const CHROME_CSS = `
.ak-player { gap: 1rem; padding: 0.75rem; }
.ak-layout { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 48rem) { .ak-layout[data-ak-map] { grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr); } }
.ak-nav ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.25rem; }
.ak-nav li { padding-inline-start: calc(var(--ak-depth, 0) * 1rem); }
.ak-nav-section { font-weight: 700; padding-block: 0.5rem 0.25rem; }
.ak-nav-item { display: block; width: 100%; box-sizing: border-box; min-height: 2.75rem; padding: 0.25rem 0.75rem; font: inherit;
  text-align: start; color: CanvasText; background: Canvas; border: 1px solid CanvasText; border-radius: 0.375rem; cursor: pointer; }
.ak-nav-item[aria-current="true"] { border-width: 3px; font-weight: 700; }
.ak-nav-item[aria-current="true"]::before { content: "\\25B6\\00A0"; }
.ak-nav-item:disabled { color: GrayText; border-style: dashed; cursor: not-allowed; }
.ak-nav-status { font-weight: 400; }
.ak-timers { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem; border: 2px solid CanvasText;
  border-radius: 0.5rem; }
.ak-timer-list { display: flex; flex-wrap: wrap; gap: 0.25rem 1.5rem; margin: 0; padding: 0; list-style: none; }
.ak-time { font-variant-numeric: tabular-nums; font-weight: 700; }
.ak-heading { margin: 0 0 0.5rem; font-size: 1.5rem; }
.ak-heading:focus-visible { outline: 3px solid CanvasText; outline-offset: 2px; }
.ak-notice { margin: 0 0 0.5rem; padding: 0.5rem 0.75rem; border: 2px solid CanvasText; border-radius: 0.375rem; }
.ak-attempts { margin: 0.5rem 0 0; }
.ak-actions { display: grid; gap: 0.5rem; }
.ak-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.ak-button { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 2.75rem;
  min-height: 2.75rem; padding: 0 1rem; font: inherit; color: CanvasText; background: color-mix(in srgb, CanvasText 10%, Canvas);
  border: 2px solid CanvasText; border-radius: 0.375rem; cursor: pointer; }
.ak-button:disabled { color: GrayText; border-style: dashed; cursor: not-allowed; }
.ak-comment { display: grid; gap: 0.5rem; margin-top: 1rem; }
.ak-comment textarea { box-sizing: border-box; width: 100%; min-height: 6rem; font: inherit; color: CanvasText; background: Canvas;
  border: 2px solid CanvasText; border-radius: 0.375rem; }
.ak-confirm { max-width: 32rem; color: CanvasText; background: Canvas; border: 3px solid CanvasText; border-radius: 0.5rem; }
.ak-confirm::backdrop { background: color-mix(in srgb, CanvasText 55%, transparent); }
.ak-confirm :focus-visible { ${FOCUS_RING} }
`;

/**
 * Returns the stylesheet of the chrome, the same one for every mount.
 *
 * @returns The sheet.
 */
export const chromeStyles = lazyStyleSheet(CHROME_CSS);
