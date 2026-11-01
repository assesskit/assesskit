import { ASI_NAMESPACE, descendantNodes, type ModelNode } from "@assesskit/runtime/asi";
import { AssesskitError } from "@assesskit/runtime/errors";
import {
  CP_NAMESPACE,
  CSM_NAMESPACE,
  DRD_NAMESPACE,
  LOM_NAMESPACE,
  QTI_METADATA_NAMESPACE,
} from "@assesskit/runtime/metadata";
import {
  CPX_NAMESPACE,
  MANIFEST_PATH,
  type QtiPackage,
  type Resource,
  type ResourceType,
  resourcePath,
} from "@assesskit/runtime/package";
import { RESULTS_NAMESPACE } from "@assesskit/runtime/results";
import { USAGE_NAMESPACE } from "@assesskit/runtime/usage";
import { parseXml, XINCLUDE_NAMESPACE, type XmlElement } from "@assesskit/runtime/xml";

/**
 * The resource types whose files the gate never serves: the documents of QTI, which hold answer keys, response processing
 * and templates, the usage data and metadata that describe items, the control files and the links of LTI tools.
 */
const DENIED_TYPES: ReadonlySet<ResourceType> = new Set<ResourceType>([
  "imsqti_test_xmlv3p0",
  "imsqti_section_xmlv3p0",
  "imsqti_item_xmlv3p0",
  "imsqti_stimulus_xmlv3p0",
  "imsqti_resprocessing_xmlv3p0",
  "imsqti_rptemplate_xmlv3p0",
  "imsqti_outcomes_xmlv3p0",
  "imsqti_fragment_xmlv3p0",
  "qtiusagedata/xml",
  "resourcemetadata/xml",
  "resourceextmetadata/xml",
  "controlfile",
  "imsbasiclti_xmlv1p3",
]);

/** The types of resource whose documents may name the files of an adaptive section. */
const ADAPTIVE_HOLDERS: ReadonlySet<ResourceType> = new Set<ResourceType>([
  "imsqti_test_xmlv3p0",
  "imsqti_section_xmlv3p0",
]);

/** The references of `qti-adaptive-selection` to files: the engine, the settings, the item metadata and the usage data. */
const ADAPTIVE_REFERENCES = ["adaptive-engine-ref", "adaptive-settings-ref", "metadata-ref", "usagedata-ref"];

/** The origin that 1EdTech's namespaces share; its examples also write them without it, as `/xsd/imslticc_v1p0`. */
const IMS_ORIGIN = "http://www.imsglobal.org";

/** The namespaces whose documents the gate never serves: those that the runtime reads as QTI data (ASI, CP, RR, UD, QTI metadata, LOM). */
const DENIED_NAMESPACES: readonly string[] = [
  ASI_NAMESPACE,
  CP_NAMESPACE,
  CPX_NAMESPACE,
  RESULTS_NAMESPACE,
  USAGE_NAMESPACE,
  `${IMS_ORIGIN}/xsd/imsqti_usagedata_v2p2`,
  QTI_METADATA_NAMESPACE,
  CSM_NAMESPACE,
  DRD_NAMESPACE,
  LOM_NAMESPACE,
];

/**
 * What a namespace of QTI data looks like inside a document, without the origin of 1EdTech that a document may leave out.
 * A document that declares one anywhere in the bytes the sniff reads is denied, so a wrapper around QTI elements is too.
 */
const NAMESPACE_MARKERS: readonly string[] = [
  ...DENIED_NAMESPACES.map((namespace) =>
    namespace.startsWith(IMS_ORIGIN) ? namespace.slice(IMS_ORIGIN.length) : namespace,
  ),
  "/xsd/imslticc_v1p0",
];

/** The local name of the root of an LTI link, whatever its namespace. */
const LTI_LINK_ROOT = "cartridge_basiclti_link";

/** How many bytes of a file the namespace sniff reads: enough for the root element and its declarations. */
const SNIFF_BYTES = 4096;

/** The files of a package that the gate denies, per package; the package never changes after it is opened. */
const DENIED_PATHS = new WeakMap<QtiPackage, ReadonlySet<string>>();

/** Returns the paths named by the adaptive references in the nodes of a document, resolved against its path. */
function adaptiveFiles(pkg: QtiPackage, path: string, nodes: readonly ModelNode[]): string[] {
  return nodes.flatMap((node) => {
    if (!ADAPTIVE_REFERENCES.includes(node.kind)) return [];
    const href: unknown = Reflect.get(node, "href");
    const target = typeof href === "string" ? pkg.resolve(path, href) : undefined;
    return target === undefined ? [] : [target];
  });
}

/** Returns the paths that a test or section document names for its adaptive sections; none when the document cannot be read. */
function adaptiveFilesOf(pkg: QtiPackage, path: string): string[] {
  try {
    const document = pkg.document(path);
    const root = document.kind === "test" ? document.test : document.kind === "section" ? document.section : undefined;
    return root === undefined ? [] : adaptiveFiles(pkg, path, [root, ...descendantNodes(root)]);
  } catch (error) {
    // A document that cannot be read is denied by its type; nothing in it can be named.
    if (error instanceof AssesskitError) return [];
    throw error;
  }
}

/** Returns the path of the main file of a resource: its href, or its only file when it has no href. */
function mainPathOf(pkg: QtiPackage, resource: Resource): string | undefined {
  const { manifest } = pkg;
  const [only, ...others] = resource.files;
  if (resource.href === undefined && only !== undefined && others.length === 0) {
    return resourcePath(manifest, resource, only.href);
  }
  return resourcePath(manifest, resource);
}

/** Parses an XML file; `undefined` when it is not XML, or the runtime's limits refuse it, so the engine cannot read it either. */
function parseOrNone(path: string, bytes: Uint8Array): XmlElement | undefined {
  try {
    return parseXml(bytes, { path });
  } catch (error) {
    if (error instanceof AssesskitError) return undefined;
    throw error;
  }
}

/** Returns the `href` of an `xi:include` element, or `undefined` for any other element. */
function includeHref(element: XmlElement): string | undefined {
  if (element.namespace !== XINCLUDE_NAMESPACE || element.name !== "include") return undefined;
  return element.attributes.find(({ namespace, name }) => namespace === "" && name === "href")?.value;
}

/** Returns the files that an XML document includes with XInclude, resolved against its path; none when it is not XML. */
function includeTargets(pkg: QtiPackage, path: string, bytes: Uint8Array): string[] {
  const root = parseOrNone(path, bytes);
  const targets: string[] = [];
  const pending = root === undefined ? [] : [root];
  for (let element = pending.pop(); element !== undefined; element = pending.pop()) {
    const href = includeHref(element);
    const target = href === undefined ? undefined : pkg.resolve(path, href);
    if (target !== undefined) targets.push(target);
    for (const child of element.children) if (child.kind === "element") pending.push(child);
  }
  return targets;
}

/** Returns the files that the documents in `seeds` include, and those that those include in turn. */
function includedFiles(pkg: QtiPackage, seeds: Iterable<string>): Set<string> {
  const included = new Set<string>();
  const pending = [...seeds];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    const bytes = pkg.file(path);
    if (bytes === undefined) continue;
    for (const target of includeTargets(pkg, path, bytes)) {
      if (included.has(target)) continue;
      included.add(target);
      pending.push(target);
    }
  }
  return included;
}

/**
 * Returns the paths of the files of a package that the gate answers 404 for, whatever the token:
 *
 * @remarks
 * - the manifest;
 * - the main file of every resource of a denied type, whatever its name: these are the item, test, section, stimulus,
 *   fragment and template documents, the usage data, the metadata, the control files and the links of tools. The other files
 *   that such a resource lists are served by their extension, and only the types of web assets are (see content-type.ts);
 * - the files that `qti-adaptive-selection` refers to;
 * - the files that any of these documents, and any other XML file of the package, includes with XInclude, since an included
 *   fragment or template can hold what the including document holds, and need not be listed.
 *
 * @param pkg - The package.
 * @returns The paths.
 * @throws `ReadError` when a document of the package that the lookup needs cannot be read.
 */
export function deniedPaths(pkg: QtiPackage): ReadonlySet<string> {
  const known = DENIED_PATHS.get(pkg);
  if (known !== undefined) return known;
  const { manifest } = pkg;
  const denied = new Set<string>([MANIFEST_PATH]);
  for (const resource of manifest.resources) {
    if (!DENIED_TYPES.has(resource.type)) continue;
    const main = mainPathOf(pkg, resource);
    if (main !== undefined) denied.add(main);
    if (ADAPTIVE_HOLDERS.has(resource.type) && main !== undefined) {
      for (const path of adaptiveFilesOf(pkg, main)) denied.add(path);
    }
  }
  const documents = new Set([...denied, ...pkg.paths.filter((path) => path.toLowerCase().endsWith(".xml"))]);
  for (const path of includedFiles(pkg, documents)) denied.add(path);
  DENIED_PATHS.set(pkg, denied);
  return denied;
}

/** The characters that may stand before the first thing of an XML document: space, tab, line feed and carriage return. */
const XML_SPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

/** How a file is encoded as far as its first two bytes tell: a byte order mark, else a zero byte beside the first character (XML 1.0, Appendix F), else UTF-8. */
function encodingOf(first: number | undefined, second: number | undefined): "utf-16le" | "utf-16be" | "utf-8" {
  if (first === 0xff && second === 0xfe) return "utf-16le";
  if (first === 0xfe && second === 0xff) return "utf-16be";
  if (first !== undefined && first !== 0 && second === 0) return "utf-16le";
  if (first === 0 && second !== undefined && second !== 0) return "utf-16be";
  return "utf-8";
}

/**
 * The text of the start of a file, decoded by its encoding, from its first character that is not white space: a file of
 * white space and then an item is an item, however long the white space.
 */
function startOf(bytes: Uint8Array): string {
  const encoding = encodingOf(bytes[0], bytes[1]);
  const width = encoding === "utf-8" ? 1 : 2;
  const marked = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let offset = encoding === "utf-8" ? (marked ? 3 : 0) : bytes[0] === 0xff || bytes[0] === 0xfe ? width : 0;
  const unit = (at: number): number =>
    encoding === "utf-16be"
      ? ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0)
      : (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
  while (offset + width <= bytes.length && XML_SPACE.has(width === 1 ? (bytes[offset] ?? 0) : unit(offset))) {
    offset += width;
  }
  return new TextDecoder(encoding).decode(bytes.subarray(offset, offset + SNIFF_BYTES));
}

/** Returns the index after the first `terminator` at or after `from`, or -1 when there is none. */
function after(text: string, terminator: string, from: number): number {
  const index = text.indexOf(terminator, from);
  return index < 0 ? -1 : index + terminator.length;
}

/** Returns the index after a document type declaration, whose internal subset in brackets may hold `>`; -1 when it is cut off. */
function afterDoctype(text: string): number {
  const bracket = text.indexOf("[");
  const close = text.indexOf(">");
  if (bracket < 0 || (close >= 0 && close < bracket)) return after(text, ">", 0);
  const subset = after(text, "]", bracket);
  return subset < 0 ? -1 : after(text, ">", subset);
}

/** Skips the XML declaration, processing instructions, comments and the document type at the start of a text. */
function skipProlog(text: string): string {
  let rest = text.trimStart();
  for (;;) {
    let end: number;
    if (rest.startsWith("<?")) end = after(rest, "?>", 0);
    else if (rest.startsWith("<!--")) end = after(rest, "-->", 0);
    else if (rest.startsWith("<!")) end = afterDoctype(rest);
    else return rest;
    if (end < 0) return "";
    rest = rest.slice(end).trimStart();
  }
}

/** Returns the start tag of the first element of an XML text after the prolog, or `undefined` when it is not in the text. */
function rootStartTag(text: string): string | undefined {
  const rest = skipProlog(text);
  if (!/^<[^\s/>!?]/u.test(rest)) return undefined;
  let quote = "";
  for (let index = 1; index < rest.length; index += 1) {
    const character = rest.charAt(index);
    if (quote !== "") {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return rest.slice(0, index + 1);
  }
  return undefined;
}

/** Returns the local name of the element that a start tag opens. */
function localNameOf(tag: string): string {
  const [name = ""] = /^<([^\s/>]+)/u.exec(tag)?.slice(1) ?? [];
  return name.slice(name.indexOf(":") + 1);
}

/**
 * Tells whether the start of a file is an XML document of QTI data: one that starts with `<` and is a
 * `cartridge_basiclti_link`, or declares a namespace that the runtime reads (ASI, CP, RR, UD, QTI metadata or LOM) anywhere in the
 * first 4 KiB, which also covers a wrapper around QTI elements. It catches a file that no resource declares, and one that
 * the manifest lists as `webcontent`. A file that starts with `<` and shows no first element in those bytes is denied, since
 * the sniff cannot tell what it is.
 *
 * @param bytes - The file.
 * @returns Whether to deny it.
 */
export function isQtiData(bytes: Uint8Array): boolean {
  const text = startOf(bytes);
  if (!text.trimStart().startsWith("<")) return false;
  const tag = rootStartTag(text);
  if (tag === undefined) return true;
  return localNameOf(tag) === LTI_LINK_ROOT || NAMESPACE_MARKERS.some((marker) => text.includes(marker));
}
