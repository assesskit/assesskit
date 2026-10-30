/**
 * Node.js only: validation of XML documents against the official XSD schemas, compiled with libxml2 in WebAssembly.
 *
 * @module @luthfanwakan/olah/node
 */
export { SCHEMA_FILES, type SchemaFile } from "./schema-files.js";
export { loadSchemaSet, type SchemaSet } from "./schema-set.js";
export { validateXmlFiles, type XmlFile } from "./validate-xml-files.js";
