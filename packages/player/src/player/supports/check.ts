import {
  describe,
  finiteSchema,
  guardSchema,
  issueText,
  looseRecord,
  nonEmptyStringSchema,
  parseWith,
  recordSchema,
  type Schema,
  strictRecord,
} from "@assesskit/runtime/checks";
import type { SupportView } from "@assesskit/runtime/delivery";
import {
  type ColorTheme,
  isColorTheme,
  isSupportName,
  PNP_BRAILLE_DELIVERY_MODES,
  PNP_GENERIC_FONT_FACES,
  type SupportName,
  type SupportState,
} from "@assesskit/runtime/pnp";
import * as v from "valibot";

/**
 * The states of a support for a candidate, as the runtime's `resolveSupports` gives them.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, support states}
 */
const SUPPORT_STATES = ["prohibited", "active", "option", "assigned"] as const satisfies readonly SupportState[];

/** The colors of the profile are `#RGB` or `#RRGGBB`, as `HexDType` of the PNP schema has them. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;

const colorSchema = v.pipe(
  v.string(),
  v.regex(HEX_COLOR, (issue) => `expected a color as #RGB or #RRGGBB, found ${issue.received}`),
);

const optionalColor = v.optional(colorSchema);
const optionalNumber = v.optional(finiteSchema);

/** A zoom of the profile: `{ zoomAmount? }`. */
const zoomSchema = looseRecord({ zoomAmount: optionalNumber });

/** The settings that name a language, as the translations and the sign language do. */
const languageSchema = looseRecord({ language: nonEmptyStringSchema });

/** A property of the text appearance that is true when it is present. */
const presentSchema = v.optional(
  v.literal(true, (issue) => `expected true when it is present, found ${issue.received}`),
);

/** The schemas of the settings that the player reads, by the name of the support; the runtime has checked the rest. */
const SETTING_SCHEMAS: ReadonlyMap<string, Schema<unknown>> = new Map<string, Schema<unknown>>([
  ["line-reader", looseRecord({ highlightColor: optionalColor })],
  ["calculator-on-screen", looseRecord({ calculatorType: v.optional(v.string()) })],
  ["invert-display-polarity", looseRecord({ foreground: optionalColor, background: optionalColor })],
  [
    "magnification",
    looseRecord({
      allContent: v.optional(zoomSchema),
      text: v.optional(zoomSchema),
      nonText: v.optional(zoomSchema),
    }),
  ],
  [
    "text-appearance",
    looseRecord({
      colorTheme: v.optional(guardSchema(isColorTheme, "a term of color-theme or ext: and at most 256 characters")),
      backgroundColor: optionalColor,
      fontColor: optionalColor,
      fontSize: optionalNumber,
      fontFace: v.optional(
        looseRecord({
          fontNames: v.array(v.string()),
          genericFontFace: v.optional(v.picklist(PNP_GENERIC_FONT_FACES)),
        }),
      ),
      lineSpacing: optionalNumber,
      lineHeight: optionalNumber,
      letterSpacing: optionalNumber,
      wordSpacing: optionalNumber,
      uniformFontSizing: presentSchema,
      wordWrapping: presentSchema,
    }),
  ],
  ["braille", looseRecord({ deliveryMode: v.optional(v.picklist(PNP_BRAILLE_DELIVERY_MODES)) })],
  ["long-description", looseRecord({ hideVisually: v.optional(v.boolean()) })],
  ["keyword-translation", languageSchema],
  ["item-translation", languageSchema],
  ["sign-language", languageSchema],
  ["language-of-interface", looseRecord({ languages: v.array(languageSchema) })],
]);

const supportViewShape = strictRecord({
  name: guardSchema(isSupportName, "the name of a support"),
  state: v.picklist(SUPPORT_STATES),
  active: v.boolean(),
  settings: v.optional(recordSchema),
});

const supportViewSchema = v.pipe(
  supportViewShape,
  v.rawCheck<v.InferOutput<typeof supportViewShape>>(({ dataset, addIssue }) => {
    if (!dataset.typed || dataset.value.settings === undefined) return;
    const { name, settings } = dataset.value;
    if (settings.name !== name) {
      addIssue({
        message: `the settings must have the name ${describe(name)} of their support, found ${describe(settings.name)}`,
      });
      return;
    }
    const result = v.safeParse(SETTING_SCHEMAS.get(name) ?? v.unknown(), settings, { abortEarly: true });
    if (!result.success) addIssue({ message: `the settings are invalid at ${issueText(result.issues[0])}` });
  }),
);

/**
 * Checks the supports of a view, as a host passes them from JavaScript or JSON: the runtime's `SupportView`s, with the
 * settings that the player reads.
 *
 * @param value - The value to check.
 * @param label - Names the list in the error message, such as `The option supports`.
 * @throws `DataError` when the list is not an array, a support has the wrong type, an unknown property, a name that is
 * not a support, or settings that are not those of its support or are out of range.
 */
export function checkSupportViews(value: unknown, label: string): asserts value is readonly SupportView[] {
  parseWith(v.array(supportViewSchema), value, label);
}

/**
 * Returns the support of the list with a name when it is on.
 *
 * @param supports - The supports of the view.
 * @param name - The name of the support.
 * @returns The support, or `undefined` when it is absent or off.
 */
export function activeSupport(supports: readonly SupportView[], name: SupportName): SupportView | undefined {
  return supports.find((support) => support.name === name && support.active);
}

/**
 * Returns the color theme of the profile, while the support of the text appearance is on.
 *
 * @param supports - The supports of the view.
 * @returns The term, or `undefined` when the profile names none.
 */
export function colorThemeOf(supports: readonly SupportView[]): ColorTheme | undefined {
  const settings = activeSupport(supports, "text-appearance")?.settings;
  return settings?.name === "text-appearance" ? settings.colorTheme : undefined;
}
