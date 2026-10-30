/**
 * The stylesheet of the tools. It uses the system colors, so that the tools follow the color scheme and the forced
 * colors of the browser, and sizes in `rem`, so that they follow the text size. Every control is at least 2.75rem, more
 * than the 24 CSS pixels of WCAG 2.5.8.
 *
 * Text and background always come from the pair `CanvasText` and `Canvas`, or from a mix of the two. `ButtonText` and
 * `ButtonFace` are no pair: in a dark color scheme the WebKit of Linux gives white text on a light gray face, 1.8:1
 * (WCAG 1.4.3), so the controls do not use them, and neither do the fields.
 */
const TOOLS_CSS = `
.tempuh-tools { display: grid; gap: 0.75rem; color: CanvasText; background: Canvas; }
.tempuh-tools [hidden], .tempuh-tool-layer [hidden], .tempuh-mask [hidden] { display: none !important; }
.tempuh-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.tempuh-tray { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0.75rem; }
.tempuh-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem;
  box-sizing: border-box; min-width: 2.75rem; min-height: 2.75rem; padding: 0 0.75rem; font: inherit;
  color: CanvasText; background: color-mix(in srgb, CanvasText 10%, Canvas); border: 2px solid CanvasText;
  border-radius: 0.375rem; cursor: pointer; }
.tempuh-button[aria-pressed="true"] { color: Canvas; background: CanvasText; font-weight: 700;
  box-shadow: inset 0 -0.25rem 0 currentColor; }
.tempuh-button img { width: 1.5rem; height: 1.5rem; }
.tempuh-tools :focus-visible, .tempuh-tool-layer :focus-visible, .tempuh-mask :focus-visible {
  outline: 3px solid CanvasText; outline-offset: 2px; box-shadow: 0 0 0 2px Canvas; }
.tempuh-physical { padding: 0.75rem; border: 2px solid CanvasText; border-radius: 0.5rem; }
.tempuh-physical h3, .tempuh-panel h3 { margin: 0; font-size: 1.125rem; }
.tempuh-physical ul { margin: 0.5rem 0 0; padding-left: 1.25rem; }
.tempuh-panel { display: grid; gap: 0.75rem; box-sizing: border-box; max-width: 100%; padding: 0.75rem;
  color: CanvasText; background: Canvas; border: 2px solid CanvasText; border-radius: 0.5rem; }
.tempuh-panel p { margin: 0; }
.tempuh-panel-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.tempuh-controls { display: grid; grid-template-columns: repeat(3, 2.75rem); gap: 0.25rem; }
.tempuh-rotate-left { grid-area: 1 / 1; }
.tempuh-move-up { grid-area: 1 / 2; }
.tempuh-rotate-right { grid-area: 1 / 3; }
.tempuh-move-left { grid-area: 2 / 1; }
.tempuh-move-right { grid-area: 2 / 3; }
.tempuh-move-down { grid-area: 3 / 2; }
.tempuh-field { display: flex; align-items: center; gap: 0.5rem; }
.tempuh-field input { box-sizing: border-box; width: 5rem; min-height: 2.75rem; font: inherit; color: CanvasText;
  background: Canvas; border: 2px solid CanvasText; border-radius: 0.375rem; }
.tempuh-viewer img, .tempuh-viewer video, .tempuh-viewer iframe { display: block; max-width: 100%; }
.tempuh-viewer iframe { width: 100%; height: 24rem; border: 1px solid CanvasText; }
.tempuh-viewer audio { width: 100%; }
.tempuh-calculator { display: grid; gap: 0.5rem; width: 16rem; max-width: 100%; }
.tempuh-screen { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; background: Canvas;
  border: 2px solid CanvasText; }
.tempuh-display { flex: 1; min-height: 2rem; font: 1.5rem monospace; text-align: right; overflow-wrap: anywhere; }
.tempuh-memory { font-weight: 700; }
.tempuh-keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.25rem; }
.tempuh-keys .tempuh-button { padding: 0; }
.tempuh-tool-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 1; }
.tempuh-placed { position: absolute; left: 0; top: 0; touch-action: none; cursor: move; pointer-events: none; }
.tempuh-placed svg { display: block; pointer-events: none; }
.tempuh-surface, .tempuh-ticks, .tempuh-scale-text { pointer-events: auto; }
.tempuh-surface { fill: color-mix(in srgb, Canvas 78%, transparent); stroke: CanvasText; stroke-width: 1.5; }
.tempuh-ticks { fill: none; stroke: CanvasText; stroke-width: 1; }
.tempuh-scale-text { fill: CanvasText; font: 11px sans-serif; text-anchor: middle; }
.tempuh-line-reader { position: absolute; left: 0; right: 0; box-sizing: border-box; pointer-events: none;
  background: color-mix(in srgb, var(--tempuh-line-color, #ffd400) 40%, transparent); }
.tempuh-line-reader:focus-visible { outline-offset: -3px; }
qti-choice-interaction[data-tempuh-masked] qti-simple-choice { display: none !important; }
.tempuh-mask { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding: 0.75rem;
  border: 2px dashed CanvasText;
  background: repeating-linear-gradient(135deg, color-mix(in srgb, CanvasText 14%, Canvas) 0 0.5rem, Canvas 0.5rem 1rem); }
.tempuh-mask-notice { padding: 0.25rem 0.5rem; color: CanvasText; background: Canvas; }
.tempuh-visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; }
`;

/** The stylesheet, built when the first mount needs it. */
let sheet: CSSStyleSheet | undefined;

/** How many mounts use the stylesheet in each root, so that the last one to go takes it away. */
const users = new Map<Document | ShadowRoot, number>();

function toolSheet(): CSSStyleSheet {
  if (sheet === undefined) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(TOOLS_CSS);
  }
  return sheet;
}

/** Returns the root a node is in, which holds the stylesheets that apply to it, or `null` for a node outside a document. */
function styleRoot(node: Node): Document | ShadowRoot | null {
  const root = node.getRootNode();
  return root instanceof Document || root instanceof ShadowRoot ? root : null;
}

/**
 * Adopts the stylesheet of the tools into the document or shadow root that holds `node`.
 *
 * @returns a function that releases it; the root drops the stylesheet when no mount uses it any more.
 */
export function adoptToolStyles(node: Node): () => void {
  const root = styleRoot(node);
  if (root === null) return () => undefined;
  const adopted = toolSheet();
  const count = users.get(root) ?? 0;
  users.set(root, count + 1);
  if (count === 0) root.adoptedStyleSheets = [...root.adoptedStyleSheets, adopted];
  return () => {
    const remaining = (users.get(root) ?? 1) - 1;
    if (remaining > 0) {
      users.set(root, remaining);
      return;
    }
    users.delete(root);
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter((other) => other !== adopted);
  };
}
