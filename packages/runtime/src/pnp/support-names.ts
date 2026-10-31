import { checkString } from "../checks.js";

/** The supports that only replace content of an access mode: they have no parameter of their own. */
export const REPLACING_SUPPORTS = [
  "linguistic-guidance",
  "keyword-emphasis",
  "simplified-language-portions",
  "simplified-graphics",
  "encouragement",
  "tactile",
  "answer-masking",
  "keyboard-directions",
  "additional-directions",
  "captions",
  "transcript",
  "alternative-text",
  "audio-description",
  "high-contrast",
  "layout-single-column",
] as const;

/** The supports that name a language. */
export const LANGUAGE_SUPPORTS = ["keyword-translation", "item-translation", "sign-language"] as const;

/** The on-screen tools, which have no parameter. */
export const TOOL_SUPPORTS = [
  "dictionary-on-screen",
  "glossary-on-screen",
  "thesaurus-on-screen",
  "homophone-checker-on-screen",
  "note-taking-on-screen",
  "visual-organizer-on-screen",
  "outliner-on-screen",
  "peer-interaction-on-screen",
  "spell-checker-on-screen",
] as const;

/** The supports with a shape of their own. */
export const OTHER_SUPPORTS = [
  "hazard-avoidance",
  "input-requirements",
  "language-of-interface",
  "additional-testing-time",
  "line-reader",
  "invert-display-polarity",
  "magnification",
  "spoken",
  "braille",
  "long-description",
  "environment",
  "text-appearance",
  "calculator-on-screen",
] as const;

/** The name of a support that only replaces content of an access mode. */
export type ReplacingSupportName = (typeof REPLACING_SUPPORTS)[number];
/** The name of a support that names a language. */
export type LanguageSupportName = (typeof LANGUAGE_SUPPORTS)[number];
/** The name of an on-screen tool. */
export type ToolSupportName = (typeof TOOL_SUPPORTS)[number];
/** The name of a support with a shape of its own. */
export type OtherSupportName = (typeof OTHER_SUPPORTS)[number];

/** The name of a support that the QTI profile of PNP 3.0 defines: the 40 elements of the profile of the PNP schema. */
export type PredefinedSupportName = ReplacingSupportName | LanguageSupportName | ToolSupportName | OtherSupportName;

/**
 * The name of a support: a predefined one, or `ext:` and the local name of a custom support from another namespace
 * The same names tell a catalog card which support it serves.
 */
export type SupportName = PredefinedSupportName | `ext:${string}`;

/** The name of a support that a set can list: every predefined support but `hazard-avoidance` and `environment` (`FeatureSetDType` of the PNP schema). */
export type SetSupportName = Exclude<PredefinedSupportName, "hazard-avoidance" | "environment">;

/** The 40 predefined supports, grouped by shape. */
export const SUPPORT_NAMES: readonly PredefinedSupportName[] = [
  ...REPLACING_SUPPORTS,
  ...LANGUAGE_SUPPORTS,
  ...TOOL_SUPPORTS,
  ...OTHER_SUPPORTS,
];

/** The prefix of the name of a custom support. */
const EXTENSION_PREFIX = "ext:";

/**
 * Returns whether a value is one of the 40 predefined supports, spelled exactly as the schema spells it.
 *
 * @param value - The value to test.
 * @returns `true` for the name of a predefined support.
 */
export function isPredefinedSupportName(value: unknown): value is PredefinedSupportName {
  return SUPPORT_NAMES.some((name) => name === value);
}

/**
 * Returns whether a value is the name of a support: a predefined one, or `ext:` and at least one character.
 *
 * @param value - The value to test.
 * @returns `true` for the name of a predefined or a custom support.
 */
export function isSupportName(value: unknown): value is SupportName {
  return (
    isPredefinedSupportName(value) ||
    (typeof value === "string" && value.startsWith(EXTENSION_PREFIX) && value.length > EXTENSION_PREFIX.length)
  );
}

/**
 * Returns whether a predefined support only replaces content of an access mode.
 *
 * @param name - The name of a predefined support.
 * @returns `true` for a support that replaces content.
 */
export function isReplacingSupportName(name: PredefinedSupportName): name is ReplacingSupportName {
  return REPLACING_SUPPORTS.some((candidate) => candidate === name);
}

/**
 * Returns whether a predefined support names a language.
 *
 * @param name - The name of a predefined support.
 * @returns `true` for a support that names a language.
 */
export function isLanguageSupportName(name: PredefinedSupportName): name is LanguageSupportName {
  return LANGUAGE_SUPPORTS.some((candidate) => candidate === name);
}

/**
 * Returns whether a predefined support is an on-screen tool.
 *
 * @param name - The name of a predefined support.
 * @returns `true` for an on-screen tool.
 */
export function isToolSupportName(name: PredefinedSupportName): name is ToolSupportName {
  return TOOL_SUPPORTS.some((candidate) => candidate === name);
}

/**
 * Returns whether a value is the name of a support that a set can list.
 *
 * @param value - The value to test.
 * @returns `true` for the name of a support that a set can list.
 */
export function isSetSupportName(value: unknown): value is SetSupportName {
  return isPredefinedSupportName(value) && value !== "hazard-avoidance" && value !== "environment";
}

/**
 * Returns the name that a custom support has for catalogs and for the engine: `ext:` and the local name of its element.
 *
 * @param localName - The local name of the element of the custom support.
 * @returns The name of the custom support.
 * @throws `DataError` when `localName` is not a string.
 */
export function extensionName(localName: string): SupportName {
  checkString(localName, "The local name of a custom support");
  return `${EXTENSION_PREFIX}${localName}`;
}
