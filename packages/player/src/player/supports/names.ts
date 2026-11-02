import type { SupportName } from "@assesskit/runtime/pnp";
import type { Messages } from "../../messages/index.js";

/** The message that names each support the player turns on and off outside the toolbar, or that has a card. */
const MESSAGE_OF: ReadonlyMap<SupportName, keyof Messages> = new Map<SupportName, keyof Messages>([
  ["hazard-avoidance", "supportHazardAvoidance"],
  ["input-requirements", "supportInputRequirements"],
  ["language-of-interface", "supportLanguageOfInterface"],
  ["linguistic-guidance", "supportLinguisticGuidance"],
  ["keyword-emphasis", "supportKeywordEmphasis"],
  ["keyword-translation", "supportKeywordTranslation"],
  ["simplified-language-portions", "supportSimplifiedLanguage"],
  ["simplified-graphics", "supportSimplifiedGraphics"],
  ["item-translation", "supportItemTranslation"],
  ["sign-language", "supportSignLanguage"],
  ["encouragement", "supportEncouragement"],
  ["additional-testing-time", "supportAdditionalTestingTime"],
  ["invert-display-polarity", "supportInvertDisplayPolarity"],
  ["magnification", "supportMagnification"],
  ["spoken", "supportSpoken"],
  ["tactile", "supportTactile"],
  ["braille", "supportBraille"],
  ["keyboard-directions", "supportKeyboardDirections"],
  ["additional-directions", "supportAdditionalDirections"],
  ["long-description", "supportLongDescription"],
  ["captions", "mediaCaptions"],
  ["environment", "supportEnvironment"],
  ["transcript", "supportTranscript"],
  ["alternative-text", "supportAlternativeText"],
  ["audio-description", "mediaAudioDescription"],
  ["high-contrast", "supportHighContrast"],
  ["layout-single-column", "supportLayoutSingleColumn"],
  ["text-appearance", "supportTextAppearance"],
  ["glossary-on-screen", "supportGlossaryOnScreen"],
]);

/**
 * The prefix of the name of a custom support.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, custom supports}
 */
export const EXTENSION_PREFIX = "ext:";

/**
 * The custom supports that a tool of the toolbar turns on and off: the highlighter and the answer eliminator.
 *
 * @remarks
 * QTI names neither tool, so they are custom supports; a term of the PNP schema allows no hyphen.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, custom supports}
 */
export const TOOL_EXTENSIONS = ["ext:highlighter", "ext:eliminator"] as const;

/**
 * Returns the name of a support in the language of the interface: a message for a predefined support, and the local name
 * of a custom one.
 *
 * @remarks
 * The supports that a tool of the toolbar turns on and off (`line-reader`, `answer-masking`, the on-screen tools but the
 * glossary, and the custom supports of {@link TOOL_EXTENSIONS}) have no name here.
 *
 * @param name - The name of the support.
 * @param messages - The interface messages.
 * @returns The label, or `undefined` for a support that the toolbar names.
 */
export function supportLabel(name: SupportName, messages: Messages): string | undefined {
  if (TOOL_EXTENSIONS.some((extension) => extension === name)) return undefined;
  if (name.startsWith(EXTENSION_PREFIX)) return name.slice(EXTENSION_PREFIX.length);
  const key = MESSAGE_OF.get(name);
  return key === undefined ? undefined : messages[key];
}
