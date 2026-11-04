/**
 * Personal needs and preferences (PNP): the model of a candidate's supports in the QTI profile of PNP 3.0, a reader and
 * writer for its XML binding, and the resolution of what a profile asks for.
 *
 * @module @assesskit/runtime/pnp
 */
export { isColorTheme } from "./lexical.js";
export type { PersonalNeedsProfile, PersonSourcedId, PnpRecord, SupportState } from "./model.js";
export { PNP_ALTERNATE_NAMESPACES, PNP_NAMESPACE } from "./namespace.js";
export { readPnp } from "./read-pnp.js";
export { resolveSupports } from "./resolve-supports.js";
export type {
  AdditionalTestingTime,
  Braille,
  CalculatorOnScreen,
  Environment,
  FontFace,
  HazardAvoidance,
  InputRequirements,
  InvertDisplayPolarity,
  LanguageOfInterface,
  LanguagePreference,
  LanguageSupport,
  LineReader,
  LongDescription,
  Magnification,
  ReplacesAccessModes,
  ReplacingSupport,
  Spoken,
  SupportSetting,
  TestingTime,
  TextAppearance,
  ToolSupport,
  Zoom,
} from "./settings.js";
export {
  deriveExtensionName,
  isSetSupportName,
  isSupportName,
  LANGUAGE_SUPPORTS,
  type LanguageSupportName,
  OTHER_SUPPORTS,
  type OtherSupportName,
  type PredefinedSupportName,
  REPLACING_SUPPORTS,
  type ReplacingSupportName,
  type SetSupportName,
  SUPPORT_NAMES,
  type SupportName,
  TOOL_SUPPORTS,
  type ToolSupportName,
} from "./support-names.js";
export {
  type BrailleDeliveryMode,
  type BrailleGrade,
  type BrailleMathType,
  type BrailleType,
  type CalculatorType,
  type ColorTheme,
  type GenericFontFace,
  type HazardTerm,
  type InputRequirement,
  type LinkIndication,
  PNP_ACCESS_MODES,
  PNP_BRAILLE_DELIVERY_MODES,
  PNP_BRAILLE_MATH_TYPES,
  PNP_BRAILLE_TYPES,
  PNP_CALCULATOR_TYPES,
  PNP_COLOR_THEMES,
  PNP_GENERIC_FONT_FACES,
  PNP_HAZARDS,
  PNP_INPUT_REQUIREMENTS,
  PNP_LINK_INDICATIONS,
  PNP_READING_TYPES,
  PNP_RESTRICTION_TYPES,
  PNP_TYPING_ECHOES,
  type PnpAccessMode,
  type PnpExtensionTerm,
  type ReadingType,
  type RestrictionType,
  type TypingEcho,
} from "./vocabularies.js";
export { writePnp } from "./write-pnp.js";
