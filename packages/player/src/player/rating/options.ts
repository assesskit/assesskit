import type { RubricRating } from "@assesskit/runtime/asi";
import { functionSchema, objectSchema, parseWith, strictRecord } from "@assesskit/runtime/checks";
import * as v from "valibot";
import { type Messages, selectMessages } from "../../messages/index.js";
import { stylesheetSchema } from "../content/internal.js";
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

const ratingOptionsSchema = strictRecord({
  stylesheet: stylesheetSchema,
  language: v.optional(v.string(), "en"),
  catalogs: v.optional(objectSchema<Readonly<Record<string, Partial<Messages>>>>(), () => ({})),
  ratings: v.optional(v.array(v.unknown()), []),
  readOnly: v.optional(v.boolean(), false),
  onChange: v.optional(functionSchema<(...args: never[]) => unknown>()),
});

/**
 * Checks the options of a form and fills in their defaults.
 *
 * @param options - The options.
 * @returns The settings.
 * @throws `DataError` when an option is not of its type.
 */
export function readRatingOptions(options: unknown): RatingSettings {
  const { language, catalogs, ratings, readOnly, onChange, stylesheet } = parseWith(
    ratingOptionsSchema,
    options,
    "The options object",
  );
  const format = numberFormatter(language);
  return {
    // `selectMessages` checks the catalogs, language by language, down to each message.
    messages: selectMessages(language, { catalogs }),
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
