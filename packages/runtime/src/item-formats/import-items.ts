import * as v from "valibot";
import { describe, parseWith, strictRecord } from "../checks.js";
import { DataError, ReadError, SecurityError } from "../errors.js";
import { isIdentifier } from "../values/index.js";
import { exceedsBytes } from "../xml/internal.js";
import { createContentState } from "./html-content.js";
import { buildItem } from "./item-build.js";
import { DEFAULT_ITEM_FORMAT_LIMITS, type ItemFormatLimits, readLimitsSchema } from "./limits.js";
import type { BankItem, ConversionLoss, ImportedItems, ReadItemsOptions, TrueFalseLabels } from "./model.js";
import type { ReadEntry } from "./question.js";

const DEFAULT_LABELS: TrueFalseLabels = Object.freeze({ true: "True", false: "False" });

const readItemsOptionsSchema = strictRecord({
  trueFalseLabels: v.optional(strictRecord({ true: v.string(), false: v.string() })),
  limits: v.optional(readLimitsSchema),
});

/** The options of a reader with their defaults. */
export interface ResolvedReadOptions {
  readonly labels: TrueFalseLabels;
  readonly limits: ItemFormatLimits;
}

/**
 * Checks the options of a reader and applies their defaults.
 *
 * @throws `DataError` when an option has the wrong type or a limit is not a positive integer.
 */
export function resolveReadOptions(options: ReadItemsOptions): ResolvedReadOptions {
  const { trueFalseLabels = DEFAULT_LABELS, limits = DEFAULT_ITEM_FORMAT_LIMITS } = parseWith(
    readItemsOptionsSchema,
    options,
    "The options object",
  );
  return { labels: trueFalseLabels, limits };
}

/** A surrogate that is not half of a pair, which no UTF-8 file holds. */
const LONE_SURROGATE = /\p{Cs}/gu;

/**
 * Returns the text of a file within `maxBytes`, decoding bytes as UTF-8, as Moodle demands of an import. A text is read as its
 * UTF-8 would be: a lone surrogate, which the parser of HTML fails on, is U+FFFD, as `TextEncoder` writes it.
 *
 * @throws `DataError` when the input is neither a string nor bytes.
 * @throws `ReadError` when the bytes are not UTF-8.
 * @throws `SecurityError` when the file is longer than `maxBytes`.
 */
export function readFileText(input: unknown, limits: ItemFormatLimits, label: string): string {
  const { maxBytes } = limits;
  const tooLong = () =>
    new SecurityError(`${label} is longer than ${maxBytes} bytes, the limit maxBytes.`, "maxBytes", maxBytes);
  if (typeof input === "string") {
    if (exceedsBytes(input, maxBytes)) throw tooLong();
    return input.replaceAll(LONE_SURROGATE, "\uFFFD");
  }
  if (!(input instanceof Uint8Array)) {
    throw new DataError(`${label} must be a string or bytes, found ${describe(input)}.`);
  }
  if (input.length > maxBytes) throw tooLong();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch (error) {
    throw new ReadError(`${label} is not UTF-8, which Moodle reads alone.`, [], { cause: error });
  }
}

/** Returns an identifier for an item: its identifier in the bank when that is a QTI identifier, else `item-<n>`. */
function identifierFor(idNumber: string, position: number, used: Set<string>): string {
  let identifier = isIdentifier(idNumber) && !used.has(idNumber) ? idNumber : `item-${position + 1}`;
  for (let suffix = 2; used.has(identifier); suffix += 1) identifier = `item-${position + 1}-${suffix}`;
  used.add(identifier);
  return identifier;
}

/**
 * Converts what a reader found into items, in order, each under the category that the file last named, with the losses
 * of each and an omitted entry for each question that Moodle refuses.
 *
 * @throws `SecurityError` when the texts of the file pass the limits.
 */
export function importEntries(entries: readonly ReadEntry[], options: ResolvedReadOptions): ImportedItems {
  const state = createContentState(options.limits);
  const items: BankItem[] = [];
  const losses: ConversionLoss[] = [];
  const used = new Set<string>();
  const files = new Map<string, Uint8Array>();
  let category: string | undefined;
  let index = 0;
  for (const entry of entries) {
    if (entry.kind === "category") {
      category = entry.category;
      continue;
    }
    if (entry.kind !== "question") {
      const message = entry.kind === "error" ? `Moodle refuses the question: ${entry.message}` : entry.message;
      losses.push({ index, item: entry.name, omitted: true, reason: "item", message });
      index += 1;
      continue;
    }
    const { question } = entry;
    const identifier = identifierFor(question.idNumber, index, used);
    const built = buildItem(question, identifier, { state, labels: options.labels, files });
    items.push({
      item: built.item,
      ...(category === undefined ? {} : { category }),
      ...(question.tags.length === 0 ? {} : { tags: question.tags }),
    });
    for (const loss of built.losses) losses.push({ index, item: identifier, omitted: false, ...loss });
    index += 1;
  }
  return { items, files, losses };
}
