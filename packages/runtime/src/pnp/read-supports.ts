import { checkChoice } from "../checks.js";
import type { ElementReader } from "../xml/index.js";
import { termOrExtension, toBoolean, toFloat, toHexColor, toInteger, toVolume } from "./lexical.js";
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
  ReplacingSupport,
  Spoken,
  SupportSetting,
  TestingTime,
  TextAppearance,
  ToolSupport,
  Zoom,
} from "./settings.js";
import {
  isLanguageSupportName,
  isReplacingSupportName,
  isToolSupportName,
  type LanguageSupportName,
  type OtherSupportName,
  type PredefinedSupportName,
  type ReplacingSupportName,
  type ToolSupportName,
} from "./support-names.js";
import {
  type BrailleGrade,
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
  type PnpAccessMode,
  type RestrictionType,
} from "./vocabularies.js";

/** The braille grades the schema lists, as the text of `grade` (PNP XSD). */
const BRAILLE_GRADE_TEXTS = ["1", "2", "3"] as const;

type ChildReader<TValue> = (child: ElementReader) => TValue;
type ChildHandler = (child: ElementReader) => void;

/** A model under construction: the fields a support element's children fill in. */
type Draft<T> = { -readonly [TKey in keyof T]?: T[TKey] };

/** Reads the text of a child that has no attributes. */
const text =
  <TValue>(parse: (text: string) => TValue): ChildReader<TValue> =>
  (child) => {
    const value = child.text(parse);
    child.done();
    return value;
  };

/** Reads an empty child, whose presence is its value. */
const flag: ChildReader<true> = (child) => {
  child.done();
  return true;
};

/** Returns a function that reads one of some terms, with white space around it dropped. */
function exactTerm<T extends string>(terms: readonly T[], label: string): (text: string) => T {
  return (value) => {
    const token = value.trim();
    checkChoice(token, label, terms);
    return token;
  };
}

/**
 * Stores what a child reads under a key of the draft. The schema allows each parameter once, so a second child that
 * fills the same key is a `ReadError`.
 */
function store<TDraft, TKey extends keyof TDraft>(
  draft: TDraft,
  key: TKey,
  read: ChildReader<TDraft[TKey]>,
): ChildHandler {
  return (child) => {
    const value = read(child);
    if (draft[key] !== undefined) {
      const message = `The element ${child.name} is repeated, or conflicts with another parameter of the support, which the schema allows only once.`;
      throw child.fail("repeated-element", message);
    }
    draft[key] = value;
  };
}

/** Returns the handlers for the access modes a support replaces: each mode adds itself to `modes` once. */
function modeHandlers(modes: PnpAccessMode[]): [string, ChildHandler][] {
  return PNP_ACCESS_MODES.map((mode) => [
    `${PNP_ACCESS_MODE_ELEMENT_PREFIX}${mode}`,
    (child) => {
      child.done();
      if (modes.includes(mode)) throw child.fail("repeated-element", `The element ${child.name} is repeated.`);
      modes.push(mode);
    },
  ]);
}

/**
 * Reads the children of an element with the handler for their names, then finishes the element. A child that has no handler
 * is a `ReadError`, and so is an element of another namespace.
 */
function walk(reader: ElementReader, handlers: ReadonlyMap<string, ChildHandler>): void {
  for (let child = reader.next(); child !== undefined; child = reader.next()) {
    const handler = child.foreign ? undefined : handlers.get(child.name);
    if (handler === undefined) {
      const message = `The element ${child.qualifiedName} is not a parameter of the support ${reader.name}.`;
      throw child.fail("unexpected-element", message);
    }
    handler(child);
  }
  reader.done();
}

/** Reads the children of a support that only has access modes. */
function readModes(reader: ElementReader): PnpAccessMode[] {
  const modes: PnpAccessMode[] = [];
  walk(reader, new Map(modeHandlers(modes)));
  return modes;
}

function readReplacing(reader: ElementReader, name: ReplacingSupportName): ReplacingSupport {
  return { name, replaceAccessModes: readModes(reader) };
}

function readLanguagePreference(reader: ElementReader): LanguagePreference {
  const language = reader.requiredLanguage();
  return { language, replaceAccessModes: readModes(reader) };
}

function readLanguage(reader: ElementReader, name: LanguageSupportName): LanguageSupport {
  return { name, ...readLanguagePreference(reader) };
}

function readLanguageOfInterface(reader: ElementReader): LanguageOfInterface {
  return { name: "language-of-interface", languages: [readLanguagePreference(reader)] };
}

function readTool(reader: ElementReader, name: ToolSupportName): ToolSupport {
  reader.done();
  return { name };
}

function readHazardAvoidance(reader: ElementReader): HazardAvoidance {
  const hazard = reader.text(termOrExtension(PNP_HAZARDS, "A hazard"));
  reader.done();
  return { name: "hazard-avoidance", hazards: [hazard] };
}

function readInputRequirements(reader: ElementReader): InputRequirements {
  const requirement = reader.text(termOrExtension(PNP_INPUT_REQUIREMENTS, "An input requirement"));
  reader.done();
  return { name: "input-requirements", requirement };
}

function readAdditionalTestingTime(reader: ElementReader): AdditionalTestingTime {
  const modes: PnpAccessMode[] = [];
  const draft: Draft<{ time: TestingTime }> = {};
  walk(
    reader,
    new Map<string, ChildHandler>([
      ...modeHandlers(modes),
      [
        "time-multiplier",
        store(draft, "time", (child): TestingTime => ({ kind: "time-multiplier", multiplier: text(toFloat)(child) })),
      ],
      [
        "fixed-minutes",
        store(draft, "time", (child): TestingTime => ({ kind: "fixed-minutes", minutes: text(toInteger)(child) })),
      ],
      [
        "unlimited",
        store(draft, "time", (child): TestingTime => {
          child.done();
          return { kind: "unlimited" };
        }),
      ],
    ]),
  );
  if (draft.time === undefined) {
    throw reader.fail(
      "missing-element",
      "The element additional-testing-time needs time-multiplier, fixed-minutes or unlimited.",
    );
  }
  return { name: "additional-testing-time", replaceAccessModes: modes, time: draft.time };
}

function readLineReader(reader: ElementReader): LineReader {
  const highlightColor = reader.attribute("highlight-color", toHexColor);
  return {
    name: "line-reader",
    replaceAccessModes: readModes(reader),
    ...(highlightColor !== undefined && { highlightColor }),
  };
}

function readInvertDisplayPolarity(reader: ElementReader): InvertDisplayPolarity {
  const foreground = reader.attribute("foreground", toHexColor);
  const background = reader.attribute("background", toHexColor);
  return {
    name: "invert-display-polarity",
    replaceAccessModes: readModes(reader),
    ...(foreground !== undefined && { foreground }),
    ...(background !== undefined && { background }),
  };
}

function readZoom(reader: ElementReader): Zoom {
  const zoomAmount = reader.attribute("zoom-amount", toFloat);
  reader.done();
  return zoomAmount === undefined ? {} : { zoomAmount };
}

function readMagnification(reader: ElementReader): Magnification {
  const modes: PnpAccessMode[] = [];
  const draft: Draft<Magnification> = {};
  walk(
    reader,
    new Map<string, ChildHandler>([
      ...modeHandlers(modes),
      ["all-content", store(draft, "allContent", readZoom)],
      ["text", store(draft, "text", readZoom)],
      ["non-text", store(draft, "nonText", readZoom)],
    ]),
  );
  if (draft.allContent !== undefined && (draft.text !== undefined || draft.nonText !== undefined)) {
    throw reader.fail("unexpected-element", "The element magnification has either all-content, or text and non-text.");
  }
  return { name: "magnification", replaceAccessModes: modes, ...draft };
}

function readSpoken(reader: ElementReader): Spoken {
  const modes: PnpAccessMode[] = [];
  const restrictionTypes: RestrictionType[] = [];
  const draft: Draft<Spoken> = {};
  walk(
    reader,
    new Map<string, ChildHandler>([
      ...modeHandlers(modes),
      ["reading-type", store(draft, "readingType", text(exactTerm(PNP_READING_TYPES, "A reading type")))],
      [
        "restriction-type",
        (child) => restrictionTypes.push(text(termOrExtension(PNP_RESTRICTION_TYPES, "A restriction type"))(child)),
      ],
      ["speech-rate", store(draft, "speechRate", text(toInteger))],
      ["pitch", store(draft, "pitch", text(toFloat))],
      ["volume", store(draft, "volume", text(toVolume))],
      ["link-indication", store(draft, "linkIndication", text(exactTerm(PNP_LINK_INDICATIONS, "A link indication")))],
      ["typing-echo", store(draft, "typingEcho", text(exactTerm(PNP_TYPING_ECHOES, "A typing echo")))],
    ]),
  );
  return { name: "spoken", replaceAccessModes: modes, restrictionTypes, ...draft };
}

function toBrailleGrade(value: string): BrailleGrade {
  const token = value.trim();
  checkChoice(token, "A braille grade", BRAILLE_GRADE_TEXTS);
  return token === "1" ? 1 : token === "2" ? 2 : 3;
}

function readBraille(reader: ElementReader): Braille {
  const language = reader.language();
  const modes: PnpAccessMode[] = [];
  const draft: Draft<Braille> = {};
  walk(
    reader,
    new Map<string, ChildHandler>([
      ...modeHandlers(modes),
      ["delivery-mode", store(draft, "deliveryMode", text(exactTerm(PNP_BRAILLE_DELIVERY_MODES, "A delivery mode")))],
      ["grade", store(draft, "grade", text(toBrailleGrade))],
      ["braille-type", store(draft, "brailleType", text(termOrExtension(PNP_BRAILLE_TYPES, "A braille type")))],
      ["math-type", store(draft, "mathType", text(termOrExtension(PNP_BRAILLE_MATH_TYPES, "A math type")))],
    ]),
  );
  return { name: "braille", replaceAccessModes: modes, ...(language !== undefined && { language }), ...draft };
}

function readLongDescription(reader: ElementReader): LongDescription {
  const hideVisually = reader.attribute("hide-visually", toBoolean);
  return {
    name: "long-description",
    replaceAccessModes: readModes(reader),
    ...(hideVisually !== undefined && { hideVisually }),
  };
}

function readEnvironment(reader: ElementReader): Environment {
  const modes: PnpAccessMode[] = [];
  const draft: Draft<Environment> = {};
  walk(
    reader,
    new Map<string, ChildHandler>([
      ...modeHandlers(modes),
      [
        "description",
        store(
          draft,
          "description",
          text((value) => value),
        ),
      ],
      [
        "medical",
        store(
          draft,
          "medical",
          text((value) => value),
        ),
      ],
      [
        "software",
        store(
          draft,
          "software",
          text((value) => value),
        ),
      ],
      [
        "hardware",
        store(
          draft,
          "hardware",
          text((value) => value),
        ),
      ],
      ["breaks", store(draft, "breaks", text(toBoolean))],
    ]),
  );
  return { name: "environment", replaceAccessModes: modes, ...draft };
}

function readFontFace(reader: ElementReader): FontFace {
  const fontNames: string[] = [];
  const draft: Draft<FontFace> = {};
  walk(
    reader,
    new Map<string, ChildHandler>([
      ["font-name", (child) => fontNames.push(text((value) => value)(child))],
      [
        "generic-font-face",
        store(draft, "genericFontFace", text(exactTerm(PNP_GENERIC_FONT_FACES, "A generic font face"))),
      ],
    ]),
  );
  return { fontNames, ...draft };
}

function readTextAppearance(reader: ElementReader): TextAppearance {
  const modes: PnpAccessMode[] = [];
  const draft: Draft<TextAppearance> = {};
  walk(
    reader,
    new Map<string, ChildHandler>([
      ...modeHandlers(modes),
      ["background-color", store(draft, "backgroundColor", text(toHexColor))],
      ["font-color", store(draft, "fontColor", text(toHexColor))],
      ["font-size", store(draft, "fontSize", text(toFloat))],
      ["font-face", store(draft, "fontFace", readFontFace)],
      ["line-spacing", store(draft, "lineSpacing", text(toFloat))],
      ["line-height", store(draft, "lineHeight", text(toFloat))],
      ["letter-spacing", store(draft, "letterSpacing", text(toFloat))],
      ["uniform-font-sizing", store(draft, "uniformFontSizing", flag)],
      ["word-spacing", store(draft, "wordSpacing", text(toFloat))],
      ["word-wrapping", store(draft, "wordWrapping", flag)],
    ]),
  );
  return { name: "text-appearance", replaceAccessModes: modes, ...draft };
}

function readCalculatorOnScreen(reader: ElementReader): CalculatorOnScreen {
  const calculatorType = reader.attribute(
    "calculator-type",
    termOrExtension(PNP_CALCULATOR_TYPES, "A calculator type"),
  );
  reader.done();
  return { name: "calculator-on-screen", ...(calculatorType !== undefined && { calculatorType }) };
}

/** Reads a support with a shape of its own. */
function readOther(reader: ElementReader, name: OtherSupportName): SupportSetting {
  switch (name) {
    case "hazard-avoidance":
      return readHazardAvoidance(reader);
    case "input-requirements":
      return readInputRequirements(reader);
    case "language-of-interface":
      return readLanguageOfInterface(reader);
    case "additional-testing-time":
      return readAdditionalTestingTime(reader);
    case "line-reader":
      return readLineReader(reader);
    case "invert-display-polarity":
      return readInvertDisplayPolarity(reader);
    case "magnification":
      return readMagnification(reader);
    case "spoken":
      return readSpoken(reader);
    case "braille":
      return readBraille(reader);
    case "long-description":
      return readLongDescription(reader);
    case "environment":
      return readEnvironment(reader);
    case "text-appearance":
      return readTextAppearance(reader);
    case "calculator-on-screen":
      return readCalculatorOnScreen(reader);
  }
}

/**
 * Reads the element of a predefined support into its settings (PNP XSD). `language-of-interface` and `hazard-avoidance`
 * occur once for each language and hazard, so each element gives a setting of one.
 *
 * @throws `ReadError` for a parameter that the support does not have, repeats, or gives a value its type does not allow.
 */
export function readSupport(reader: ElementReader, name: PredefinedSupportName): SupportSetting {
  if (isReplacingSupportName(name)) return readReplacing(reader, name);
  if (isLanguageSupportName(name)) return readLanguage(reader, name);
  if (isToolSupportName(name)) return readTool(reader, name);
  return readOther(reader, name);
}
