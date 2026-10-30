/**
 * A secure reader and a writer of XML 1.0 documents, as an immutable tree, and XInclude resolution.
 *
 * @module @luthfanwakan/olah/xml
 */
export { buildElement } from "./build-element.js";
export { ElementReader, type ReaderRules } from "./element-reader.js";
export { type IncludeResolver, type ResolveIncludesOptions, resolveIncludes } from "./include.js";
export { isXmlLanguage } from "./language.js";
export { DEFAULT_XML_LIMITS, type XmlLimits } from "./limits.js";
export { type ParseXmlOptions, parseXml } from "./parse.js";
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
