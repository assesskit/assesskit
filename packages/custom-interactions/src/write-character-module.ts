import { finiteSchema, nonEmptyStringSchema, nonNegativeIntegerSchema, parseWith } from "@assesskit/runtime/checks";
import * as v from "valibot";

/**
 * The most strokes of a character: about twice the most in hanzi-writer-data 2.0.1, 33 among its 9,574 characters, so that
 * a rare character fits and a document of another kind does not.
 */
const MAX_STROKES = 64;

/** The most characters of the outline of a stroke: 758 is the longest in hanzi-writer-data 2.0.1. */
const MAX_PATH_LENGTH = 4096;

/** The most points of the median of a stroke: 38 is the most in hanzi-writer-data 2.0.1. */
const MAX_MEDIAN_POINTS = 256;

/** The most UTF-16 code units of the character: one code point, with a variation selector or a combining mark. */
const MAX_CHARACTER_LENGTH = 8;

/** The characters of SVG path data: commands, numbers, signs, exponents, commas and white space. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,eE+\- ]+$/;

/**
 * The reference strokes of a character, in the form of Hanzi Writer's data: each stroke's outline and its median, in the
 * order of writing, in a box of 1024 units whose y axis points up from -124 to 900.
 *
 * @see {@link https://hanziwriter.org/docs.html#loading-character-data | Hanzi Writer, loading character data}
 */
export interface CharacterStrokes {
  /** The outline of each stroke, as SVG path data. */
  readonly strokes: readonly string[];
  /** The median of each stroke, as its points `[x, y]` from where the pen starts to where it lifts. */
  readonly medians: readonly (readonly (readonly [number, number])[])[];
  /**
   * The indices of the strokes that make the radical.
   *
   * @defaultValue none
   */
  readonly radStrokes?: readonly number[];
}

/** The reference strokes as Hanzi Writer's data gives them, refusing any other property. */
const characterStrokesSchema = v.pipe(
  v.strictObject({
    strokes: v.pipe(
      v.array(v.pipe(v.string(), v.maxLength(MAX_PATH_LENGTH), v.regex(PATH_DATA, "a string of SVG path data"))),
      v.minLength(1),
      v.maxLength(MAX_STROKES),
    ),
    medians: v.pipe(
      v.array(
        v.pipe(v.array(v.strictTuple([finiteSchema, finiteSchema])), v.minLength(2), v.maxLength(MAX_MEDIAN_POINTS)),
      ),
      v.maxLength(MAX_STROKES),
    ),
    radStrokes: v.optional(v.pipe(v.array(nonNegativeIntegerSchema), v.maxLength(MAX_STROKES))),
  }),
  v.check(({ strokes, medians }) => medians.length === strokes.length, "a median for each stroke"),
  v.check(
    ({ strokes, radStrokes = [] }) => radStrokes.every((index) => index < strokes.length),
    "radical strokes that are strokes of the character",
  ),
);

/** A character: one code point, or one with a variation selector or a combining mark. */
const characterSchema = v.pipe(nonEmptyStringSchema, v.maxLength(MAX_CHARACTER_LENGTH));

/**
 * Writes the AMD module of a character that the stroke writing interaction loads: an item's package carries it, and the
 * item's module resolution names it `stroke-writing-character`. The reference strokes are content of the bank, with the
 * license and the credit of their source: the module holds the data as it is given.
 *
 * @example
 * ```ts
 * import { writeCharacterModule } from "@assesskit/custom-interactions";
 *
 * const text = writeCharacterModule("一", {
 *   strokes: ["M 100 400 L 900 400 L 900 360 L 100 360 Z"],
 *   medians: [[[110, 380], [890, 380]]],
 * });
 * text.startsWith('define({"character":"一","strokes":["M 100 400'); // => true
 * ```
 *
 * @param character - The character, which names the drawing for assistive technology.
 * @param strokes - Its reference strokes, such as a file of hanzi-writer-data read as JSON.
 * @returns The text of the module, a JavaScript file that defines the character and its strokes.
 * @throws `DataError` when the character is not one, or the strokes are not reference strokes: no stroke, more than 64, a
 * median missing, a path that is not SVG path data or longer than 4,096 characters, a median of fewer than 2 or more than
 * 256 points, or another property.
 */
export function writeCharacterModule(character: string, strokes: CharacterStrokes): string {
  const symbol = parseWith(characterSchema, character, "The character");
  const data = parseWith(characterStrokesSchema, strokes, "The strokes of a character");
  const { radStrokes } = data;
  const value = {
    character: symbol,
    strokes: data.strokes,
    medians: data.medians,
    ...(radStrokes === undefined ? {} : { radStrokes }),
  };
  return `define(${JSON.stringify(value)});\n`;
}
