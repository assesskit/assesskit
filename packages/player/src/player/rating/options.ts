import type { RubricRating } from "@assesskit/runtime/asi";
import {
  checkArray,
  checkBoolean,
  checkFunction,
  checkProperties,
  checkRecord,
  checkString,
  describe,
} from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import { type Messages, selectMessages } from "../../messages/index.js";
import type { MountOptions } from "../delivery/index.js";
import { numberFormatter } from "../internal.js";

/** The options of {@link mountRatingForm}; `stylesheet`, `language` and `catalogs` mean what they do for the player. */
export interface RatingFormOptions extends Pick<MountOptions, "stylesheet" | "language" | "catalogs"> {
  /**
   * The ratings to show at first, such as those of an earlier rater.
   *
   * @defaultValue `[]`
   */
  readonly ratings?: readonly RubricRating[];
  /**
   * Whether the form only shows the ratings as text, for a second rater or an adjudicator.
   *
   * @defaultValue `false`
   */
  readonly readOnly?: boolean;
  /**
   * Called with the ratings and their score after each change by the rater.
   *
   * @defaultValue None
   */
  readonly onChange?: (ratings: readonly RubricRating[], score: number | null) => void;
}

/** The options of a form, checked and with their defaults. */
export interface RatingSettings {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of the interface. */
  readonly language: string;
  /** The player's stylesheet. */
  readonly stylesheet: CSSStyleSheet;
  /** The ratings to show at first; whether they fit the rubric is for the form to check. */
  readonly ratings: readonly RubricRating[];
  /** Whether the form shows text only. */
  readonly readOnly: boolean;
  /** Called after each change by the rater. */
  readonly onChange: ((ratings: readonly RubricRating[], score: number | null) => void) | undefined;
  /** Writes a number in the language of the interface. */
  readonly format: (value: number) => string;
}

const OPTION_NAMES = ["stylesheet", "language", "catalogs", "ratings", "readOnly", "onChange"];

/**
 * Checks the options of a form and fills in their defaults.
 *
 * @param options - The options.
 * @returns The settings.
 * @throws `DataError` when an option is not of its type.
 */
export function readRatingOptions(options: unknown): RatingSettings {
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", OPTION_NAMES);
  const { language = "en", catalogs = {}, ratings = [], readOnly = false, onChange, stylesheet } = options;
  checkString(language, "The option language");
  checkRecord(catalogs, "The option catalogs must be an object");
  checkArray(ratings, "The option ratings must be an array");
  checkBoolean(readOnly, "The option readOnly");
  if (onChange !== undefined) checkFunction(onChange, "The option onChange must be a function");
  if (!(stylesheet instanceof CSSStyleSheet)) {
    throw new DataError(`The option stylesheet must be a CSSStyleSheet, found ${describe(stylesheet)}.`);
  }
  const format = numberFormatter(language);
  return {
    // `selectMessages` checks the catalogs, language by language, down to each message.
    messages: selectMessages(language, catalogs as Readonly<Record<string, Partial<Messages>>>),
    language,
    stylesheet,
    ratings: ratings as readonly RubricRating[],
    readOnly,
    onChange:
      onChange === undefined
        ? undefined
        : (changed, score) => {
            Reflect.apply(onChange, undefined, [changed, score]);
          },
    format: (value) => format.format(value),
  };
}
