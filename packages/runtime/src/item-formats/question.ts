// Moodle's model of a question, as its importers build it and its exporters read it: the one model that GIFT and Moodle XML
// write, between the files and QTI items. It follows the fields of question/format and question/type of Moodle 5.3.

/** How Moodle reads a text: as HTML, with its auto-format, as plain text, or as Markdown. */
export type TextFormat = "html" | "moodle" | "plain" | "markdown";

/** A file that a text embeds, which the text names by `@@PLUGINFILE@@/` and its path. */
export interface EmbeddedFile {
  /** The path of the file in its area, from `/`, with its name. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** A text of a question in its format, with the files it embeds. */
export interface FormattedText {
  readonly text: string;
  readonly format: TextFormat;
  readonly files?: readonly EmbeddedFile[];
}

/** An answer of a choice, with its credit as a fraction of the question's mark, from -1 to 1. */
export interface ChoiceAnswer {
  readonly text: FormattedText;
  readonly fraction: number;
  readonly feedback: FormattedText;
}

/** An answer of a short answer: a text in which `*` stands for any characters, and `\*` for a star. */
export interface TextAnswer {
  readonly text: string;
  readonly fraction: number;
  readonly feedback: FormattedText;
}

/** An answer of a numerical question: a value with its tolerance, or `null` for `*`, which every number matches. */
export interface NumberAnswer {
  readonly value: number | null;
  readonly tolerance: number;
  readonly fraction: number;
  readonly feedback: FormattedText;
}

/** A stem of a matching question and its answer; a stem without text adds a wrong answer to the choices. */
export interface Subquestion {
  readonly text: FormattedText;
  readonly answer: string;
}

/** The feedback of a question by how right a response is, which Moodle shows after its specific feedback. */
export interface CombinedFeedback {
  readonly correct: FormattedText;
  readonly partiallyCorrect: FormattedText;
  readonly incorrect: FormattedText;
}

/** How a candidate writes an essay. */
export type EssayFormat = "editor" | "editorfilepicker" | "plain" | "monospaced" | "noinline";

/** The fields of every question. */
export interface QuestionCommon {
  readonly name: string;
  readonly text: FormattedText;
  readonly generalFeedback: FormattedText;
  /** The mark of the question, which the fractions scale. */
  readonly defaultMark: number;
  /** The fraction of the mark that each further try costs in Moodle's interactive modes. */
  readonly penalty: number;
  /** The identifier within the question bank, or the empty string. */
  readonly idNumber: string;
  readonly tags: readonly string[];
  /**
   * Where GIFT's missing word stands in `text`: the offset of the `_____` that replaced the answers, which the item puts its
   * interaction in place of; `null` when the answers follow the text.
   */
  readonly blank: number | null;
  /** The hints of the interactive modes, in order. */
  readonly hints: readonly FormattedText[];
}

/** A question of one of the types that convert, by `qtype` as Moodle names it. */
export type Question = QuestionCommon &
  (
    | { readonly qtype: "description" }
    | {
        readonly qtype: "essay";
        /** One of {@link EssayFormat}, or another name, which Moodle's importer keeps as written. */
        readonly responseFormat: string;
        readonly responseRequired: boolean;
        readonly fieldLines: number;
        readonly minWords: number | null;
        readonly maxWords: number | null;
        readonly attachments: number;
        readonly graderInfo: FormattedText;
        readonly template: FormattedText;
      }
    | {
        readonly qtype: "multichoice";
        readonly single: boolean;
        readonly shuffle: boolean;
        readonly numbering: string;
        readonly answers: readonly ChoiceAnswer[];
        readonly combined: CombinedFeedback;
      }
    | {
        readonly qtype: "truefalse";
        readonly correct: boolean;
        readonly feedbackTrue: FormattedText;
        readonly feedbackFalse: FormattedText;
      }
    | {
        readonly qtype: "shortanswer";
        readonly caseSensitive: boolean;
        readonly answers: readonly TextAnswer[];
      }
    | {
        readonly qtype: "numerical";
        readonly answers: readonly NumberAnswer[];
        /** The units that the question accepts after a number, which a QTI number does not take. */
        readonly units?: number;
      }
    | {
        readonly qtype: "match";
        readonly shuffle: boolean;
        readonly subquestions: readonly Subquestion[];
        readonly combined: CombinedFeedback;
      }
  );

/** A text that is empty, in a format. */
export function emptyText(format: TextFormat = "html"): FormattedText {
  return { text: "", format };
}

/** Combined feedback with no text. */
export const NO_COMBINED_FEEDBACK: CombinedFeedback = Object.freeze({
  correct: emptyText(),
  partiallyCorrect: emptyText(),
  incorrect: emptyText(),
});

/**
 * What a reader finds in a file, in order: a question, a change of category, a question that Moodle refuses, or one of a type
 * that Moodle imports and no QTI item here holds.
 */
export type ReadEntry =
  | { readonly kind: "question"; readonly question: Question }
  | { readonly kind: "category"; readonly category: string }
  | { readonly kind: "error" | "unconverted"; readonly name: string; readonly message: string };

/** A share in percent to seven decimals of the share, as Moodle writes a grade (`fraction * 100`), without the sign. */
export function percent(share: number): string {
  return String(Math.round(share * 1e7) / 1e5);
}

/** Whether a question has feedback by how right a response is. */
export function hasCombined(combined: CombinedFeedback | undefined): combined is CombinedFeedback {
  return (
    combined !== undefined &&
    (combined.correct.text !== "" || combined.partiallyCorrect.text !== "" || combined.incorrect.text !== "")
  );
}
