import fc from "fast-check";
import type {
  PersonalNeedsProfile,
  PnpAccessMode,
  PnpRecord,
  PredefinedSupportName,
  SetSupportName,
  SupportSetting,
  TestingTime,
} from "../../src/pnp/index.js";
import { SUPPORT_NAMES } from "../../src/pnp/index.js";
import { defined, nonEmptyText, optional, text } from "./values.js";
import { extensionElement } from "./xml.js";

const PNP_ACCESS_MODES = [
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

const PNP_HAZARDS = ["flashing", "sound", "olfactory-hazard", "motion-simulation"] as const;
const PNP_INPUT_REQUIREMENTS = ["full-keyboard-control", "full-mouse-control"] as const;
const PNP_RESTRICTION_TYPES = [
  "unrestricted",
  "word-by-word",
  "directions-only",
  "skip-math-equations",
  "skip-chemistry-equations",
] as const;
const PNP_BRAILLE_TYPES = ["ebae", "ueb"] as const;
const MATH_TYPES = ["nemeth", "ueb"] as const;
const PNP_CALCULATOR_TYPES = ["basic", "standard", "scientific", "graphing"] as const;

const modes: fc.Arbitrary<PnpAccessMode[]> = fc.uniqueArray(fc.constantFrom(...PNP_ACCESS_MODES), { maxLength: 3 });
const language = fc.constantFrom("en", "pt-BR", "ase", "es-419", "");
const hexColor = fc.stringMatching(/^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/);
const integer = fc.maxSafeInteger();
/** A decimal that `xs:float` accepts and that reads back exactly: moderate in size, and never `-0`. */
const float = fc
  .double({ min: -1e6, max: 1e6, noNaN: true })
  .filter((value) => value === 0 || Math.abs(value) >= 1e-30)
  .map((value) => value + 0);
const volume = fc
  .double({ min: -1e6, max: 1, noNaN: true })
  .filter((value) => value === 0 || Math.abs(value) >= 1e-30)
  .map((value) => value + 0);
const extensionTerm: fc.Arbitrary<`ext:${string}`> = fc.stringMatching(
  /^ext:[A-Za-z|._]{1,8}$/,
) as fc.Arbitrary<`ext:${string}`>;
/** A term of a vocabulary or, sometimes, an extension term. */
const termOrExtension = <T extends string>(terms: readonly T[]): fc.Arbitrary<T | `ext:${string}`> =>
  fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...terms) }, { weight: 1, arbitrary: extensionTerm });

const testingTime: fc.Arbitrary<TestingTime> = fc.oneof(
  float.map((multiplier): TestingTime => ({ kind: "time-multiplier", multiplier })),
  integer.map((minutes): TestingTime => ({ kind: "fixed-minutes", minutes })),
  fc.constant<TestingTime>({ kind: "unlimited" }),
);

const zoom = fc.record({ zoomAmount: optional(float) }).map((fields) => defined(fields));

const REPLACING = [
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
const LANGUAGE = ["keyword-translation", "item-translation", "sign-language"] as const;
const TOOLS = [
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

/** Arbitrary settings of the support with the given name. */
export function settingFor(name: PredefinedSupportName): fc.Arbitrary<SupportSetting> {
  const settings = (fields: fc.Arbitrary<object>): fc.Arbitrary<SupportSetting> =>
    fc
      .tuple(fields, modes)
      .map(([own, replaceAccessModes]) => defined({ ...own, name, replaceAccessModes }) as SupportSetting);
  for (const family of REPLACING) if (family === name) return settings(fc.constant({}));
  for (const family of LANGUAGE) if (family === name) return settings(fc.record({ language }));
  for (const family of TOOLS) if (family === name) return fc.constant({ name: family });
  switch (name) {
    case "hazard-avoidance":
      return fc
        .array(termOrExtension(PNP_HAZARDS), {
          minLength: 1,
          maxLength: 3,
        })
        .map((hazards): SupportSetting => ({ name, hazards }));
    case "input-requirements":
      return termOrExtension(PNP_INPUT_REQUIREMENTS).map((requirement): SupportSetting => ({ name, requirement }));
    case "language-of-interface":
      return fc
        .array(
          fc.tuple(language, modes).map(([tag, replaceAccessModes]) => ({ language: tag, replaceAccessModes })),
          { minLength: 1, maxLength: 3 },
        )
        .map((languages): SupportSetting => ({ name, languages }));
    case "additional-testing-time":
      return settings(fc.record({ time: testingTime }));
    case "line-reader":
      return settings(fc.record({ highlightColor: optional(hexColor) }));
    case "invert-display-polarity":
      return settings(fc.record({ foreground: optional(hexColor), background: optional(hexColor) }));
    case "magnification":
      return fc.oneof(
        settings(fc.record({ allContent: zoom })),
        settings(fc.record({ text: optional(zoom), nonText: optional(zoom) })),
      );
    case "spoken":
      return settings(
        fc.record({
          readingType: optional(fc.constantFrom("screen-reader", "computer-read-aloud")),
          restrictionTypes: fc.array(termOrExtension(PNP_RESTRICTION_TYPES), { maxLength: 3 }),
          speechRate: optional(integer),
          pitch: optional(float),
          volume: optional(volume),
          linkIndication: optional(fc.constantFrom("speak-link", "different-voice", "sound-effect", "none")),
          typingEcho: optional(fc.constantFrom("characters", "words", "characters-and-words", "none")),
        }),
      );
    case "braille":
      return settings(
        fc.record({
          language: optional(language),
          deliveryMode: optional(fc.constantFrom("refreshable", "embossed")),
          grade: optional(fc.constantFrom(1, 2, 3)),
          brailleType: optional(termOrExtension(PNP_BRAILLE_TYPES)),
          mathType: optional(termOrExtension(MATH_TYPES)),
        }),
      );
    case "long-description":
      return settings(fc.record({ hideVisually: optional(fc.boolean()) }));
    case "environment":
      return settings(
        fc.record({
          description: optional(text),
          medical: optional(text),
          software: optional(text),
          hardware: optional(text),
          breaks: optional(fc.boolean()),
        }),
      );
    case "text-appearance":
      return settings(
        fc.record({
          backgroundColor: optional(hexColor),
          fontColor: optional(hexColor),
          fontSize: optional(float),
          fontFace: optional(
            fc
              .record({
                fontNames: fc.array(nonEmptyText, { maxLength: 3 }),
                genericFontFace: optional(fc.constantFrom("serif", "sans serif", "monospaced", "cursive", "fantasy")),
              })
              .map((fields) => defined(fields)),
          ),
          lineSpacing: optional(float),
          lineHeight: optional(float),
          letterSpacing: optional(float),
          uniformFontSizing: optional(fc.constant(true)),
          wordSpacing: optional(float),
          wordWrapping: optional(fc.constant(true)),
        }),
      );
    case "calculator-on-screen":
      return fc
        .record({
          name: fc.constant(name),
          calculatorType: optional(termOrExtension(PNP_CALCULATOR_TYPES)),
        })
        .map((fields) => defined(fields));
    default:
      throw new Error(`No arbitrary for the support ${name}.`);
  }
}

const setNames: fc.Arbitrary<SetSupportName[]> = fc.uniqueArray(
  fc.constantFrom(
    ...SUPPORT_NAMES.filter((name): name is SetSupportName => name !== "hazard-avoidance" && name !== "environment"),
  ),
  { maxLength: 4 },
);

/** Arbitrary profiles. `extensions` adds custom supports in a namespace the PNP schema does not know. */
export function personalNeedsProfile(options: { readonly extensions: boolean }): fc.Arbitrary<PersonalNeedsProfile> {
  const supports = fc
    .uniqueArray(fc.constantFrom(...SUPPORT_NAMES), { maxLength: 6 })
    .chain((names) => fc.tuple(...names.map(settingFor)))
    .map((settingList) => new Map(settingList.map((setting) => [setting.name as PredefinedSupportName, setting])));
  const extensions = options.extensions ? fc.array(extensionElement, { maxLength: 2 }) : fc.constant([]);
  return fc.record({
    supports,
    activateAsOption: setNames.map((names) => new Set(names)),
    activateAtInitialization: setNames.map((names) => new Set(names)),
    prohibited: setNames.map((names) => new Set(names)),
    extensions,
  });
}

/** Arbitrary records of a bulk file. */
export const pnpRecords: fc.Arbitrary<PnpRecord[]> = fc.array(
  fc.record({
    personSourcedId: fc.record({ sourceSystem: text, id: nonEmptyText }),
    appointmentIds: fc.array(nonEmptyText, { maxLength: 2 }),
    profile: personalNeedsProfile({ extensions: false }),
  }),
  { minLength: 1, maxLength: 3 },
);

/** Returns the profile that `readPnp` read, and fails if it read the records of a bulk file instead. */
export function asProfile(read: PersonalNeedsProfile | readonly PnpRecord[]): PersonalNeedsProfile {
  if (!("supports" in read)) throw new Error("The document is a bulk file.");
  return read;
}
