import { checkFunction, checkOptions, checkRecord, checkString, describe, isRecord } from "../checks.js";
import { DataError, type IssueLocation, type ReadError, SecurityError } from "../errors.js";
import { resolveXmlLimits, type XmlLimits } from "./limits.js";
import { attributeOf } from "./query.js";
import { locationOf, readError } from "./read-error.js";
import { XINCLUDE_NAMESPACE, type XmlElement, type XmlNode } from "./tree.js";

/**
 * A function that returns the parsed root element of the document an `xi:include` names.
 *
 * @param href - The `href` as written.
 * @param base - The path of the document that contains the include.
 */
export type IncludeResolver = (href: string, base: string) => XmlElement;

/** Options of {@link resolveIncludes}. */
export interface ResolveIncludesOptions {
  /** Limits that replace the defaults, field by field; `maxDepth`, `maxNodes` and `maxIncludeDepth` apply. Default: {@link DEFAULT_XML_LIMITS}. */
  readonly limits?: Partial<XmlLimits>;
}

/** Where an element is read: the path of its document, the chain of documents that led to it and its depth. */
interface Context {
  readonly base: string;
  readonly chain: readonly string[];
  readonly depth: number;
}

const INFO_INCLUDE = "INFO §2.12";
const INCLUDE_SYNTAX = "XInclude 1.0 §3.1";
const FALLBACK_SYNTAX = "XInclude 1.0 §3.2";

/** The start of an absolute reference: a scheme (RFC 3986 §3.1). */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Returns the path that a reference names from a base, with the `.` and `..` segments resolved (RFC 3986 §5.2.4). */
function joinReference(base: string, reference: string): string {
  if (reference.startsWith("/") || SCHEME.test(reference)) return reference;
  const segments: string[] = [];
  for (const segment of `${base.slice(0, base.lastIndexOf("/") + 1)}${reference}`.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== ".") segments.push(segment);
  }
  return segments.join("/");
}

/** Returns the local name of a node that is an element of the XInclude namespace. */
function xincludeName(node: XmlNode): string | undefined {
  return node.kind === "element" && node.namespace === XINCLUDE_NAMESPACE ? node.name : undefined;
}

function isFallback(node: XmlNode): node is XmlElement {
  return xincludeName(node) === "fallback";
}

/** Expands the `xi:include` elements of a tree, counting the nodes of the result against the limits. */
class Expander {
  private readonly limits: XmlLimits;
  private readonly resolve: IncludeResolver;
  private nodes = 0;

  constructor(limits: XmlLimits, resolve: IncludeResolver) {
    this.limits = limits;
    this.resolve = resolve;
  }

  private count(): void {
    if (++this.nodes > this.limits.maxNodes) {
      const { maxNodes } = this.limits;
      throw new SecurityError(
        `The document with its includes has more nodes than the limit maxNodes of ${maxNodes}.`,
        "maxNodes",
        maxNodes,
      );
    }
  }

  private checkDepth(depth: number): void {
    if (depth > this.limits.maxDepth) {
      const { maxDepth } = this.limits;
      throw new SecurityError(
        `The document with its includes nests elements deeper than the limit maxDepth of ${maxDepth}.`,
        "maxDepth",
        maxDepth,
      );
    }
  }

  expandNodes(nodes: readonly XmlNode[], context: Context): XmlNode[] {
    return nodes.flatMap((node) => this.expandNode(node, context));
  }

  expandNode(node: XmlNode, context: Context): XmlNode[] {
    if (node.kind !== "element") {
      this.count();
      return [node];
    }
    const name = xincludeName(node);
    if (name === "include") return this.include(node, context);
    if (name === "fallback") {
      throw readError(
        "olah/xml/xinclude-structure",
        "An xi:fallback must be a child of an xi:include.",
        FALLBACK_SYNTAX,
        locationOf(node, context.base),
      );
    }
    this.checkDepth(context.depth);
    const children = this.expandNodes(node.children, { ...context, depth: context.depth + 1 });
    this.count();
    return [{ ...node, children }];
  }

  /** Returns the href of an include after checking its attributes and children. */
  private checkInclude(include: XmlElement, context: Context): string {
    const location = locationOf(include, context.base);
    const fail = (message: string, source: string, code = "olah/xml/xinclude-attribute"): ReadError =>
      readError(code, message, source, location);
    if (attributeOf(include, "xpointer") !== undefined) {
      throw fail("An xi:include must not have an xpointer attribute.", INFO_INCLUDE);
    }
    const parse = attributeOf(include, "parse") ?? "xml";
    if (parse !== "xml") {
      throw fail(`An xi:include must include parsed XML, found parse=${JSON.stringify(parse)}.`, INFO_INCLUDE);
    }
    const href = attributeOf(include, "href");
    if (href === undefined || href === "") {
      throw fail("An xi:include must have a non-empty href attribute.", INCLUDE_SYNTAX);
    }
    if (href.includes("#")) {
      const message = `The href ${JSON.stringify(href)} of an xi:include must not have a fragment identifier.`;
      throw fail(message, INCLUDE_SYNTAX);
    }
    const foreign = include.children.filter((child) => xincludeName(child) !== undefined);
    if (foreign.length > 1 || foreign.some((child) => !isFallback(child))) {
      throw fail(
        "An xi:include may have one xi:fallback child and no other element of the XInclude namespace.",
        INCLUDE_SYNTAX,
        "olah/xml/xinclude-structure",
      );
    }
    return href;
  }

  private include(include: XmlElement, context: Context): XmlNode[] {
    const href = this.checkInclude(include, context);
    const fallback = include.children.find(isFallback);
    const key = joinReference(context.base, href);
    if (context.chain.includes(key)) {
      const message = `The xi:include of ${JSON.stringify(href)} includes a document that is already being included.`;
      throw readError("olah/xml/xinclude-cycle", message, "XInclude 1.0 §4.2.7", locationOf(include, context.base));
    }
    if (context.chain.length > this.limits.maxIncludeDepth) {
      const { maxIncludeDepth } = this.limits;
      const message = `The includes nest deeper than the limit maxIncludeDepth of ${maxIncludeDepth}.`;
      throw new SecurityError(message, "maxIncludeDepth", maxIncludeDepth);
    }
    let returned: XmlElement;
    try {
      returned = this.resolve(href, context.base);
    } catch (error) {
      // XInclude 1.0 §4.4: a resource error falls back; limits and path rules are not resource errors.
      if (error instanceof SecurityError) throw error;
      if (fallback === undefined) throw resourceError(href, error, locationOf(include, context.base));
      return this.expandNodes(fallback.children, context);
    }
    return this.expandNode(checkTarget(returned), { base: key, chain: [...context.chain, key], depth: context.depth });
  }
}

/** Checks what the caller's resolver returned, which JavaScript does not guarantee. */
function checkTarget(target: XmlElement): XmlElement {
  if (!isRecord(target) || target.kind !== "element") {
    throw new DataError(`The include resolver must return an element, found ${describe(target)}.`);
  }
  return target;
}

function resourceError(href: string, error: unknown, location: IssueLocation): ReadError {
  const reason = error instanceof Error ? error.message : describe(error);
  const message = `The document ${JSON.stringify(href)} of an xi:include cannot be read and the include has no xi:fallback: ${reason}`;
  return readError("olah/xml/xinclude-resource", message, "XInclude 1.0 §4.4", location);
}

/**
 * Replaces each `xi:include` of a tree with the root element of the document it names, and expands the includes of
 * that document in turn. Only parsed XML is included, an `xpointer` is an error (INFO §2.12), and the resolver is the
 * caller's: olah reads nothing itself. If the resolver fails, the `xi:fallback` of the include replaces it; without one,
 * the failure is an error (XInclude 1.0 §4.4). A `SecurityError` from the resolver is never replaced by a fallback.
 * `xml:base` and `xml:lang` fixup is not done, which XInclude 1.0 §4.5.5 and §4.5.6 allow. The attributes `encoding`,
 * `accept` and `accept-language` of an include do not apply to parsed XML and are ignored.
 *
 * @param root - The tree, usually from {@link parseXml}.
 * @param base - The path of the document of `root`, which the resolver gets for the includes of that document.
 * @param resolve - Returns the parsed root element of the document an `href` names.
 * @param options - See {@link ResolveIncludesOptions}.
 * @returns A tree without includes.
 * @throws `DataError` when an argument has the wrong type, a limit is not a positive integer, or the resolver returns
 * something other than an element.
 * @throws `ReadError` when an include has an `xpointer`, a `parse` other than `xml`, no `href` or an `href` with a
 * fragment identifier, when the includes form a loop, or when the resolver fails and there is no fallback.
 * @throws `SecurityError` when the result exceeds `maxDepth` or `maxNodes`, includes nest deeper than `maxIncludeDepth`,
 * or the resolver throws one.
 */
export function resolveIncludes(
  root: XmlElement,
  base: string,
  resolve: IncludeResolver,
  options: ResolveIncludesOptions = {},
): XmlElement {
  checkRecord(root, "The root must be an element");
  checkString(base, "The base");
  checkFunction(resolve, "The resolver must be a function of an href and a base");
  checkOptions(options);
  const { limits = {} } = options;
  const expander = new Expander(resolveXmlLimits(limits), resolve);
  const key = joinReference("", base);
  const [expanded, ...others] = expander.expandNode(root, { base: key, chain: [key], depth: 1 });
  if (expanded?.kind !== "element" || others.length > 0) {
    throw readError(
      "olah/xml/xinclude-structure",
      "The root of a document must be replaced by exactly one element.",
      INCLUDE_SYNTAX,
    );
  }
  return expanded;
}
