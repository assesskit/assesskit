import { checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { ElementReader, type ParseXmlOptions, type ReaderRules, type XmlElement } from "../xml/index.js";

/** The namespaces of `cartridge_basiclti_link`: the one of the schema, and the relative one that the 1EdTech examples declare. */
const CARTRIDGE_NAMESPACES: readonly string[] = ["http://www.imsglobal.org/xsd/imslticc_v1p0", "/xsd/imslticc_v1p0"];
const BASIC_LTI_NAMESPACE = "http://www.imsglobal.org/xsd/imsbasiclti_v1p0";
const LTI_COMMON_NAMESPACE = "http://www.imsglobal.org/xsd/imslticm_v1p0";
const LTI_PROFILE_NAMESPACE = "http://www.imsglobal.org/xsd/imslticp_v1p0";
const RULES: ReaderRules = {
  module: "package",
  namespaces: [...CARTRIDGE_NAMESPACES, BASIC_LTI_NAMESPACE, LTI_COMMON_NAMESPACE, LTI_PROFILE_NAMESPACE],
};

/** The vendor of the tool that an LTI link launches. */
export interface LtiVendor {
  /** The code that identifies the vendor. */
  readonly code: string;
  /** The name of the vendor. */
  readonly name?: string;
}

/** The properties that a platform adds to a launch. */
export interface LtiExtensions {
  /** The platform the properties are for. */
  readonly platform: string;
  /** The properties by name. */
  readonly properties: ReadonlyMap<string, string>;
}

/** The link to an item that a tool provides, from the `cartridge_basiclti_link` document of an LTI resource. */
export interface LtiLink {
  /** The title of the link. */
  readonly title: string;
  /** The description of the link. */
  readonly description?: string;
  /** The URL that starts the tool. */
  readonly launchUrl?: string;
  /** The URL that starts the tool over a secure connection. */
  readonly secureLaunchUrl?: string;
  /** The custom properties of the launch, by name. */
  readonly custom: ReadonlyMap<string, string>;
  /** The properties for individual platforms. */
  readonly extensions: readonly LtiExtensions[];
  /** The vendor of the tool. */
  readonly vendor?: LtiVendor;
}

/** Whether a reader is on the element `name` of a namespace. */
function isElement(reader: ElementReader, namespace: string, name: string): boolean {
  return reader.element.namespace === namespace && reader.name === name;
}

/** The text of an element without the white space around it. */
function trimmed(reader: ElementReader): string {
  return reader.text().trim();
}

/** Reads the `lticm:property` elements of an element into a map; the value is the text without the white space around it. */
function readProperties(parent: ElementReader): Map<string, string> {
  const properties = new Map<string, string>();
  for (let child = parent.next(); child !== undefined; child = parent.next()) {
    if (!isElement(child, LTI_COMMON_NAMESPACE, "property")) continue;
    const name = child.required("name");
    if (properties.has(name)) {
      throw child.fail("lti-property", `The LTI property ${JSON.stringify(name)} occurs twice.`);
    }
    properties.set(name, trimmed(child));
  }
  return properties;
}

function readVendor(reader: ElementReader): LtiVendor {
  let code: string | undefined;
  let name: string | undefined;
  for (let child = reader.next(); child !== undefined; child = reader.next()) {
    if (isElement(child, LTI_PROFILE_NAMESPACE, "code")) code = trimmed(child);
    else if (isElement(child, LTI_PROFILE_NAMESPACE, "name")) name = trimmed(child);
  }
  if (code === undefined) throw reader.fail("lti-link", "The vendor of an LTI link must have a code element.");
  return { code, name };
}

/** The parts of a link as they are read; a part that the document lacks is `undefined`. */
interface Draft {
  title?: string;
  description?: string;
  launchUrl?: string;
  secureLaunchUrl?: string;
  custom: Map<string, string>;
  vendor?: LtiVendor;
  readonly extensions: LtiExtensions[];
}

/** The elements of the basic LTI namespace that hold a text, with the field of the draft that holds it. */
const TEXT_FIELDS: ReadonlyMap<string, "title" | "description" | "launchUrl" | "secureLaunchUrl"> = new Map([
  ["title", "title"],
  ["description", "description"],
  ["launch_url", "launchUrl"],
  ["secure_launch_url", "secureLaunchUrl"],
]);

/** Reads a child of the link into the draft, and ignores the parts that the model does not hold. */
function readPart(child: ElementReader, draft: Draft): void {
  if (child.element.namespace !== BASIC_LTI_NAMESPACE) return;
  const field = TEXT_FIELDS.get(child.name);
  if (field !== undefined) draft[field] = trimmed(child);
  else if (child.name === "custom") draft.custom = readProperties(child);
  else if (child.name === "vendor") draft.vendor = readVendor(child);
  else if (child.name === "extensions") {
    draft.extensions.push({ platform: child.attribute("platform") ?? "", properties: readProperties(child) });
  }
}

/**
 * Reads the `cartridge_basiclti_link` document that an LTI resource names. The parts the model does not
 * hold, such as icons and bundles, are ignored, the parts may come in any order, and the text of an element is read without
 * the white space around it. The root is accepted in the namespace `http://www.imsglobal.org/xsd/imslticc_v1p0` and in the
 * relative namespace `/xsd/imslticc_v1p0` that the 1EdTech examples declare.
 *
 * @param input - The document as text or bytes, or the parsed root element.
 * @param options - See {@link ParseXmlOptions}.
 * @returns The link.
 * @throws `DataError` when an argument has the wrong type or a limit is not a positive integer.
 * @throws `ReadError` when the document is not well-formed, is not a `cartridge_basiclti_link`, has no title, a property
 * without a name or twice, or a vendor without a code.
 * @throws `SecurityError` when the document has a DOCTYPE or exceeds a limit.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, packaging}
 */
export function readLtiLink(input: string | Uint8Array | XmlElement, options: ParseXmlOptions = {}): LtiLink {
  const reader = ElementReader.open(input, RULES, "The LTI link", options);
  if (reader.name !== "cartridge_basiclti_link" || !CARTRIDGE_NAMESPACES.includes(reader.element.namespace)) {
    const message = `The root element of an LTI link must be cartridge_basiclti_link of the namespace ${CARTRIDGE_NAMESPACES[0]}, found ${reader.qualifiedName}.`;
    throw reader.fail("lti-link", message);
  }
  const draft: Draft = { custom: new Map(), extensions: [] };
  for (let child = reader.next(); child !== undefined; child = reader.next()) readPart(child, draft);
  const { title, ...rest } = draft;
  if (title === undefined) throw reader.fail("lti-link", "An LTI link must have a title element.");
  return { title, ...rest };
}

/**
 * Returns the URL that launches the tool of a link: the secure launch URL when the link has one, else the launch URL.
 *
 * @remarks
 * The URL is not checked further: whether it must be `https` is the platform's rule, and the platform that launches the
 * tool checks it.
 *
 * @param link - The link, as `readLtiLink` returns it.
 * @returns The URL.
 * @throws `DataError` when `link` is not a link, or names no launch URL, which is the case of a link that gives only a vendor.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, packaging}
 */
export function resolveLaunchUrl(link: LtiLink): string {
  checkRecord(link, "The LTI link must be an object");
  const url = [link.secureLaunchUrl, link.launchUrl].find((each) => typeof each === "string" && each !== "");
  if (url === undefined) {
    throw new DataError(
      `The LTI link ${describe(link.title)} must have a launch URL; a link that names only a vendor cannot be launched.`,
    );
  }
  return url;
}
