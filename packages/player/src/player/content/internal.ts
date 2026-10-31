/**
 * Helpers of the content renderer that other folders of the player and its tests use.
 *
 * @remarks
 * The package does not export them.
 *
 * @module
 */
export { scaleSize } from "./attributes.js";
export { canAnimate, essence } from "./embed.js";
export { elementName, HTML_ELEMENT_NAMES, isHtmlName } from "./html-elements.js";
export { readRenderOptions } from "./options.js";
export { resolveSrcset } from "./srcset.js";
export { isRasterDataUrl, readOrigins, resolveUrl, type UrlPolicy } from "./urls.js";
