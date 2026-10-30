import { checkPositiveInteger, checkRecord } from "../checks.js";

/** The limits that keep a document from using more memory or time than a caller allows. */
export interface XmlLimits {
  /** The most bytes of UTF-8 a document may have. Default: `33554432` (32 MiB). */
  readonly maxBytes: number;
  /**
   * The deepest nesting of elements, counting the root as depth 1. It bounds the recursion of every reader, writer and
   * interpreter that walks a tree, expressions included. Default: `256`.
   */
  readonly maxDepth: number;
  /** The most attributes one element may have, namespace declarations included. Default: `256`. */
  readonly maxAttributes: number;
  /**
   * The most nodes a tree may have: elements, text, CDATA sections, comments and processing instructions. Default:
   * `1000000`.
   */
  readonly maxNodes: number;
  /** The deepest nesting of XInclude: a document that includes a document that includes another is depth 2. Default: `8`. */
  readonly maxIncludeDepth: number;
}

/**
 * The default limits. The largest document of the 1EdTech QTI 3.0 examples has 32 KiB, depth 16, 12 attributes on an
 * element and 1,126 nodes; `maxBytes` and `maxNodes` are about 1,000 times those, `maxDepth` 16 times and
 * `maxAttributes` 20 times. `maxIncludeDepth` is 8 (olah convention).
 */
export const DEFAULT_XML_LIMITS: XmlLimits = {
  maxBytes: 33_554_432,
  maxDepth: 256,
  maxAttributes: 256,
  maxNodes: 1_000_000,
  maxIncludeDepth: 8,
};

/**
 * Returns the default limits with the given ones in place of theirs.
 *
 * @throws `DataError` when `limits` is not an object or a limit is not a positive integer.
 */
export function resolveXmlLimits(limits: Partial<XmlLimits>): XmlLimits {
  checkRecord(limits, "The option limits must be an object");
  const {
    maxBytes = DEFAULT_XML_LIMITS.maxBytes,
    maxDepth = DEFAULT_XML_LIMITS.maxDepth,
    maxAttributes = DEFAULT_XML_LIMITS.maxAttributes,
    maxNodes = DEFAULT_XML_LIMITS.maxNodes,
    maxIncludeDepth = DEFAULT_XML_LIMITS.maxIncludeDepth,
  } = limits;
  checkPositiveInteger(maxBytes, "The limit maxBytes");
  checkPositiveInteger(maxDepth, "The limit maxDepth");
  checkPositiveInteger(maxAttributes, "The limit maxAttributes");
  checkPositiveInteger(maxNodes, "The limit maxNodes");
  checkPositiveInteger(maxIncludeDepth, "The limit maxIncludeDepth");
  return { maxBytes, maxDepth, maxAttributes, maxNodes, maxIncludeDepth };
}
