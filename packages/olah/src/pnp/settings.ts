import type { LanguageSupportName, ReplacingSupportName, ToolSupportName } from "./support-names.js";
import type {
  BrailleDeliveryMode,
  BrailleGrade,
  BrailleMathType,
  BrailleType,
  CalculatorType,
  GenericFontFace,
  HazardTerm,
  InputRequirement,
  LinkIndication,
  PnpAccessMode,
  ReadingType,
  RestrictionType,
  TypingEcho,
} from "./vocabularies.js";

/** What every support but the on-screen tools says about the content it replaces (PNP XSD `ReplacesAccessModeDType`). */
export interface ReplacesAccessModes {
  /** The access modes whose content the support replaces. */
  readonly replaceAccessModes: readonly PnpAccessMode[];
}

/** A support that only replaces content, such as `captions` or `high-contrast`. */
export interface ReplacingSupport extends ReplacesAccessModes {
  /** The name of the support. */
  readonly name: ReplacingSupportName;
}

/** A language the candidate prefers for a support (PNP XSD `LanguageModeDType`). */
export interface LanguagePreference extends ReplacesAccessModes {
  /** The language, a BCP 47 tag (`xml:lang`). */
  readonly language: string;
}

/** A support for a language: `item-translation`, `keyword-translation` or `sign-language`. */
export interface LanguageSupport extends LanguagePreference {
  /** The name of the support. */
  readonly name: LanguageSupportName;
}

/** The languages of the interface, most preferred first: the element occurs once for each (PNP XSD). */
export interface LanguageOfInterface {
  /** The name of the support. */
  readonly name: "language-of-interface";
  /** The languages, at least one. */
  readonly languages: readonly LanguagePreference[];
}

/** An on-screen tool, which has no parameter. */
export interface ToolSupport {
  /** The name of the support. */
  readonly name: ToolSupportName;
}

/** The stimuli the candidate must not be exposed to: the element occurs once for each (BPIG §5.2.5). */
export interface HazardAvoidance {
  /** The name of the support. */
  readonly name: "hazard-avoidance";
  /** The hazards, at least one. */
  readonly hazards: readonly HazardTerm[];
}

/** What the candidate needs to operate the interface (PNP XSD). */
export interface InputRequirements {
  /** The name of the support. */
  readonly name: "input-requirements";
  /** The requirement. */
  readonly requirement: InputRequirement;
}

/** How the extra time is given (BPIG §5.2.4). */
export type TestingTime =
  | {
      /** Tells the three ways apart. */
      readonly kind: "time-multiplier";
      /** The factor that multiplies each maximum time. */
      readonly multiplier: number;
    }
  | {
      /** Tells the three ways apart. */
      readonly kind: "fixed-minutes";
      /** The minutes added. */
      readonly minutes: number;
    }
  | {
      /** Tells the three ways apart. */
      readonly kind: "unlimited";
    };

/** Extra testing time (BPIG §5.2.4). */
export interface AdditionalTestingTime extends ReplacesAccessModes {
  /** The name of the support. */
  readonly name: "additional-testing-time";
  /** How the time is given. */
  readonly time: TestingTime;
}

/** A line reader (PNP XSD). */
export interface LineReader extends ReplacesAccessModes {
  /** The name of the support. */
  readonly name: "line-reader";
  /** The color of the highlight, `#RGB` or `#RRGGBB`. */
  readonly highlightColor?: string;
}

/** Inverted display polarity (PNP XSD). */
export interface InvertDisplayPolarity extends ReplacesAccessModes {
  /** The name of the support. */
  readonly name: "invert-display-polarity";
  /** The foreground color, `#RGB` or `#RRGGBB`. */
  readonly foreground?: string;
  /** The background color, `#RGB` or `#RRGGBB`. */
  readonly background?: string;
}

/** A zoom (PNP XSD `ZoomAmountDType`). */
export interface Zoom {
  /** The factor by which to enlarge. */
  readonly zoomAmount?: number;
}

/** Magnification: of all content, or of text and non-text separately (BPIG §5.2.9.6). */
export interface Magnification extends ReplacesAccessModes {
  /** The name of the support. */
  readonly name: "magnification";
  /** The zoom of all content; it excludes `text` and `nonText`. */
  readonly allContent?: Zoom;
  /** The zoom of text. */
  readonly text?: Zoom;
  /** The zoom of images and other content that is not text. */
  readonly nonText?: Zoom;
}

/** Reading aloud (BPIG §5.2.1). */
export interface Spoken extends ReplacesAccessModes {
  /** The name of the support. */
  readonly name: "spoken";
  /** Who reads. */
  readonly readingType?: ReadingType;
  /** What the reading skips or limits; several may apply. */
  readonly restrictionTypes: readonly RestrictionType[];
  /** Words per minute. */
  readonly speechRate?: number;
  /** The pitch of the voice. */
  readonly pitch?: number;
  /** The volume, at most 1. */
  readonly volume?: number;
  /** How a link is marked. */
  readonly linkIndication?: LinkIndication;
  /** What is repeated while the candidate types. */
  readonly typingEcho?: TypingEcho;
}

/** Braille (BPIG §5.2.2). */
export interface Braille extends ReplacesAccessModes {
  /** The name of the support. */
  readonly name: "braille";
  /** The language of the braille (`xml:lang`). */
  readonly language?: string;
  /** How braille is delivered. */
  readonly deliveryMode?: BrailleDeliveryMode;
  /** The grade of the braille. */
  readonly grade?: BrailleGrade;
  /** The kind of braille. */
  readonly brailleType?: BrailleType;
  /** The encoding of mathematics. */
  readonly mathType?: BrailleMathType;
}

/** A long description of images (PNP XSD). */
export interface LongDescription extends ReplacesAccessModes {
  /** The name of the support. */
  readonly name: "long-description";
  /** Whether the description is hidden from sighted candidates. Absent means true (PNP XSD default). */
  readonly hideVisually?: boolean;
}

/** The physical environment of the candidate (BPIG §5.2.11). */
export interface Environment extends ReplacesAccessModes {
  /** The name of the support. */
  readonly name: "environment";
  /** A description of the environment. */
  readonly description?: string;
  /** Medical needs. */
  readonly medical?: string;
  /** Software the candidate needs. */
  readonly software?: string;
  /** Hardware the candidate needs. */
  readonly hardware?: string;
  /** Whether the candidate needs breaks. */
  readonly breaks?: boolean;
}

/** The face of the text: font names in order of preference, and a generic family (PNP XSD `FontFaceDType`). */
export interface FontFace {
  /** The names of the fonts. */
  readonly fontNames: readonly string[];
  /** The generic family. */
  readonly genericFontFace?: GenericFontFace;
}

/** How text looks (BPIG §5.2.9.7). */
export interface TextAppearance extends ReplacesAccessModes {
  /** The name of the support. */
  readonly name: "text-appearance";
  /** The background color, `#RGB` or `#RRGGBB`. */
  readonly backgroundColor?: string;
  /** The font color, `#RGB` or `#RRGGBB`. */
  readonly fontColor?: string;
  /** The font size. */
  readonly fontSize?: number;
  /** The font face. */
  readonly fontFace?: FontFace;
  /** The spacing of lines. */
  readonly lineSpacing?: number;
  /** The height of lines. */
  readonly lineHeight?: number;
  /** The spacing of letters. */
  readonly letterSpacing?: number;
  /** Whether all text has one size; the element is empty, so only `true` is a value. */
  readonly uniformFontSizing?: true;
  /** The spacing of words. */
  readonly wordSpacing?: number;
  /** Whether words wrap; the element is empty, so only `true` is a value. */
  readonly wordWrapping?: true;
}

/** An on-screen calculator (PNP XSD). */
export interface CalculatorOnScreen {
  /** The name of the support. */
  readonly name: "calculator-on-screen";
  /** The kind of calculator. */
  readonly calculatorType?: CalculatorType;
}

/**
 * The settings of one predefined support. Its `name` tells the shape; `PersonalNeedsProfile.supports` holds one for each
 * support that a profile assigns, under the same name.
 */
export type SupportSetting =
  | ReplacingSupport
  | LanguageSupport
  | LanguageOfInterface
  | ToolSupport
  | HazardAvoidance
  | InputRequirements
  | AdditionalTestingTime
  | LineReader
  | InvertDisplayPolarity
  | Magnification
  | Spoken
  | Braille
  | LongDescription
  | Environment
  | TextAppearance
  | CalculatorOnScreen;
