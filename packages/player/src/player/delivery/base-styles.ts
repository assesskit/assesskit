import { lazyStyleSheet } from "../internal.js";

/** The ring around the control that has the focus: 3 CSS pixels, with a halo of the background so that it shows on any color. */
export const FOCUS_RING = "outline: 3px solid CanvasText; outline-offset: 2px; box-shadow: 0 0 0 2px Canvas;";

/**
 * The stylesheet that every mount of the player shares: the colors, the container, the content, the supports and the status
 * region.
 *
 * @remarks
 * Like the tools it uses the system colors, so that it follows the color scheme and the forced colors of the browser, and
 * sizes in `rem`, so that it follows the text size. Nothing relies on color alone.
 *
 * The status regions keep the room of a line whether or not they hold text. A region that took room only with its text would
 * move whatever follows it when a message is written, and a button that moves between the press and the release of a
 * pointer gets no click.
 *
 * @see {@link https://www.w3.org/TR/WCAG22/#use-of-color | WCAG 2.2, use of color}
 */
const BASE_CSS = `
:host { display: block; color: CanvasText; background: Canvas; }
.ak-player, .ak-item { display: grid; font-family: system-ui, sans-serif; }
.ak-player [hidden], .ak-item [hidden] { display: none !important; }
.ak-supports-slot > :not([hidden]) { margin: 0 0 0.5rem; }
.ak-content-host { display: block; }
.ak-player :focus-visible, .ak-item :focus-visible { ${FOCUS_RING} }
.ak-status, .ak-timer-status { min-height: 1.5rem; margin: 0; padding: 0.25rem 0; font-weight: 700; }
.ak-item { gap: 0.5rem; }
`;

/**
 * Returns the stylesheet that every mount shares, the same one for every mount.
 *
 * @returns The sheet.
 */
export const baseStyles = lazyStyleSheet(BASE_CSS);
