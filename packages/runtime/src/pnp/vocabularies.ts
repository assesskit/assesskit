/** The text of an extension term: `ext:` and letters, `|`, `.` or `_`. */
export type PnpExtensionTerm = `ext:${string}`;

/** The terms of the access modes whose content a support replaces. */
export const PNP_ACCESS_MODES = [
  "auditory",
  "color",
  "item-size",
  "olfactory",
  "orientation",
  "position",
  "tactile",
  "text-on-image",
  "textual",
  "visual",
] as const;

/** The names of the elements that list the access modes a support replaces start with this. */
export const PNP_ACCESS_MODE_ELEMENT_PREFIX = "replace-access-mode-";

/** An access mode: the sense or form of content that a support replaces. */
export type PnpAccessMode = (typeof PNP_ACCESS_MODES)[number];

/** The terms of `hazard-avoidance`; the names that the DRD schema gives them differ. */
export const PNP_HAZARDS = ["flashing", "sound", "olfactory-hazard", "motion-simulation"] as const;

/** A stimulus a candidate avoids: a term of `hazard-avoidance`, or an extension term. */
export type HazardTerm = (typeof PNP_HAZARDS)[number] | PnpExtensionTerm;

/** The terms of `input-requirements`. */
export const PNP_INPUT_REQUIREMENTS = ["full-keyboard-control", "full-mouse-control"] as const;

/** A way the candidate must be able to operate the interface: a term of `input-requirements`, or an extension term. */
export type InputRequirement = (typeof PNP_INPUT_REQUIREMENTS)[number] | PnpExtensionTerm;

/** The terms of `reading-type`. */
export const PNP_READING_TYPES = ["screen-reader", "computer-read-aloud"] as const;

/** Who reads the content aloud: a term of `reading-type`. */
export type ReadingType = (typeof PNP_READING_TYPES)[number];

/** The terms of `restriction-type`. */
export const PNP_RESTRICTION_TYPES = [
  "unrestricted",
  "word-by-word",
  "directions-only",
  "skip-math-equations",
  "skip-chemistry-equations",
] as const;

/** What the reading skips or limits: a term of `restriction-type`, or an extension term. */
export type RestrictionType = (typeof PNP_RESTRICTION_TYPES)[number] | PnpExtensionTerm;

/** The terms of `link-indication`. */
export const PNP_LINK_INDICATIONS = ["speak-link", "different-voice", "sound-effect", "none"] as const;

/** How the reading marks a link: a term of `link-indication`. */
export type LinkIndication = (typeof PNP_LINK_INDICATIONS)[number];

/** The terms of `typing-echo`. */
export const PNP_TYPING_ECHOES = ["characters", "words", "characters-and-words", "none"] as const;

/** What the reading repeats while the candidate types: a term of `typing-echo`. */
export type TypingEcho = (typeof PNP_TYPING_ECHOES)[number];

/** The terms of `delivery-mode`. */
export const PNP_BRAILLE_DELIVERY_MODES = ["refreshable", "embossed"] as const;

/** How braille reaches the candidate: a term of `delivery-mode`. */
export type BrailleDeliveryMode = (typeof PNP_BRAILLE_DELIVERY_MODES)[number];

/** The grades of braille. */
export type BrailleGrade = 1 | 2 | 3;

/** The terms of `braille-type`. */
export const PNP_BRAILLE_TYPES = ["ebae", "ueb"] as const;

/** The kind of braille: a term of `braille-type`, or an extension term. */
export type BrailleType = (typeof PNP_BRAILLE_TYPES)[number] | PnpExtensionTerm;

/** The terms of `math-type`. */
export const PNP_BRAILLE_MATH_TYPES = ["nemeth", "ueb"] as const;

/** The encoding of mathematics in braille: a term of `math-type`, or an extension term. */
export type BrailleMathType = (typeof PNP_BRAILLE_MATH_TYPES)[number] | PnpExtensionTerm;

/** The terms of `generic-font-face`. */
export const PNP_GENERIC_FONT_FACES = ["serif", "sans serif", "monospaced", "cursive", "fantasy"] as const;

/** A family of fonts: a term of `generic-font-face`. */
export type GenericFontFace = (typeof PNP_GENERIC_FONT_FACES)[number];

/** The terms of `calculator-type`. */
export const PNP_CALCULATOR_TYPES = ["basic", "standard", "scientific", "graphing"] as const;

/** The kind of calculator: a term of `calculator-type`, or an extension term. */
export type CalculatorType = (typeof PNP_CALCULATOR_TYPES)[number] | PnpExtensionTerm;
