/** Helpers that other modules of the package share. They are not part of the public API. */
export { elementBuilder } from "./build-element.js";
export { createTermConverter, ElementReader, type ReaderRules } from "./element-reader.js";
export { isXmlLanguage } from "./language.js";
export { exceedsBytes } from "./parse.js";
export { createReadError, locateElement } from "./read-error.js";
export { XMLNS_NAMESPACE, XSI_NAMESPACE } from "./tree.js";
