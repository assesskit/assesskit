import { checkPositiveInteger, checkRecord } from "../checks.js";

/** The limits that keep a document from using more memory or time than a caller allows. */
export interface XmlLimits {
  /**
   * The most bytes of UTF-8 a document may have.
   *
   * @defaultValue `10485760` (10 MiB)
   */
  readonly maxBytes: number;
  /**
   * The deepest nesting of elements, counting the root as depth 1. It bounds the recursion of every reader, writer and
   * interpreter that walks a tree, expressions included.
   *
   * @defaultValue `256`
   */
  readonly maxDepth: number;
  /**
   * The most attributes one element may have, namespace declarations included.
   *
   * @defaultValue `256`
   */
  readonly maxAttributes: number;
  /**
   * The most nodes a tree may have: elements, text, CDATA sections, comments and processing instructions.
   *
   * @defaultValue `300000`
   */
  readonly maxNodes: number;
  /**
   * The deepest nesting of XInclude: a document that includes a document that includes another is depth 2.
   *
   * @defaultValue `8`
   */
  readonly maxIncludeDepth: number;
}

/**
 * The default limits.
 *
 * @remarks
 * The largest document of the 1EdTech QTI 3.0 examples has 32 KiB, depth 16, 12 attributes on an element and 1,126 nodes.
 * `maxBytes` and `maxNodes` are about 300 times those, `maxDepth` 16 times and `maxAttributes` 20 times.
 * `maxIncludeDepth` is a convention of the runtime.
 *
 * The memory of a reading follows the nodes and the attributes it builds more than the bytes, and `maxBytes` and `maxNodes` are
 * set so that the worst document within both, read by any reader of the runtime, keeps at most 256 MiB of heap alive. A host
 * with more memory raises them together: each MiB of `maxBytes` with 30,000 `maxNodes` costs up to 20 MiB of heap.
 */
export const DEFAULT_XML_LIMITS: XmlLimits = {
  maxBytes: 10_485_760,
  maxDepth: 256,
  maxAttributes: 256,
  maxNodes: 300_000,
  maxIncludeDepth: 8,
};

/**
 * Returns the default limits with the given ones in place of theirs.
 *
 * @param limits - The limits to change; a limit left out keeps its default.
 * @returns All the limits.
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
