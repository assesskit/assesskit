import type { ModelNode } from "@assesskit/runtime/asi";
import { isRecord } from "../../checks.js";
import { isHtmlName } from "./html-elements.js";
import { resolveSrcset, resolveUrl, type UrlPolicy, type UrlUse } from "./urls.js";

/** What the attributes of an element depend on besides the node. */
export interface AttributeContext {
  /** How references become URLs. */
  readonly urls: UrlPolicy;
  /** The factor for the pixel sizes of media. */
  readonly mediaScale: number;
}

/**
 * The properties that every element of the model has and that the player keeps on every element it builds, QTI elements
 * included (the player design §3): the identity, the classes, the direction, the role, and the three attributes of QTI that
 * speech and cards read. The language is set apart, as `lang` and `xml:lang` combine.
 */
const COMMON_PROPERTIES: ReadonlySet<string> = new Set([
  "id",
  "class",
  "dir",
  "role",
  "dataCatalogIdref",
  "dataQtiSuppressTts",
  "dataSsml",
]);

/**
 * The properties that the schema gives HTML elements besides the common ones (INFO §2.3.1), which the player keeps. The
 * allowlist is the player's, not the model's, because a view that came over the wire may carry any property: the player
 * draws none that it does not know. `autoplay`, `crossorigin` and `mediagroup` are left out so that media play only when
 * the candidate starts them (WCAG 1.4.2) and no request carries credentials, and the attributes of `object` and
 * `param` are for the renderer of the object, not for an element.
 */
const HTML_PROPERTIES: ReadonlySet<string> = new Set([
  "abbr",
  "align",
  "alt",
  "axis",
  "cite",
  "colspan",
  "controls",
  "default",
  "headers",
  "height",
  "href",
  "longdesc",
  "loop",
  "media",
  "muted",
  "open",
  "poster",
  "preload",
  "rowspan",
  "scope",
  "sizes",
  "span",
  "src",
  "srclang",
  "srcset",
  "summary",
  "title",
  "trackKind",
  "type",
  "valign",
  "width",
]);

/** The attributes of the DOM whose name is not the property's name in kebab case. */
const ATTRIBUTE_NAMES: ReadonlyMap<string, string> = new Map([
  ["language", "lang"],
  ["trackKind", "kind"],
]);

/**
 * The attributes that HTML reads by their presence. The model gives them as a boolean, or as the enumeration of the
 * schema (`true`, `false` or the name), and `false` must leave them out because HTML would read any value as true.
 */
const PRESENCE_ATTRIBUTES: ReadonlySet<string> = new Set(["controls", "default", "loop", "muted", "open"]);

/** The attributes that hold a reference, and what the reference is for. */
const URL_ATTRIBUTES: ReadonlyMap<string, UrlUse> = new Map([
  ["href", "navigate"],
  ["src", "load"],
  ["poster", "load"],
  ["cite", "navigate"],
  ["longdesc", "navigate"],
]);

/** The attributes whose pixel size grows with the magnification of non-text content (BPIG §5.2.9.7). */
const SIZE_ATTRIBUTES: ReadonlySet<string> = new Set(["width", "height"]);

/** A `data-*` attribute that the player keeps (S12, INFO §10.1.7). */
const DATA_ATTRIBUTE = /^data-[\w.-]+$/u;

/** `data-qti-aria-*` carries an ARIA attribute that the element does not allow (VOCAB §1.1.1.4). */
const ARIA_BACKUP = /^data-qti-aria-([a-z]+)$/u;

/** A whole number of pixels, as `width` and `height` write one. */
const PIXELS = /^\d+$/u;

/**
 * The attribute in which the renderer keeps the width an author gave an element, in the pixels of the author, before the
 * magnification of non-text content scales the `width` of the element. The coordinates of the graphic interactions are
 * measured in those pixels (INFO §7.9), and a change of the magnification scales the element from them again.
 */
export const DECLARED_WIDTH = "data-ak-width";

/** The attribute in which the renderer keeps the height an author gave an element; see {@link DECLARED_WIDTH}. */
export const DECLARED_HEIGHT = "data-ak-height";

const DECLARED_ATTRIBUTES: ReadonlyMap<string, string> = new Map([
  ["width", DECLARED_WIDTH],
  ["height", DECLARED_HEIGHT],
]);

/** Records on an element the `width` or `height` an author gave it, when it is a number of pixels. */
export function declareSize(element: Element, dimension: string, size: string): void {
  const attribute = DECLARED_ATTRIBUTES.get(dimension);
  if (attribute !== undefined && PIXELS.test(size)) element.setAttribute(attribute, size);
}

const isAria = (property: string): boolean => /^aria[A-Z]/u.test(property);

/** Returns the name of the attribute for the property of the model: `ariaLabel` is `aria-label`. */
function attributeName(property: string): string {
  return ATTRIBUTE_NAMES.get(property) ?? property.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

/** Returns the text of an attribute value of the model, or `undefined` when the value is not one: a list is joined by spaces. */
function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const isItem = (item: unknown): item is number | string => typeof item === "string" || typeof item === "number";
  return Array.isArray(value) && value.length > 0 && value.every(isItem) ? value.join(" ") : undefined;
}

/** Returns the size of media for the DOM: a whole number of pixels grows with the magnification, any other length stays. */
export function scaleSize(size: string, mediaScale: number): string {
  return PIXELS.test(size) ? String(Math.round(Number(size) * mediaScale)) : size;
}

/**
 * Sets the `width` and `height` of each element under `root` whose size the author declared in pixels to that size times
 * `mediaScale`, so that a change of the magnification reaches content that is already drawn.
 */
export function scaleDeclaredSizes(root: ParentNode, mediaScale: number): void {
  for (const element of root.querySelectorAll(`[${DECLARED_WIDTH}], [${DECLARED_HEIGHT}]`)) {
    for (const [dimension, attribute] of DECLARED_ATTRIBUTES) {
      const declared = element.getAttribute(attribute);
      if (declared !== null) element.setAttribute(dimension, scaleSize(declared, mediaScale));
    }
  }
}

/** Returns the value of an attribute for the DOM, or `undefined` when the attribute stays off the element. */
function attributeValue(name: string, text: string, context: AttributeContext): string | undefined {
  if (PRESENCE_ATTRIBUTES.has(name)) return text === "false" ? undefined : "";
  const use = URL_ATTRIBUTES.get(name);
  if (use !== undefined) return resolveUrl(text, context.urls, use);
  if (name === "srcset") return resolveSrcset(text, context.urls);
  return SIZE_ATTRIBUTES.has(name) ? scaleSize(text, context.mediaScale) : text;
}

/** Returns whether a property of the model becomes an attribute: `lang` is set apart, as it combines two properties. */
function isKept(property: string, element: string, specific: boolean): boolean {
  if (property === "lang" || property === "language") return false;
  // `label` names a text track; on other elements it is the label that results report.
  if (property === "label") return specific && element === "track";
  return COMMON_PROPERTIES.has(property) || isAria(property) || (specific && HTML_PROPERTIES.has(property));
}

/** Sets the attributes of the model on an element: the common ones, and those of HTML when `specific` is set. */
function setModelAttributes(element: Element, node: ModelNode, context: AttributeContext, specific: boolean): void {
  // `xml:lang` wins over `lang` where both are given (HTML Standard §3.2.6.2).
  const language: unknown = Reflect.get(node, "language") ?? Reflect.get(node, "lang");
  for (const [property, value] of Object.entries(node)) {
    if (!isKept(property, element.localName, specific)) continue;
    const text = textOf(value);
    if (text === undefined) continue;
    const name = attributeName(property);
    const kept = attributeValue(name, text, context);
    if (kept !== undefined) element.setAttribute(name, kept);
    declareSize(element, name, text);
  }
  if (typeof language === "string") element.setAttribute("lang", language);
}

/** Sets the attributes beyond the schema that the player keeps: `data-*`, and the ARIA attributes that `data-qti-aria-*` stand for. */
function setExtensions(element: Element, node: ModelNode): void {
  const extensions: unknown = Reflect.get(node, "extensions");
  if (!Array.isArray(extensions)) return;
  for (const extension of extensions) {
    if (!isRecord(extension)) continue;
    const { namespace, name, value } = extension;
    if (namespace !== "" || typeof name !== "string" || typeof value !== "string" || !DATA_ATTRIBUTE.test(name))
      continue;
    element.setAttribute(name, value);
    const aria = ARIA_BACKUP.exec(name)?.[1];
    if (aria !== undefined && !element.hasAttribute(`aria-${aria}`)) element.setAttribute(`aria-${aria}`, value);
  }
}

/**
 * Sets on an element the attributes of a node that the player keeps. HTML elements keep the attributes of HTML that the
 * schema gives them, and QTI elements keep the common ones; every element keeps the ARIA attributes, `data-*`
 * attributes and `lang`. Event handlers, `style` and the attributes of other namespaces are not in the model, so they are
 * never copied. A reference that the URL policy refuses is not set.
 */
export function setAttributes(element: Element, node: ModelNode, context: AttributeContext): void {
  setModelAttributes(element, node, context, isHtmlName(element.localName));
  setExtensions(element, node);
}

/**
 * Sets on an element only what every element of the model has: the identity, the classes, the language, the direction,
 * the role, the ARIA attributes and the `data-*` attributes. An element that stands for another one, such as the image
 * that an `object` becomes, takes these and none of the attributes of the element it replaces.
 */
export function setCommonAttributes(element: Element, node: ModelNode, context: AttributeContext): void {
  setModelAttributes(element, node, context, false);
  setExtensions(element, node);
}
