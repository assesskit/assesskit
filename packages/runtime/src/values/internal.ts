/**
 * What other modules and the tests of the runtime use of `values` and the package does not export.
 *
 * @module
 */
export { baseTypeSchema, isBaseType } from "./base-type.js";
export { CARDINALITIES, cardinalitySchema, isCardinality } from "./cardinality.js";
export { parseDuration } from "./duration.js";
export { readJsonValue } from "./json-read.js";
export { writeJsonValue } from "./json-write.js";
export { optionalText, parsePrimitive } from "./lexical.js";
export { formatIdentifierList, parseIdentifierList } from "./lists.js";
export { primitiveKey } from "./primitive-key.js";
export { wireValueSchema } from "./wire.js";
export { xmlTokens } from "./xml-tokens.js";
export { isXsdDate } from "./xsd-date-time.js";
