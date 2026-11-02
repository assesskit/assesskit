import type { Braille, Magnification, Spoken, SupportName, SupportSetting, TextAppearance } from "../pnp/index.js";

/**
 * The settings of each support that the candidate may change during the session, with a `support-settings` action: the
 * preferences that the profile gives at the start. Every other setting is the program's, such as the restrictions of
 * reading aloud, and stays as the profile gives it.
 *
 * | Support           | Settings                                                                    | CERT            |
 * | ----------------- | --------------------------------------------------------------------------- | --------------- |
 * | `braille`         | `deliveryMode`, `grade`, `brailleType`, `mathType`                          | A-10b           |
 * | `magnification`   | `allContent`, `text`, `nonText`                                             | A-30a, A-30b    |
 * | `spoken`          | `speechRate`, `pitch`, `volume`, `linkIndication`, `typingEcho`             | A-40d, A-40e    |
 * | `text-appearance` | the color theme, the colors, the size, face and spacing of text, wrapping   | A-42a, A-42b    |
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/conf/ | QTI 3.0 Conformance and Certification, Appendix A}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, magnification and text appearance}
 */
export const ADJUSTABLE_SETTINGS: {
  /** The preferences of braille: how it is delivered, its grade, and the kinds of braille and of its mathematics. */
  readonly braille: readonly (keyof Braille)[];
  /** The zoom of all content, or of text and of non-text content. */
  readonly magnification: readonly (keyof Magnification)[];
  /** The preferences of the voice: the rate, the pitch, the volume, how a link is read and what typing echoes. */
  readonly spoken: readonly (keyof Spoken)[];
  /** Every setting of the look of text: the color theme, the colors, the size, face and spacing, and wrapping. */
  readonly "text-appearance": readonly (keyof TextAppearance)[];
} = {
  braille: ["deliveryMode", "grade", "brailleType", "mathType"],
  magnification: ["allContent", "text", "nonText"],
  spoken: ["speechRate", "pitch", "volume", "linkIndication", "typingEcho"],
  "text-appearance": [
    "colorTheme",
    "backgroundColor",
    "fontColor",
    "fontSize",
    "fontFace",
    "lineSpacing",
    "lineHeight",
    "letterSpacing",
    "uniformFontSizing",
    "wordSpacing",
    "wordWrapping",
  ],
};

/** {@link ADJUSTABLE_SETTINGS} by the name of the support. */
const ADJUSTABLE: ReadonlyMap<string, readonly string[]> = new Map(Object.entries(ADJUSTABLE_SETTINGS));

/**
 * Returns the settings of a support that the candidate may change.
 *
 * @param name - The support.
 * @returns The names of the settings, or `undefined` for a support that has none.
 */
export function adjustableSettings(name: SupportName): readonly string[] | undefined {
  return ADJUSTABLE.get(name);
}

/** Returns a setting as text to compare, where an empty list is the same as no value. */
function comparable(value: unknown): string | undefined {
  return value === undefined || (Array.isArray(value) && value.length === 0) ? undefined : JSON.stringify(value);
}

/**
 * Returns the first setting that differs between the settings of a support and new ones and that the candidate may not
 * change.
 *
 * @param before - The settings in force; `undefined` for a support that the profile does not name.
 * @param after - The settings that the candidate asks for.
 * @param adjustable - The settings that the candidate may change.
 * @returns The name of the setting, or `undefined` when only adjustable settings differ.
 */
export function fixedChange(
  before: SupportSetting | undefined,
  after: SupportSetting,
  adjustable: readonly string[],
): string | undefined {
  const old = new Map<string, unknown>(Object.entries(before ?? {}));
  const now = new Map<string, unknown>(Object.entries(after));
  for (const name of new Set([...old.keys(), ...now.keys()])) {
    if (name === "name" || adjustable.includes(name)) continue;
    if (comparable(old.get(name)) !== comparable(now.get(name))) return name;
  }
  return undefined;
}
