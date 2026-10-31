import { buildElement, serializeXml, type XmlElement, type XmlNode } from "@assesskit/runtime/xml";
import { SSML_NAMESPACE } from "../internal.js";

/**
 * The value of the `version` attribute of the `speak` element.
 *
 * @see {@link https://www.w3.org/TR/speech-synthesis11/#edef_speak | SSML 1.1, the speak element}
 */
const SSML_VERSION = "1.1";

/** What a request carries of an SSML element: the attributes that SSML 1.1 defines for it, and how its content is read. */
interface SsmlRule {
  /** The attributes that are copied from the content, by local name. */
  readonly attributes: readonly string[];
  /** The attributes the element needs; without one the element is dropped and its content is read as it stands. */
  readonly required: readonly string[];
  /** How the content is read. */
  readonly content: SsmlPart["content"];
}

/**
 * The elements of the ASI schema's SSML with their attributes, except `speak`, which the request makes itself.
 *
 * @remarks
 * `phoneme`, `say-as` and `sub` hold text.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, SSML in content}
 * @see {@link https://www.w3.org/TR/speech-synthesis11/ | SSML 1.1}
 */
const SSML_RULES: ReadonlyMap<string, SsmlRule> = new Map([
  [
    "audio",
    {
      attributes: [
        "src",
        "fetchhint",
        "fetchtimeout",
        "clipBegin",
        "clipEnd",
        "repeatCount",
        "repeatDur",
        "soundLevel",
        "speed",
      ],
      required: [],
      content: "flow",
    },
  ],
  ["break", { attributes: ["strength", "time"], required: [], content: "none" }],
  ["emphasis", { attributes: ["level"], required: [], content: "flow" }],
  ["mark", { attributes: ["name"], required: ["name"], content: "none" }],
  ["p", { attributes: [], required: [], content: "flow" }],
  ["phoneme", { attributes: ["alphabet", "ph", "type"], required: ["ph"], content: "text" }],
  [
    "prosody",
    { attributes: ["pitch", "contour", "range", "rate", "duration", "volume"], required: [], content: "flow" },
  ],
  ["s", { attributes: [], required: [], content: "flow" }],
  ["say-as", { attributes: ["interpret-as", "format", "detail"], required: ["interpret-as"], content: "text" }],
  ["sub", { attributes: ["alias"], required: ["alias"], content: "text" }],
  [
    "voice",
    {
      attributes: ["gender", "age", "variant", "name", "languages", "required", "ordering", "onvoicefailure"],
      required: [],
      content: "flow",
    },
  ],
]);

/** An SSML element of the content, reduced to what a request carries. */
export interface SsmlPart {
  /** The local name of the element. */
  readonly name: string;
  /** The attributes of the element that SSML 1.1 defines, with their values. */
  readonly attributes: Readonly<Record<string, string>>;
  /** How the content of the element is read: as flow content, only as text, or not at all because the element is empty. */
  readonly content: "flow" | "text" | "none";
}

/**
 * Reads an SSML element of the content: its name, the attributes that SSML 1.1 defines for it and how its content is read.
 *
 * @param element - The element.
 * @returns The part, or `undefined` for an element that a request does not carry: one outside the SSML namespace,
 * `speak`, which the request makes, any name that is not one of the schema's, and an element that lacks an attribute it
 * needs.
 */
export function readSsmlElement(element: Element): SsmlPart | undefined {
  const rule = element.namespaceURI === SSML_NAMESPACE ? SSML_RULES.get(element.localName) : undefined;
  if (rule === undefined) return undefined;
  const attributes: Record<string, string> = {};
  for (const name of rule.attributes) {
    const value = element.getAttribute(name);
    if (value !== null) attributes[name] = value;
  }
  if (rule.required.some((name) => attributes[name] === undefined)) return undefined;
  return { name: element.localName, attributes, content: rule.content };
}

/**
 * Returns whether XML 1.0 allows a character, by its code point.
 *
 * @see {@link https://www.w3.org/TR/xml/#charsets | XML 1.0, characters}
 */
function isXmlCharacter(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/**
 * Removes the characters that XML 1.0 does not allow, which content may hold and a document cannot.
 *
 * @param text - The text.
 * @returns The text without those characters.
 */
export function xmlSafe(text: string): string {
  let safe = "";
  for (const character of text) if (isXmlCharacter(character.codePointAt(0) ?? 0)) safe += character;
  return safe;
}

/**
 * Builds an SSML element of the request, without the characters in its text and attributes that XML 1.0 does not allow.
 *
 * @param name - The local name of the element.
 * @param attributes - The attributes; one with the value `undefined` is left out.
 * @param children - The children in order.
 * @returns The element, in the SSML namespace.
 */
export function ssmlElement(
  name: string,
  attributes: Readonly<Record<string, string | undefined>>,
  children: readonly (XmlNode | string)[],
): XmlElement {
  const safe = Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [key, value === undefined ? undefined : xmlSafe(value)]),
  );
  return buildElement(
    SSML_NAMESPACE,
    name,
    safe,
    children.map((child) => (typeof child === "string" ? xmlSafe(child) : child)),
  );
}

/**
 * Writes the SSML 1.1 document of a request: a `speak` element in the language of the content that holds the nodes.
 *
 * @param nodes - The nodes of the document.
 * @param language - The language of the content, a BCP 47 tag.
 * @returns The document as XML text.
 * @see {@link https://www.w3.org/TR/speech-synthesis11/#edef_speak | SSML 1.1, the speak element}
 */
export function speakDocument(nodes: readonly XmlNode[], language: string): string {
  return serializeXml(ssmlElement("speak", { version: SSML_VERSION, "xml:lang": language }, nodes));
}

/**
 * Returns the text that a voice without SSML says for SSML nodes.
 *
 * @remarks
 * The alias of a `sub` stands in place of its content, the fallback content of an `audio` is said, a `mark` has no text,
 * a `break` is a space, and each paragraph is a line.
 *
 * @param nodes - The nodes.
 * @returns The text.
 * @see {@link https://www.w3.org/TR/speech-synthesis11/#edef_sub | SSML 1.1, sub}
 */
export function plainText(nodes: readonly XmlNode[]): string {
  return nodes
    .map((node): string => {
      if (node.kind === "text" || node.kind === "cdata") return node.value;
      if (node.kind !== "element") return "";
      switch (node.name) {
        case "sub":
          return node.attributes.find(({ name }) => name === "alias")?.value ?? "";
        case "break":
          return " ";
        case "mark":
          return "";
        case "p":
          return `\n${plainText(node.children)}\n`;
        default:
          return plainText(node.children);
      }
    })
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}
