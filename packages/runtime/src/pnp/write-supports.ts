import { checkArray, checkChoice, checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { isXmlLanguage, type XmlElement } from "../xml/index.js";
import { elementBuilder } from "../xml/internal.js";
import { booleanText, floatText, hexColorText, integerText, isColorTheme, termText, volumeText } from "./lexical.js";
import { PNP_NAMESPACE } from "./namespace.js";
import type {
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
  TextAppearance,
  ToolSupport,
  Zoom,
} from "./settings.js";
import { isLanguageSupportName, isReplacingSupportName, isToolSupportName } from "./support-names.js";
import {
  PNP_ACCESS_MODE_ELEMENT_PREFIX,
  PNP_ACCESS_MODES,
  PNP_BRAILLE_DELIVERY_MODES,
  PNP_BRAILLE_MATH_TYPES,
  PNP_BRAILLE_TYPES,
  PNP_CALCULATOR_TYPES,
  PNP_GENERIC_FONT_FACES,
  PNP_HAZARDS,
  PNP_INPUT_REQUIREMENTS,
  PNP_LINK_INDICATIONS,
  PNP_READING_TYPES,
  PNP_RESTRICTION_TYPES,
  PNP_TYPING_ECHOES,
} from "./vocabularies.js";

/** The grades of braille as the schema lists them. */
const BRAILLE_GRADES = [1, 2, 3];

const element = elementBuilder(PNP_NAMESPACE);

/** Writes a value that may be absent: `undefined` is absent and every other value, `null` included, is formatted. */
const optionalWith = <T>(value: T | undefined, format: (value: T) => string): string | undefined =>
  value === undefined ? undefined : format(value);

/** Writes a parameter as a child element with text; a parameter that is absent is no element. */
function parameter<T>(name: string, value: T | undefined, format: (value: T) => string): XmlElement[] {
  return value === undefined ? [] : [element(name, {}, [format(value)])];
}

/** Returns a function that checks one of some terms and returns it. */
function choiceText<T extends string>(terms: readonly T[], label: string): (value: unknown) => string {
  return (value) => {
    checkChoice(value, label, terms);
    return value;
  };
}

function stringText(label: string): (value: unknown) => string {
  return (value) => {
    checkString(value, label);
    return value;
  };
}

/** Writes an empty element that stands for `true`; `false` is not a value, because the element is absent then. */
function flagParameter(name: string, value: true | undefined): XmlElement[] {
  if (value === undefined) return [];
  if (value !== true) throw new DataError(`The parameter ${name} must be true or absent, found ${describe(value)}.`);
  return [element(name)];
}

function listOf<T>(value: readonly T[], label: string, minimum: number): readonly T[] {
  checkArray(value, `${label} must be an array`);
  if (value.length < minimum) throw new DataError(`${label} needs at least one entry.`);
  return value;
}

/** Writes the access modes a support replaces; each is a term, and none is repeated. */
function modeElements({ replaceAccessModes }: ReplacesAccessModes, name: string): XmlElement[] {
  const label = `The replaceAccessModes of ${name}`;
  const modes = listOf(replaceAccessModes, label, 0);
  for (const mode of modes) checkChoice(mode, `A mode in ${label}`, PNP_ACCESS_MODES);
  if (new Set(modes).size !== modes.length) throw new DataError(`${label} must not repeat a mode.`);
  return modes.map((mode) => element(`${PNP_ACCESS_MODE_ELEMENT_PREFIX}${mode}`));
}

function languageAttribute(language: unknown, label: string): string {
  if (!isXmlLanguage(language)) {
    throw new DataError(`${label} must be a language tag such as en or pt-BR, found ${describe(language)}.`);
  }
  return language;
}

function writeLanguagePreference(name: string, preference: LanguagePreference): XmlElement {
  checkRecord(preference, `A language preference of ${name} must be an object`);
  return element(
    name,
    { "xml:lang": languageAttribute(preference.language, `The language of ${name}`) },
    modeElements(preference, name),
  );
}

function writeLanguageOfInterface(setting: LanguageOfInterface): XmlElement[] {
  const languages = listOf(setting.languages, "The languages of language-of-interface", 1);
  return languages.map((preference) => writeLanguagePreference(setting.name, preference));
}

function writeHazardAvoidance(setting: HazardAvoidance): XmlElement[] {
  const hazards = listOf(setting.hazards, "The hazards of hazard-avoidance", 1);
  return hazards.map((hazard) => element(setting.name, {}, [termText(hazard, PNP_HAZARDS, "A hazard")]));
}

function writeInputRequirements(setting: InputRequirements): XmlElement {
  const text = termText(setting.requirement, PNP_INPUT_REQUIREMENTS, "An input requirement");
  return element(setting.name, {}, [text]);
}

function writeAdditionalTestingTime(setting: AdditionalTestingTime): XmlElement {
  checkRecord(setting.time, "The time of additional-testing-time must be an object");
  const { time } = setting;
  const name = setting.name;
  const modes = modeElements(setting, name);
  switch (time.kind) {
    case "time-multiplier":
      return element(name, {}, [
        ...modes,
        element("time-multiplier", {}, [floatText(time.multiplier, "The time multiplier")]),
      ]);
    case "fixed-minutes":
      return element(name, {}, [
        ...modes,
        element("fixed-minutes", {}, [integerText(time.minutes, "The fixed minutes")]),
      ]);
    case "unlimited":
      return element(name, {}, [...modes, element("unlimited")]);
    default:
      throw new DataError(
        `The kind of the time of additional-testing-time must be "time-multiplier", "fixed-minutes" or "unlimited", found ${describe(Reflect.get(time, "kind"))}.`,
      );
  }
}

function writeLineReader(setting: LineReader): XmlElement {
  const attributes = {
    "highlight-color": optionalWith(setting.highlightColor, (value) => hexColorText(value, "The highlight color")),
  };
  return element(setting.name, attributes, modeElements(setting, setting.name));
}

function writeInvertDisplayPolarity(setting: InvertDisplayPolarity): XmlElement {
  const attributes = {
    foreground: optionalWith(setting.foreground, (value) => hexColorText(value, "The foreground color")),
    background: optionalWith(setting.background, (value) => hexColorText(value, "The background color")),
  };
  return element(setting.name, attributes, modeElements(setting, setting.name));
}

function zoomElement(name: string, zoom: Zoom | undefined): XmlElement[] {
  if (zoom === undefined) return [];
  checkRecord(zoom, `The zoom ${name} must be an object`);
  return [
    element(name, { "zoom-amount": optionalWith(zoom.zoomAmount, (value) => floatText(value, "The zoom amount")) }),
  ];
}

function writeMagnification(setting: Magnification): XmlElement {
  const { allContent, text, nonText } = setting;
  if (allContent !== undefined && (text !== undefined || nonText !== undefined)) {
    throw new DataError("A magnification has either allContent, or text and nonText.");
  }
  return element(setting.name, {}, [
    ...modeElements(setting, setting.name),
    ...zoomElement("all-content", allContent),
    ...zoomElement("text", text),
    ...zoomElement("non-text", nonText),
  ]);
}

function writeSpoken(setting: Spoken): XmlElement {
  const restrictions = listOf(setting.restrictionTypes, "The restrictionTypes of spoken", 0);
  return element(setting.name, {}, [
    ...modeElements(setting, setting.name),
    ...parameter("reading-type", setting.readingType, choiceText(PNP_READING_TYPES, "The reading type")),
    ...restrictions.map((restriction) =>
      element("restriction-type", {}, [termText(restriction, PNP_RESTRICTION_TYPES, "A restriction type")]),
    ),
    ...parameter("speech-rate", setting.speechRate, (value) => integerText(value, "The speech rate")),
    ...parameter("pitch", setting.pitch, (value) => floatText(value, "The pitch")),
    ...parameter("volume", setting.volume, (value) => volumeText(value, "The volume")),
    ...parameter("link-indication", setting.linkIndication, choiceText(PNP_LINK_INDICATIONS, "The link indication")),
    ...parameter("typing-echo", setting.typingEcho, choiceText(PNP_TYPING_ECHOES, "The typing echo")),
  ]);
}

function gradeText(grade: unknown): string {
  if (typeof grade !== "number" || !BRAILLE_GRADES.includes(grade)) {
    throw new DataError(`The braille grade must be 1, 2 or 3, found ${describe(grade)}.`);
  }
  return String(grade);
}

function writeBraille(setting: Braille): XmlElement {
  const attributes = {
    "xml:lang": optionalWith(setting.language, (value) => languageAttribute(value, "The language of braille")),
  };
  return element(setting.name, attributes, [
    ...modeElements(setting, setting.name),
    ...parameter("delivery-mode", setting.deliveryMode, choiceText(PNP_BRAILLE_DELIVERY_MODES, "The delivery mode")),
    ...parameter("grade", setting.grade, gradeText),
    ...parameter("braille-type", setting.brailleType, (value) =>
      termText(value, PNP_BRAILLE_TYPES, "The braille type"),
    ),
    ...parameter("math-type", setting.mathType, (value) => termText(value, PNP_BRAILLE_MATH_TYPES, "The math type")),
  ]);
}

function writeLongDescription(setting: LongDescription): XmlElement {
  const attributes = {
    "hide-visually": optionalWith(setting.hideVisually, (value) =>
      booleanText(value, "The hideVisually of long-description"),
    ),
  };
  return element(setting.name, attributes, modeElements(setting, setting.name));
}

function writeEnvironment(setting: Environment): XmlElement {
  return element(setting.name, {}, [
    ...modeElements(setting, setting.name),
    ...parameter("description", setting.description, stringText("The description of environment")),
    ...parameter("medical", setting.medical, stringText("The medical of environment")),
    ...parameter("software", setting.software, stringText("The software of environment")),
    ...parameter("hardware", setting.hardware, stringText("The hardware of environment")),
    ...parameter("breaks", setting.breaks, (value) => booleanText(value, "The breaks of environment")),
  ]);
}

function fontFaceElement(face: FontFace): XmlElement {
  checkRecord(face, "The fontFace of text-appearance must be an object");
  const names = listOf(face.fontNames, "The fontNames of a font face", 0);
  return element("font-face", {}, [
    ...names.map((name) => element("font-name", {}, [stringText("A font name")(name)])),
    ...parameter(
      "generic-font-face",
      face.genericFontFace,
      choiceText(PNP_GENERIC_FONT_FACES, "The generic font face"),
    ),
  ]);
}

function writeTextAppearance(setting: TextAppearance): XmlElement {
  const number = (label: string) => (value: unknown) => floatText(value, label);
  // The theme is checked and left out, because the schema has no such element (spec gaps, G49).
  if (setting.colorTheme !== undefined && !isColorTheme(setting.colorTheme)) {
    throw new DataError(`The color theme must be a term of color-theme, found ${describe(setting.colorTheme)}.`);
  }
  return element(setting.name, {}, [
    ...modeElements(setting, setting.name),
    ...parameter("background-color", setting.backgroundColor, (value) => hexColorText(value, "The background color")),
    ...parameter("font-color", setting.fontColor, (value) => hexColorText(value, "The font color")),
    ...parameter("font-size", setting.fontSize, number("The font size")),
    ...(setting.fontFace === undefined ? [] : [fontFaceElement(setting.fontFace)]),
    ...parameter("line-spacing", setting.lineSpacing, number("The line spacing")),
    ...parameter("line-height", setting.lineHeight, number("The line height")),
    ...parameter("letter-spacing", setting.letterSpacing, number("The letter spacing")),
    ...flagParameter("uniform-font-sizing", setting.uniformFontSizing),
    ...parameter("word-spacing", setting.wordSpacing, number("The word spacing")),
    ...flagParameter("word-wrapping", setting.wordWrapping),
  ]);
}

function writeCalculatorOnScreen(setting: CalculatorOnScreen): XmlElement {
  const attributes = {
    "calculator-type": optionalWith(setting.calculatorType, (value) =>
      termText(value, PNP_CALCULATOR_TYPES, "The calculator type"),
    ),
  };
  return element(setting.name, attributes);
}

const isReplacing = (setting: SupportSetting): setting is ReplacingSupport => isReplacingSupportName(setting.name);
const isLanguage = (setting: SupportSetting): setting is LanguageSupport => isLanguageSupportName(setting.name);
const isTool = (setting: SupportSetting): setting is ToolSupport => isToolSupportName(setting.name);

/**
 * Writes the settings of a support as its elements: one, except for `hazard-avoidance` and `language-of-interface`, which
 * occur once for each hazard and each language.
 *
 * @param setting - The settings of a predefined support.
 * @returns The elements of the support.
 * @throws `DataError` when the setting is not one: a parameter of the wrong type or outside its vocabulary, or a list
 * that must not be empty.
 */
export function writeSupport(setting: SupportSetting): XmlElement[] {
  checkRecord(setting, "The settings of a support must be an object");
  if (isReplacing(setting)) return [element(setting.name, {}, modeElements(setting, setting.name))];
  if (isLanguage(setting)) return [writeLanguagePreference(setting.name, setting)];
  if (isTool(setting)) return [element(setting.name)];
  switch (setting.name) {
    case "hazard-avoidance":
      return writeHazardAvoidance(setting);
    case "input-requirements":
      return [writeInputRequirements(setting)];
    case "language-of-interface":
      return writeLanguageOfInterface(setting);
    case "additional-testing-time":
      return [writeAdditionalTestingTime(setting)];
    case "line-reader":
      return [writeLineReader(setting)];
    case "invert-display-polarity":
      return [writeInvertDisplayPolarity(setting)];
    case "magnification":
      return [writeMagnification(setting)];
    case "spoken":
      return [writeSpoken(setting)];
    case "braille":
      return [writeBraille(setting)];
    case "long-description":
      return [writeLongDescription(setting)];
    case "environment":
      return [writeEnvironment(setting)];
    case "text-appearance":
      return [writeTextAppearance(setting)];
    case "calculator-on-screen":
      return [writeCalculatorOnScreen(setting)];
  }
}
