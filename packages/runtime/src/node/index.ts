/**
 * Node.js only: validation of XML documents against the official XSD schemas, compiled with libxml2 in WebAssembly, and
 * QTI content packages read from files and directories.
 *
 * @module @assesskit/runtime/node
 */
export { readPackageFile } from "./package-file.js";
export { defaultSchemaDirectory } from "./schema-directory.js";
export { SCHEMA_FILES, type SchemaFile } from "./schema-files.js";
export { loadSchemaSet, type SchemaSet } from "./schema-set.js";
export { validateXmlFiles, type XmlFile } from "./validate-xml-files.js";
