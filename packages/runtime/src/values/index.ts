/**
 * Values of QTI variables: base types, cardinalities and NULL, their lexical forms in XML, equality and promotion, the
 * JSON forms of a value for portable custom interactions and for state, base64, and the linear-time regular
 * expressions of XML Schema.
 *
 * @module @assesskit/runtime/values
 */

export { BASE_TYPES, type BaseType, isBaseType } from "./base-type.js";
export { decodeBase64, decodeBase64Url, encodeBase64, encodeBase64Url } from "./base64.js";
export { CARDINALITIES, type Cardinality, isCardinality } from "./cardinality.js";
export type { ValueDeclaration } from "./declaration.js";
export { parseIsoDuration } from "./duration.js";
export { isIdentifier } from "./identifier.js";
export { fromJsonValue } from "./json-read.js";
export type { JsonValue } from "./json-value.js";
export { toJsonValue } from "./json-write.js";
export { formatPrimitive, parsePrimitive } from "./lexical.js";
export { formatIdentifierList, formatIntegerList, parseIdentifierList, parseIntegerList } from "./lists.js";
export { matchValues } from "./match.js";
export type { FileValue, Pair, Point, Primitive } from "./primitive.js";
export { type PromotionTarget, promote } from "./promote.js";
export { UNICODE_VERSION } from "./unicode-categories.js";
export {
  type ContainerValue,
  container,
  normalizeValue,
  type RecordValue,
  record,
  type SingleValue,
  single,
  type Value,
} from "./value.js";
export { fromWireValue, toWireValue, type WireValue } from "./wire.js";
export { isXsdDate, isXsdDateTime } from "./xsd-date-time.js";
export {
  type CompileXsdRegexOptions,
  compileXsdRegex,
  DEFAULT_XSD_REGEX_LIMITS,
  type XsdRegexLimits,
} from "./xsd-regex.js";
export type { XsdPattern } from "./xsd-regex-matcher.js";
