/**
 * A secure reader and a writer of XML 1.0 documents, as an immutable tree, access to the tree, and XInclude resolution.
 *
 * @module @assesskit/runtime/xml
 */
export { buildElement, type ElementAttributes } from "./build-element.js";
export { ElementReader, type ReaderRules, termOf } from "./element-reader.js";
export { type IncludeResolver, type ResolveIncludesOptions, resolveIncludes } from "./include.js";
export { isXmlLanguage } from "./language.js";
export { DEFAULT_XML_LIMITS, type XmlLimits } from "./limits.js";
export { type ParseXmlOptions, parseXml } from "./parse.js";
export { attributeOf, childElements, textOf } from "./query.js";
export { locationOf, readError } from "./read-error.js";
export { serializeXml } from "./serialize.js";
export {
  XINCLUDE_NAMESPACE,
  XML_NAMESPACE,
  XMLNS_NAMESPACE,
  type XmlAttribute,
  type XmlCharacterData,
  type XmlElement,
  type XmlInstruction,
  type XmlNode,
  XSI_NAMESPACE,
} from "./tree.js";
