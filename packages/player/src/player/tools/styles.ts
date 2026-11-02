import { createStyleAdopter } from "../internal.js";

/**
 * The look of a button of the tools.
 *
 * @remarks
 * Text and background always come from the pair `CanvasText` and `Canvas`, or from a mix of the two. `ButtonText` and
 * `ButtonFace` are no pair: in a dark color scheme the WebKit of Linux gives white text on a light gray face, with a
 * contrast ratio of 1.8:1, so the controls do not use them, and neither do the fields.
 *
 * @see {@link https://www.w3.org/TR/WCAG22/#contrast-minimum | WCAG 2.2, contrast minimum}
 */
const BUTTON_CSS = `display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem;
  box-sizing: border-box; min-width: 2.75rem; min-height: 2.75rem; padding: 0 0.75rem; font: inherit;
  color: CanvasText; background: color-mix(in srgb, CanvasText 10%, Canvas); border: 2px solid CanvasText;
  border-radius: 0.375rem; cursor: pointer;`;

/**
 * The stylesheet of the toolbar and the panels, which live in the chrome.
 *
 * @remarks
 * The tools use the system colors, so that they follow the color scheme and the forced colors of the browser, and sizes in
 * `rem`, so that they follow the text size. Every control is at least 2.75rem, more than the 24 CSS pixels of the target
 * size criterion.
 *
 * @see {@link https://www.w3.org/TR/WCAG22/#target-size-minimum | WCAG 2.2, target size}
 */
const TOOLS_CSS = `
.ak-tools { display: grid; gap: 0.75rem; color: CanvasText; background: Canvas; }
.ak-tools [hidden] { display: none !important; }
.ak-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.ak-tray { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0.75rem; }
.ak-button { ${BUTTON_CSS} }
.ak-button[aria-pressed="true"] { color: Canvas; background: CanvasText; font-weight: 700;
  box-shadow: inset 0 -0.25rem 0 currentColor; }
.ak-button img { width: 1.5rem; height: 1.5rem; }
.ak-tools :focus-visible {
  outline: 3px solid CanvasText; outline-offset: 2px; box-shadow: 0 0 0 2px Canvas; }
.ak-physical { padding: 0.75rem; border: 2px solid CanvasText; border-radius: 0.5rem; }
.ak-physical h3, .ak-panel h3 { margin: 0; font-size: 1.125rem; }
.ak-panel ul { display: grid; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.ak-mark-item { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.ak-mark-item span { overflow-wrap: anywhere; }
.ak-physical ul { margin: 0.5rem 0 0; padding-left: 1.25rem; }
.ak-panel { display: grid; gap: 0.75rem; box-sizing: border-box; max-width: 100%; padding: 0.75rem;
  color: CanvasText; background: Canvas; border: 2px solid CanvasText; border-radius: 0.5rem; }
.ak-panel p { margin: 0; }
.ak-panel-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.ak-controls { display: grid; grid-template-columns: repeat(3, 2.75rem); gap: 0.25rem; }
.ak-rotate-left { grid-area: 1 / 1; }
.ak-move-up { grid-area: 1 / 2; }
.ak-rotate-right { grid-area: 1 / 3; }
.ak-move-left { grid-area: 2 / 1; }
.ak-move-right { grid-area: 2 / 3; }
.ak-move-down { grid-area: 3 / 2; }
.ak-field { display: flex; align-items: center; gap: 0.5rem; }
.ak-field input, .ak-field select { box-sizing: border-box; min-height: 2.75rem; font: inherit; color: CanvasText;
  background: Canvas; border: 2px solid CanvasText; border-radius: 0.375rem; }
.ak-field input { width: 5rem; }
.ak-viewer img, .ak-viewer video, .ak-viewer iframe { display: block; max-width: 100%; }
.ak-viewer iframe { width: 100%; height: 24rem; border: 1px solid CanvasText; }
.ak-viewer audio { width: 100%; }
.ak-calculator { display: grid; gap: 0.5rem; width: 16rem; max-width: 100%; }
.ak-screen { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; background: Canvas;
  border: 2px solid CanvasText; }
.ak-readout { flex: 1; display: grid; min-width: 0; }
.ak-calculation { min-height: 1.25rem; font: 0.875rem monospace; text-align: right; overflow-wrap: anywhere; }
.ak-display { min-height: 2rem; font: 1.5rem monospace; text-align: right; overflow-wrap: anywhere; }
.ak-memory { font-weight: 700; }
.ak-scientific { width: 20rem; }
.ak-keys { display: grid; grid-template-columns: repeat(20, 1fr); gap: 0.25rem; }
.ak-keys .ak-button { padding: 0; }
`;

/**
 * The stylesheet of what the tools put over the item: the layer with the rule and the protractor, the line reader, the
 * marks of the highlighter, and the masks and the buttons of the answers.
 *
 * @remarks
 * It is adopted into the root that holds the item, so every rule names a class of the tools, which the content does not
 * use, and the classes the interactions share with the chrome, such as `ak-surface`, are reached only inside the layer.
 */
const STAGE_CSS = `
.ak-tool-layer [hidden], .ak-mask [hidden] { display: none !important; }
.ak-tool-layer :focus-visible, .ak-mask :focus-visible {
  outline: 3px solid CanvasText; outline-offset: 2px; box-shadow: 0 0 0 2px Canvas; }
.ak-tool-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 1; }
.ak-placed { position: absolute; left: 0; top: 0; touch-action: none; cursor: move; pointer-events: none; }
.ak-placed svg { display: block; pointer-events: none; }
.ak-placed .ak-surface, .ak-placed .ak-ticks, .ak-placed .ak-scale-text { pointer-events: auto; }
.ak-placed .ak-surface { fill: color-mix(in srgb, Canvas 78%, transparent); stroke: CanvasText; stroke-width: 1.5; }
.ak-placed .ak-ticks { fill: none; stroke: CanvasText; stroke-width: 1; }
.ak-placed .ak-scale-text { fill: CanvasText; font: 11px sans-serif; text-anchor: middle; }
.ak-line-reader { position: absolute; left: 0; right: 0; box-sizing: border-box; pointer-events: none;
  background: color-mix(in srgb, var(--ak-line-color, #ffd400) 40%, transparent); }
.ak-line-reader:focus-visible { outline-offset: -3px; }
qti-choice-interaction[data-ak-masked] qti-simple-choice { display: none !important; }
.ak-mask { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding: 0.75rem;
  border: 2px dashed CanvasText;
  background: repeating-linear-gradient(135deg, color-mix(in srgb, CanvasText 14%, Canvas) 0 0.5rem, Canvas 0.5rem 1rem); }
.ak-mask .ak-button { ${BUTTON_CSS} }
.ak-mask-notice { padding: 0.25rem 0.5rem; color: CanvasText; background: Canvas; }
.ak-highlights { position: absolute; inset: 0; }
.ak-marks { position: absolute; inset: 0; }
.ak-mark { position: absolute; box-sizing: border-box; pointer-events: none; forced-color-adjust: none;
  background: color-mix(in srgb, #ffd400 45%, transparent); }
.ak-mark-pending { background: none; border: 2px dashed CanvasText; }
.ak-caret { position: absolute; box-sizing: border-box; pointer-events: none; border-bottom: 3px solid CanvasText; }
.ak-caret:focus-visible { outline-offset: 0; }
.ak-highlights .ak-visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; }
.ak-eliminate { ${BUTTON_CSS} min-width: 1.75rem; min-height: 1.75rem; padding: 0 0.5rem; font-size: 0.875em;
  flex: none; }
.ak-eliminate[aria-pressed="true"] { color: Canvas; background: CanvasText; font-weight: 700; }
qti-simple-choice[data-ak-struck] > .ak-face { text-decoration: line-through; }
.ak-placed .ak-visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; }
`;

/**
 * Adopts the stylesheet of the toolbar and the panels into the document or shadow root that holds a node.
 *
 * @param node - The node.
 * @returns A function that releases it; the root drops the stylesheet when no mount uses it any more.
 */
export const adoptToolStyles = createStyleAdopter(TOOLS_CSS);

/**
 * Adopts the stylesheet of what lies over the item into the document or shadow root that holds a node.
 *
 * @param node - The node.
 * @returns A function that releases it; the root drops the stylesheet when no mount uses it any more.
 */
export const adoptStageStyles = createStyleAdopter(STAGE_CSS);
