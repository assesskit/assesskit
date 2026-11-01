/**
 * Helpers that the folders of the player share: building DOM, adopting stylesheets, formatting numbers and the namespaces of
 * content.
 *
 * @remarks
 * The package does not export them.
 *
 * @module
 */
export { createStyleAdopter, lazyStyleSheet } from "./adopt.js";
export { clockText } from "./clock-text.js";
export { deepActiveElement, html, svg, uniqueId } from "./dom.js";
export { isFileValue } from "./file-value.js";
export { CML_NAMESPACE, MATHML_NAMESPACE, SSML_NAMESPACE, XHTML_NAMESPACE } from "./namespaces.js";
export { numberFormatter } from "./numbers.js";
export { canMount, HOST_SHADOW_RULE, shadowRootOf } from "./shadow.js";
