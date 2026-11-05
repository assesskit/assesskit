/**
 * What the tests of the runtime, the compiler of `scoring` and the readers of `item-formats` use of `operators`, which the package
 * does not export.
 *
 * @module
 */
export {
  buildCallReading,
  deriveEarlierReading,
  readAreasKey,
  readNumberKey,
  readTextKey,
} from "./build-operator-call.js";
export { writeCanonicalJson } from "./canonical-json.js";
export { asin, complex } from "./complex.js";
export { listGraphemes } from "./count-length.js";
export { OPERATOR_NAMES } from "./definitions.js";
export { boundedEditDistance } from "./edit-distance.js";
export { evaluate } from "./evaluate.js";
export { maximumMatching } from "./matching.js";
export { type EarlierReading, parseOptions } from "./options.js";
export { isVariableName, readStatement } from "./read.js";
export { fnv1a32 } from "./sample.js";
export { areaSchema, type NumberKeyData } from "./schemas.js";
export type { PreparedText } from "./text-equivalent.js";
