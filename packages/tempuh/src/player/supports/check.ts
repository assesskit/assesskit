import type { SupportView } from "@luthfanwakan/olah/delivery";
import {
  isSupportName,
  PNP_BRAILLE_DELIVERY_MODES,
  PNP_GENERIC_FONT_FACES,
  type SupportName,
  type SupportState,
} from "@luthfanwakan/olah/pnp";
import {
  checkArray,
  checkBoolean,
  checkChoice,
  checkFinite,
  checkNonEmptyString,
  checkProperties,
  checkRecord,
  checkString,
  describe,
} from "../../checks.js";
import { DataError } from "../../errors.js";

/** The states of a support for a candidate (BPIG §5.3), as olah's `resolveSupports` gives them. */
const SUPPORT_STATES = ["prohibited", "active", "option", "assigned"] as const satisfies readonly SupportState[];

/** The colors of the profile are `#RGB` or `#RRGGBB` (PNP XSD `HexDType`). */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;

type Settings = Readonly<Record<string, unknown>>;

/** Checks a color of the profile. */
function checkColor(value: unknown, label: string): void {
  checkString(value, label);
  if (!HEX_COLOR.test(value)) {
    throw new DataError(`${label} must be a color as #RGB or #RRGGBB, found ${describe(value)}.`);
  }
}

function checkOptional(value: unknown, check: (present: unknown) => void): void {
  if (value !== undefined) check(value);
}

/** Checks a zoom of the profile: `{ zoomAmount? }`. */
function checkZoom(value: unknown, label: string): void {
  checkRecord(value, `${label} must be an object`);
  checkOptional(value.zoomAmount, (amount) => checkFinite(amount, `${label} property zoomAmount`));
}

function checkFontFace(value: unknown, label: string): void {
  checkRecord(value, `${label} must be an object`);
  checkArray(value.fontNames, `${label} property fontNames must be an array`);
  for (const name of value.fontNames) checkString(name, `A name in ${label} property fontNames`);
  checkOptional(value.genericFontFace, (face) =>
    checkChoice(face, `${label} property genericFontFace`, PNP_GENERIC_FONT_FACES),
  );
}

function checkTextAppearance(settings: Settings, label: string): void {
  checkOptional(settings.backgroundColor, (color) => checkColor(color, `${label} property backgroundColor`));
  checkOptional(settings.fontColor, (color) => checkColor(color, `${label} property fontColor`));
  checkOptional(settings.fontSize, (size) => checkFinite(size, `${label} property fontSize`));
  checkOptional(settings.fontFace, (face) => checkFontFace(face, `${label} property fontFace`));
  for (const name of ["lineSpacing", "lineHeight", "letterSpacing", "wordSpacing"]) {
    checkOptional(settings[name], (number) => checkFinite(number, `${label} property ${name}`));
  }
  for (const name of ["uniformFontSizing", "wordWrapping"]) {
    if (settings[name] !== undefined && settings[name] !== true) {
      throw new DataError(
        `${label} property ${name} must be true when it is present, found ${describe(settings[name])}.`,
      );
    }
  }
}

function checkLanguage(settings: Settings, label: string): void {
  checkNonEmptyString(settings.language, `${label} property language`);
}

/** The checks of the settings that the player reads, by the name of the support; olah has checked the rest. */
const SETTING_CHECKS: ReadonlyMap<string, (settings: Settings, label: string) => void> = new Map([
  [
    "line-reader",
    (settings, label) =>
      checkOptional(settings.highlightColor, (color) => checkColor(color, `${label} property highlightColor`)),
  ],
  [
    "calculator-on-screen",
    (settings, label) =>
      checkOptional(settings.calculatorType, (type) => checkString(type, `${label} property calculatorType`)),
  ],
  [
    "invert-display-polarity",
    (settings, label) => {
      checkOptional(settings.foreground, (color) => checkColor(color, `${label} property foreground`));
      checkOptional(settings.background, (color) => checkColor(color, `${label} property background`));
    },
  ],
  [
    "magnification",
    (settings, label) => {
      for (const name of ["allContent", "text", "nonText"]) {
        checkOptional(settings[name], (zoom) => checkZoom(zoom, `${label} property ${name}`));
      }
    },
  ],
  ["text-appearance", checkTextAppearance],
  [
    "braille",
    (settings, label) =>
      checkOptional(settings.deliveryMode, (mode) =>
        checkChoice(mode, `${label} property deliveryMode`, PNP_BRAILLE_DELIVERY_MODES),
      ),
  ],
  [
    "long-description",
    (settings, label) =>
      checkOptional(settings.hideVisually, (hide) => checkBoolean(hide, `${label} property hideVisually`)),
  ],
  ["keyword-translation", checkLanguage],
  ["item-translation", checkLanguage],
  ["sign-language", checkLanguage],
  [
    "language-of-interface",
    (settings, label) => {
      checkArray(settings.languages, `${label} property languages must be an array`);
      settings.languages.forEach((entry, index) => {
        checkRecord(entry, `${label} property languages[${index}] must be an object`);
        checkLanguage(entry, `${label} property languages[${index}]`);
      });
    },
  ],
]);

function checkSupportView(value: unknown, label: string): void {
  checkRecord(value, `${label} must be an object`);
  checkProperties(value, label, ["name", "state", "active", "settings"]);
  if (!isSupportName(value.name)) {
    throw new DataError(`${label} property name must be the name of a support, found ${describe(value.name)}.`);
  }
  checkChoice(value.state, `${label} property state`, SUPPORT_STATES);
  checkBoolean(value.active, `${label} property active`);
  const { settings } = value;
  if (settings === undefined) return;
  checkRecord(settings, `${label} property settings must be an object`);
  if (settings.name !== value.name) {
    throw new DataError(
      `${label} property settings must have the name ${describe(value.name)} of its support, found ${describe(settings.name)}.`,
    );
  }
  SETTING_CHECKS.get(value.name)?.(settings, `${label} property settings`);
}

/**
 * Checks the supports of a view, as a host passes them from JavaScript or JSON: olah's `SupportView`s, with the settings
 * that the player reads.
 *
 * @param label - Names the list in the error message, such as `The option supports`.
 * @throws `DataError` when the list is not an array, a support has the wrong type, an unknown property, a name that is
 * not a support, or settings that are not those of its support or are out of range.
 */
export function checkSupportViews(value: unknown, label: string): asserts value is readonly SupportView[] {
  checkArray(value, `${label} must be an array`);
  value.forEach((support, index) => {
    checkSupportView(support, `${label}[${index}]`);
  });
}

/** Returns the support of the list with the name when it is on, else `undefined`. */
export function activeSupport(supports: readonly SupportView[], name: SupportName): SupportView | undefined {
  return supports.find((support) => support.name === name && support.active);
}
