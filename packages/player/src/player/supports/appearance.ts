import type { SupportView } from "@assesskit/runtime/delivery";
import type { FontFace, GenericFontFace, SupportName, Zoom } from "@assesskit/runtime/pnp";
import { activeSupport, checkSupportViews } from "./check.js";
import type { Presentation } from "./presentation.js";

/** The font size that scales to 1: the default of `font-size` in the PNP schema, in points (PNP XSD `TextAppearance`). */
const BASE_FONT_SIZE = 12;

/** The zoom of a magnification that names no amount: 200 percent, the enlargement that WCAG 1.4.4 asks the text to survive. */
const DEFAULT_ZOOM = 2;

/** The generic font families as CSS spells them. */
const GENERIC_FONT_FACES: Readonly<Record<GenericFontFace, string>> = {
  serif: "serif",
  "sans serif": "sans-serif",
  monospaced: "monospace",
  cursive: "cursive",
  fantasy: "fantasy",
};

/** Quotes a font name as a CSS string: backslash and quote are escaped and control characters become spaces. */
function quoted(name: string): string {
  const escaped = Array.from(name, (character) => {
    if (character === "\\" || character === '"') return `\\${character}`;
    return character < " " || character === "\u007f" ? " " : character;
  }).join("");
  return `"${escaped}"`;
}

/** The places an applier writes to. */
interface Writer {
  readonly attributes: Map<string, string>;
  readonly properties: Map<string, string>;
}

type Applier = (support: SupportView, out: Writer) => void;

/** Returns the amount of a zoom, or the default when the zoom names none that can be used: a zoom of 0 or less shows nothing. */
function amountOf(zoom: Zoom | undefined): number {
  const amount = zoom?.zoomAmount;
  return amount !== undefined && amount > 0 ? amount : DEFAULT_ZOOM;
}

/** Returns the zoom of text and of non-text content that a magnification asks for (BPIG §5.2.9.6). */
function zoomsOf(support: SupportView): { readonly text: number; readonly nonText: number } {
  const settings = support.settings?.name === "magnification" ? support.settings : undefined;
  if (settings === undefined || (settings.text === undefined && settings.nonText === undefined)) {
    const all = amountOf(settings?.allContent);
    return { text: all, nonText: all };
  }
  return {
    text: settings.text === undefined ? 1 : amountOf(settings.text),
    nonText: settings.nonText === undefined ? 1 : amountOf(settings.nonText),
  };
}

/** The settings of text appearance that are a number written as a CSS number, with the unit of its property. */
const SPACINGS = [
  // BPIG §5.2.9.7.6–7: the line height multiplies the base, and the line spacing adds to it, in ems.
  ["lineHeight", "--ak-line-height", ""],
  ["lineSpacing", "--ak-line-spacing", ""],
  ["letterSpacing", "--ak-letter-spacing", "em"],
  ["wordSpacing", "--ak-word-spacing", "em"],
] as const;

/** Returns the value of `font-family` for a font face of the profile: its names, quoted, then the generic family. */
function fontFamilyOf({ fontNames, genericFontFace }: FontFace): string | undefined {
  const families = [
    ...fontNames.map(quoted),
    ...(genericFontFace === undefined ? [] : [GENERIC_FONT_FACES[genericFontFace]]),
  ];
  return families.length === 0 ? undefined : families.join(", ");
}

function applyTextAppearance({ settings }: SupportView, { attributes, properties }: Writer): void {
  if (settings?.name !== "text-appearance") return;
  if (settings.fontColor !== undefined) properties.set("--ak-fg", settings.fontColor);
  if (settings.backgroundColor !== undefined) properties.set("--ak-bg", settings.backgroundColor);
  // A size of 0 or less would show no text, so it asks for nothing.
  if (settings.fontSize !== undefined && settings.fontSize > 0) {
    properties.set("--ak-font-scale", String(settings.fontSize / BASE_FONT_SIZE));
  }
  const family = settings.fontFace === undefined ? undefined : fontFamilyOf(settings.fontFace);
  if (family !== undefined) properties.set("--ak-font-family", family);
  for (const [field, property, unit] of SPACINGS) {
    const value = settings[field];
    if (value !== undefined) properties.set(property, `${value}${unit}`);
  }
  if (settings.uniformFontSizing === true) attributes.set("data-ak-uniform-font", "");
  if (settings.wordWrapping === true) attributes.set("data-ak-wrapping", "");
}

function applyMagnification(support: SupportView, { properties }: Writer): void {
  const { text } = zoomsOf(support);
  if (text !== 1) properties.set("--ak-text-zoom", String(text));
}

function applyPolarity({ settings }: SupportView, { attributes, properties }: Writer): void {
  attributes.set("data-ak-polarity", "inverted");
  if (settings?.name !== "invert-display-polarity") return;
  if (settings.foreground !== undefined) properties.set("--ak-fg", settings.foreground);
  if (settings.background !== undefined) properties.set("--ak-bg", settings.background);
}

/**
 * The supports that change the look, in the order they apply: a later one wins where two set the same color, so the
 * colors of `text-appearance` win over those of `invert-display-polarity`.
 */
const APPLIERS: ReadonlyMap<SupportName, Applier> = new Map<SupportName, Applier>([
  ["high-contrast", (_, { attributes }) => attributes.set("data-ak-contrast", "high")],
  ["invert-display-polarity", applyPolarity],
  ["text-appearance", applyTextAppearance],
  ["magnification", applyMagnification],
  ["layout-single-column", (_, { attributes }) => attributes.set("data-ak-single-column", "")],
  ["keyword-emphasis", (_, { attributes }) => attributes.set("data-ak-keyword-emphasis", "")],
]);

/**
 * Builds the look that the supports that are on ask for (BPIG §5.2.9): the theme of high contrast and of inverted
 * polarity, the colors, size, face and spacing of text appearance, the zoom of text, the single column and keyword
 * emphasis. The zoom of non-text content is {@link mediaScaleOf}.
 *
 * @param supports - The supports of the view; those that are off or change nothing of the look are ignored.
 * @throws `DataError` when `supports` is not a list of the runtime's `SupportView`s.
 */
export function presentationOf(supports: readonly SupportView[]): Presentation {
  checkSupportViews(supports, "The list of supports");
  const out: Writer = { attributes: new Map(), properties: new Map() };
  for (const [name, apply] of APPLIERS) {
    const support = activeSupport(supports, name);
    if (support !== undefined) apply(support, out);
  }
  return out;
}

/**
 * Returns the factor for the pixel sizes of media that the magnification of non-text content asks for (BPIG §5.2.9.6):
 * the `mediaScale` option of a content root. It is 1 when no magnification is on.
 *
 * @throws `DataError` when `supports` is not a list of the runtime's `SupportView`s.
 */
export function mediaScaleOf(supports: readonly SupportView[]): number {
  checkSupportViews(supports, "The list of supports");
  const magnification = activeSupport(supports, "magnification");
  return magnification === undefined ? 1 : zoomsOf(magnification).nonText;
}
