import * as v from "valibot";
import { checkArray, checkRecord, describe, functionSchema, parseWith, strictRecord } from "../checks.js";
import { DataError } from "../errors.js";
import type { CustomOperator } from "../processing/index.js";
import type { ItemLoss } from "./item-build.js";
import { convertItem } from "./item-convert.js";
import { writeLimitsSchema } from "./limits.js";
import type { BankItem, ConversionLoss, WriteItemsOptions } from "./model.js";
import type { Question } from "./question.js";

/** An item that a writer converted, with its place in the list, its category and tags, and what does not convert. */
export interface ExportEntry {
  readonly index: number;
  readonly identifier: string;
  readonly question: Question;
  readonly category: string | undefined;
}

/** The questions of the items that convert, with the losses of all. */
export interface ExportPlan {
  readonly entries: readonly ExportEntry[];
  readonly losses: ConversionLoss[];
}

const writeItemsOptionsSchema = strictRecord({
  customOperators: v.optional(v.map(v.string(), functionSchema<CustomOperator>())),
  limits: v.optional(writeLimitsSchema, {}),
});

/**
 * Converts the items of a writer into questions, in order, and records what does not convert of each.
 *
 * @throws `DataError` when `items` is not an array of bank items, an item is not an object of the model of
 * `qti-assessment-item`, or an option has the wrong type.
 */
export function planExport(items: readonly BankItem[], options: WriteItemsOptions): ExportPlan {
  checkArray(items, `The items must be an array, found ${describe(items)}`);
  const { customOperators, limits } = parseWith(writeItemsOptionsSchema, options, "The options object");
  const context = { operators: customOperators ?? new Map<string, CustomOperator>(), limits };
  const entries: ExportEntry[] = [];
  const losses: ConversionLoss[] = [];
  for (const [index, entry] of items.entries()) {
    checkRecord(entry, `The item at ${index} must be an object with the property item, found ${describe(entry)}`);
    const { item, category, tags = [] } = entry;
    checkRecord(
      item,
      `The item at ${index} must be an object of the model of qti-assessment-item, found ${describe(item)}`,
    );
    if (category !== undefined && typeof category !== "string") {
      throw new DataError(`The category of the item at ${index} must be a string, found ${describe(category)}.`);
    }
    checkArray(tags, `The tags of the item at ${index} must be an array, found ${describe(tags)}`);
    if (tags.some((tag) => typeof tag !== "string"))
      throw new DataError(`The tags of the item at ${index} must be strings.`);
    const converted = convertItem(item, context);
    const identifier = typeof item.identifier === "string" ? item.identifier : String(index);
    for (const loss of converted.losses) {
      losses.push({ index, item: identifier, omitted: converted.question === undefined, ...loss });
    }
    if (converted.question !== undefined) {
      entries.push({ index, identifier, question: { ...converted.question, tags }, category });
    }
  }
  return { entries, losses };
}

/** Records a loss of a format's own for an entry. */
export function addLoss(plan: ExportPlan, entry: ExportEntry, loss: ItemLoss): void {
  plan.losses.push({ index: entry.index, item: entry.identifier, omitted: false, ...loss });
}

/** Records that a format leaves an entry out, as its importer would refuse the question, and marks its other losses so. */
export function omitEntry(plan: ExportPlan, entry: ExportEntry, message: string): void {
  for (const [at, loss] of plan.losses.entries()) {
    if (loss.index === entry.index) plan.losses[at] = { ...loss, omitted: true };
  }
  plan.losses.push({ index: entry.index, item: entry.identifier, omitted: true, reason: "item", message });
}

/** Returns the losses in the order of the items, a format's own after the conversion's of the same item. */
export function sortedLosses(plan: ExportPlan): readonly ConversionLoss[] {
  return plan.losses.toSorted((a, b) => a.index - b.index);
}

/**
 * The reason Moodle's importer refuses a question of either format, which stops the import of the file: a short answer
 * without an answer of 100%, which its type's save refuses.
 */
export function moodleRefusal(question: Question): string | undefined {
  if (question.qtype === "shortanswer" && !question.answers.some(({ fraction }) => fraction === 1)) {
    return "No answer earns the item's full credit, and Moodle refuses a short answer without one of 100%.";
  }
  return undefined;
}
