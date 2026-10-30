import type { SupportName } from "@luthfanwakan/olah/pnp";
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

/** The prefix of the name of a custom support (BPIG §5.4). */
const EXTENSION_PREFIX = "ext:";

/**
 * Returns the name of a support in the language of the interface: a message for a predefined support, and the local name
 * of a custom one (BPIG §5.4). The supports that a tool of the toolbar turns on and off (`line-reader`, `answer-masking`
 * and the on-screen tools but the glossary) have no name here, and the result is `undefined`.
 */
export function supportLabel(name: SupportName, messages: Messages): string | undefined {
  if (name.startsWith(EXTENSION_PREFIX)) return name.slice(EXTENSION_PREFIX.length);
  const key = MESSAGE_OF.get(name);
  return key === undefined ? undefined : messages[key];
}
