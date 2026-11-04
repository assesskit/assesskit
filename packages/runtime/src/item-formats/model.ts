import type { AssessmentItem } from "../asi/index.js";
import type { CustomOperator } from "../processing/index.js";
import type { ItemFormatLimits } from "./limits.js";

/**
 * Why a part of an item, or a whole item, does not convert:
 *
 * | Reason | What does not convert |
 * | --- | --- |
 * | `item` | The whole item: an interaction or question type the other side lacks, several interactions, template variables, a question Moodle refuses |
 * | `scoring` | Credit the other side cannot express: a rule that is not a sum of credits, a credit outside Moodle's grades, case, tolerance bounds |
 * | `feedback` | Feedback that has no place on the other side |
 * | `content` | Content that has no place: elements and attributes outside QTI's HTML, media files, Markdown, the order of the text |
 * | `setting` | A setting that has no place: the mark, shuffling, limits of choices, hints and penalties, units, an essay's options |
 */
export type LossReason = "item" | "scoring" | "feedback" | "content" | "setting";

/** What a conversion leaves out or changes, with its reason. */
export interface ConversionLoss {
  /** The position of the item or question: its index in the list a writer takes, or its number in the file from 0. */
  readonly index: number;
  /** The identifier of the item, or the name of the question. */
  readonly item: string;
  /** Whether the whole item is left out of the result. */
  readonly omitted: boolean;
  /** Why it does not convert. */
  readonly reason: LossReason;
  /** A sentence that says what does not convert and what the result holds instead. */
  readonly message: string;
}

/** An item with its place in a question bank. */
export interface BankItem {
  /** The item. */
  readonly item: AssessmentItem;
  /**
   * The path of the category that holds the question, as the file names it, such as `$course$/top/Algebra`.
   *
   * @defaultValue none: the category that the importer chooses
   */
  readonly category?: string;
  /**
   * The tags of the question.
   *
   * @defaultValue `[]`
   */
  readonly tags?: readonly string[];
}

/** The items that a reader converts, with what it could not. */
export interface ImportedItems {
  /** The items, in the order of the file, with their categories and tags. */
  readonly items: readonly BankItem[];
  /**
   * The files that the texts of the file embed, by the reference that the items' content gives them: `files/`, the item's
   * identifier, then the file's path as the text writes it.
   */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** What does not convert, in the order of the file. */
  readonly losses: readonly ConversionLoss[];
}

/** The file that a writer makes, with what it could not convert. */
export interface ExportedItems {
  /** The file. */
  readonly text: string;
  /** What does not convert, in the order of the items. */
  readonly losses: readonly ConversionLoss[];
}

/** The labels of the two choices of a true-false question, which Moodle draws in the language of its user. */
export interface TrueFalseLabels {
  /** The label of the choice `true`. */
  readonly true: string;
  /** The label of the choice `false`. */
  readonly false: string;
}

/** The options of the readers. */
export interface ReadItemsOptions {
  /**
   * The labels of the choices of a true-false question.
   *
   * @defaultValue `{ true: "True", false: "False" }`
   */
  readonly trueFalseLabels?: TrueFalseLabels;
  /**
   * The limits of the file, which replace the defaults one by one.
   *
   * @defaultValue `DEFAULT_ITEM_FORMAT_LIMITS`
   */
  readonly limits?: Partial<ItemFormatLimits>;
}

/** The options of the writers. */
export interface WriteItemsOptions {
  /**
   * The custom operators that the response processing of the items calls, by definition or class, as a delivery engine
   * registers them: `createScoringOperators()` of `@assesskit/runtime/operators` for the items that `compileScoring` writes.
   * An item that calls an operator not registered is left out, since its scoring cannot be run.
   *
   * @defaultValue none
   */
  readonly customOperators?: ReadonlyMap<string, CustomOperator>;
  /**
   * The limits of the items: `maxAnswers` bounds the choices of an interaction that a writer scores.
   *
   * @defaultValue `DEFAULT_ITEM_FORMAT_LIMITS`
   */
  readonly limits?: Partial<ItemFormatLimits>;
}

/** The options of `writeMoodleXml`. */
export interface WriteMoodleXmlOptions extends WriteItemsOptions {
  /**
   * The files that the items' content names, by the reference as the content writes it, such as `images/map.png`: each that
   * a text names is embedded in the question, which Moodle then shows.
   *
   * @defaultValue none: a reference stays as written, with a loss
   */
  readonly files?: ReadonlyMap<string, Uint8Array>;
}
