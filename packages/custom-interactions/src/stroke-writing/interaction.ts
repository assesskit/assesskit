import { DataError } from "@assesskit/runtime/errors";
import HanziWriter, { type CharacterJson } from "hanzi-writer";
import { type InstanceArguments, notifyChange, type PciInstance, takesInput } from "../frame/internal.js";
import { PCI_TYPE_IDENTIFIERS } from "../interaction-types.js";

/** The class of the drawing area, which an item's stylesheet may style. */
const AREA_CLASS = "stroke-writing-area";

/** The layout of the drawing area: a square that the pointer draws in, which a page does not scroll under the finger. */
const STYLE = `.${AREA_CLASS} { display: block; touch-action: none; margin: 0 auto; }`;

/**
 * The colors of the strokes, darker than Hanzi Writer's: the outline that guides the pen keeps the contrast of 3:1 on white
 * that WCAG 1.4.11 asks of a graphic, and the drawing, the written strokes and the hint more.
 */
const COLORS = { strokeColor: "#333", outlineColor: "#949494", drawingColor: "#1a1a1a", highlightColor: "#5560d0" };

/** What the character module defines: the character and its reference strokes, as `writeCharacterModule` writes them. */
interface CharacterModule extends CharacterJson {
  readonly character: string;
}

/** The progress of a quiz, which is the response and the state: the strokes written and the mistakes made. */
interface Progress {
  readonly strokes: number;
  readonly mistakes: number;
}

/** Reads the character module, which the item's package gives under the id `stroke-writing-character`. */
function readCharacter(value: unknown): CharacterModule {
  if (
    typeof value !== "object" ||
    value === null ||
    !("character" in value && typeof value.character === "string") ||
    !("strokes" in value && Array.isArray(value.strokes) && value.strokes.length > 0) ||
    !("medians" in value && Array.isArray(value.medians) && value.medians.length === value.strokes.length)
  ) {
    throw new DataError(
      "The module stroke-writing-character must define a character as writeCharacterModule writes it.",
    );
  }
  return value as CharacterModule;
}

/** The attribute of a property, `data-show-outline` for `showOutline`, as `dataset` names them. */
const attributeOf = (name: string): string => `data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/** Reads a property that is a whole number of at least `min`, or gives its default when the item leaves it out. */
function readCount(properties: Readonly<Record<string, string>>, name: string, fallback: number, min: number): number {
  const text = properties[name];
  if (text === undefined) return fallback;
  if (!(/^\d{1,6}$/.test(text) && Number(text) >= min)) {
    throw new DataError(
      `The attribute ${attributeOf(name)} must be a whole number of at least ${min}, found ${JSON.stringify(text)}.`,
    );
  }
  return Number(text);
}

/** Reads a property that is a positive number, or gives its default when the item leaves it out. */
function readPositive(properties: Readonly<Record<string, string>>, name: string, fallback: number): number {
  const text = properties[name];
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!(/^\d+(?:\.\d+)?$/.test(text) && value > 0)) {
    throw new DataError(`The attribute ${attributeOf(name)} must be a positive number, found ${JSON.stringify(text)}.`);
  }
  return value;
}

/** Reads a property that is `true` or `false`, or gives its default when the item leaves it out. */
function readFlag(properties: Readonly<Record<string, string>>, name: string, fallback: boolean): boolean {
  const text = properties[name];
  if (text === undefined) return fallback;
  if (text !== "true" && text !== "false") {
    throw new DataError(`The attribute ${attributeOf(name)} must be true or false, found ${JSON.stringify(text)}.`);
  }
  return text === "true";
}

/** A progress of a quiz of `total` strokes, from untyped values; none when they are not one. */
function progressOf(strokes: unknown, mistakes: unknown, total: number): Progress | undefined {
  if (typeof strokes !== "number" || typeof mistakes !== "number") return undefined;
  if (!(Number.isSafeInteger(strokes) && Number.isSafeInteger(mistakes))) return undefined;
  return strokes >= 0 && strokes <= total && mistakes >= 0 ? { strokes, mistakes } : undefined;
}

/** The progress of a state that `getState` gave, or none when it is not one. */
function progressOfState(state: string | undefined, total: number): Progress | undefined {
  if (state === undefined || state === "") return undefined;
  try {
    const value: unknown = JSON.parse(state);
    if (typeof value !== "object" || value === null) return undefined;
    return progressOf(Reflect.get(value, "strokes"), Reflect.get(value, "mistakes"), total);
  } catch {
    return undefined;
  }
}

/** The integer of a field of a record of the JSON binding, `{ name, base: { integer } }`. */
function fieldOf(record: readonly unknown[], name: string): unknown {
  const entry = record.find(
    (field) => typeof field === "object" && field !== null && Reflect.get(field, "name") === name,
  );
  const base: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "base") : undefined;
  return typeof base === "object" && base !== null ? Reflect.get(base, "integer") : undefined;
}

/** The progress of the response it is bound to: a record of `strokes` and `mistakes`; none for NULL. */
function progressOfResponse(boundTo: unknown, total: number): Progress | undefined {
  const record: unknown = typeof boundTo === "object" && boundTo !== null ? Reflect.get(boundTo, "record") : undefined;
  return Array.isArray(record) ? progressOf(fieldOf(record, "strokes"), fieldOf(record, "mistakes"), total) : undefined;
}

/** The JSON of a record response of the portable custom interaction binding, or NULL before the first stroke. */
function responseOf({ strokes, mistakes }: Progress): unknown {
  if (strokes === 0 && mistakes === 0) return { record: null };
  return {
    record: [
      { name: "strokes", base: { integer: strokes } },
      { name: "mistakes", base: { integer: mistakes } },
    ],
  };
}

/**
 * Creates the stroke writing interaction: Hanzi Writer's quiz of the character that the module `stroke-writing-character`
 * defines, which checks each stroke's shape, direction and order against its reference strokes. The response is the record
 * `{ strokes, mistakes }`: the strokes written so far, and the strokes drawn that did not match.
 *
 * @param args - The arguments of `getInstance`, with the character module as the one dependency.
 * @returns The instance.
 * @throws `DataError` when the character module is not one, or a property is not valid.
 */
export function createStrokeWriting(args: InstanceArguments): PciInstance {
  const { dom, configuration, state } = args;
  const character = readCharacter(args.dependencies[0]);
  const { properties } = configuration;
  const size = readCount(properties, "size", 300, 100);
  const total = character.strokes.length;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.prepend(style);

  const restored = progressOfState(state, total) ?? progressOfResponse(configuration.boundTo, total);
  let progress: Progress = restored ?? { strokes: 0, mistakes: 0 };
  const editable = takesInput(configuration.status) && progress.strokes < total;

  const area = document.createElement("div");
  area.className = AREA_CLASS;
  area.style.width = `${size}px`;
  area.style.height = `${size}px`;
  area.setAttribute("role", "img");
  area.setAttribute("aria-label", document.title);
  dom.append(area);

  const instance: PciInstance = {
    typeIdentifier: PCI_TYPE_IDENTIFIERS["stroke-writing"],
    getResponse: () => responseOf(progress),
    getState: () => JSON.stringify(progress),
    oncompleted: () => writer.cancelQuiz(),
  };
  const update = (next: Progress): void => {
    progress = next;
    notifyChange(instance, args);
  };

  const writer = HanziWriter.create(area, character.character, {
    width: size,
    height: size,
    ...COLORS,
    charDataLoader: () => character,
    showCharacter: !editable,
    showOutline: readFlag(properties, "showOutline", true),
    renderer: "svg",
  });
  if (editable) {
    const before = progress.mistakes;
    const hints = readCount(properties, "showHintAfterMisses", 3, 0);
    const markCorrect = readCount(properties, "markStrokeCorrectAfterMisses", 0, 0);
    void writer.quiz({
      quizStartStrokeNum: progress.strokes,
      leniency: readPositive(properties, "leniency", 1),
      showHintAfterMisses: hints === 0 ? false : hints,
      markStrokeCorrectAfterMisses: markCorrect === 0 ? false : markCorrect,
      onCorrectStroke: ({ strokeNum, totalMistakes }) =>
        update({ strokes: strokeNum + 1, mistakes: before + totalMistakes }),
      onMistake: ({ strokeNum, totalMistakes }) => update({ strokes: strokeNum, mistakes: before + totalMistakes }),
    });
  }
  configuration.onready(instance, state);
  return instance;
}
