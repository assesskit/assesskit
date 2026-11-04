/**
 * Values of QTI variables: base types, cardinalities and NULL, their lexical forms in XML, equality and promotion, the
 * JSON forms of a value for portable custom interactions and for state, base64, and the linear-time regular
 * expressions of XML Schema.
 *
 * @module @assesskit/runtime/values
 */

export { BASE_TYPES, type BaseType } from "./base-type.js";
export { decodeBase64, decodeBase64Url, encodeBase64 } from "./base64.js";
export type { Cardinality } from "./cardinality.js";
export type { ValueDeclaration } from "./declaration.js";
export { isIdentifier } from "./identifier.js";
export type { JsonValue } from "./json-value.js";
export { formatPrimitive } from "./lexical.js";
export { matchValues } from "./match.js";
export type { FileValue, Pair, Point, Primitive } from "./primitive.js";
export { type PromotionTarget, promote } from "./promote.js";
export {
  buildContainer,
  buildRecord,
  buildSingle,
  type ContainerValue,
  normalizeValue,
  type RecordValue,
  type SingleValue,
  type Value,
} from "./value.js";
export { readWireValue, type WireValue, type WriteWireValueOptions, writeWireValue } from "./wire.js";
export { isXsdDateTime } from "./xsd-date-time.js";
export {
  type CompileXsdRegexOptions,
  compileXsdRegex,
  DEFAULT_XSD_REGEX_LIMITS,
  type XsdRegexLimits,
} from "./xsd-regex.js";
export type { XsdPattern } from "./xsd-regex-matcher.js";
