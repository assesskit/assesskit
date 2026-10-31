import {
  type AssessmentItem,
  type BodyNode,
  type Catalog,
  descendantNodes,
  type FileHref,
  type HtmlContent,
} from "../asi/index.js";
import { checkArray, checkRecord, checkString, describe } from "../checks.js";
import type { Issue } from "../errors.js";
import type { SupportName } from "../pnp/index.js";

/** The content of a card: HTML content, or references to files (BPIG §3.7.10). */
export interface CardContent {
  /** The HTML content; absent when the card gives files. */
  readonly htmlContent?: HtmlContent;
  /** References to files in the package; empty when the card gives HTML content. */
  readonly fileHrefs: readonly FileHref[];
}

/** Returns the primary language subtag of a language tag, in lower case: `fr` for `fr-CA` (BCP 47 §2.1). */
const primaryOf = (tag: string): string => (tag.split("-")[0] ?? "").toLowerCase();

/**
 * Selects the card entry for a language: the entry whose `xml:lang` is the language, ignoring case; else the first entry
 * whose primary subtag is the language's; else the entry designated `default` (BPIG §3.7.10, INFO §5.27.2).
 */
function entryFor<T extends { readonly language?: string; readonly default?: boolean }>(
  entries: readonly T[],
  language: string | undefined,
): T | undefined {
  const wanted = language?.toLowerCase();
  const exact = entries.find((entry) => wanted !== undefined && entry.language?.toLowerCase() === wanted);
  const related = entries.find(
    (entry) =>
      language !== undefined && entry.language !== undefined && primaryOf(entry.language) === primaryOf(language),
  );
  return exact ?? related ?? entries.find((entry) => entry.default === true);
}

/**
 * Selects the content of the card that a catalog has for a support (BPIG §3.7.10, INFO §5.26–5.27). A card without card
 * entries gives its own content. A card with entries gives the entry for the language, by `xml:lang` (the same tag, then
 * the same primary language), and else the entry marked `default`.
 *
 * @param catalog - The catalog.
 * @param support - The support that was requested, such as `glossary-on-screen` or `ext:name`.
 * @param language - The language tag of the candidate's PNP, such as the `item-translation` language. Default: none, which
 * gives the default entry.
 * @returns The content, or `undefined` when the catalog has no card for the support or no entry fits.
 * @throws `DataError` when an argument has the wrong type.
 */
export function selectCard(catalog: Catalog, support: SupportName, language?: string): CardContent | undefined {
  checkRecord(catalog, "The catalog must be an object of the model of qti-catalog");
  checkArray(catalog.cards, "The cards of the catalog must be an array");
  checkString(support, "The support");
  if (language !== undefined) checkString(language, "The language");
  const card = catalog.cards.find((candidate) => candidate.support === support);
  if (card === undefined) return undefined;
  const chosen = card.cardEntries.length === 0 ? card : entryFor(card.cardEntries, language);
  if (chosen === undefined) return undefined;
  return {
    ...(chosen.htmlContent === undefined ? {} : { htmlContent: chosen.htmlContent }),
    fileHrefs: chosen.fileHrefs,
  };
}

/**
 * Returns the catalogs that a node refers to with `data-catalog-idref` (BPIG §3.7.10.2). A catalog may be anywhere in the
 * item, in its `qti-catalog-info` or in that of feedback or a rubric block, and its `id` is unique.
 *
 * @param item - The item.
 * @param node - A node of the item's content, such as an interaction or a paragraph.
 * @returns The catalogs with the node's `data-catalog-idref` as their `id`; none when the node has no such attribute.
 * @throws `DataError` when an argument has the wrong type.
 */
export function catalogsFor(item: AssessmentItem, node: BodyNode): readonly Catalog[] {
  const input: unknown = item;
  checkRecord(input, "The item must be an object of the model of qti-assessment-item");
  checkRecord(node, "The node must be an object of the model");
  const idref = "dataCatalogIdref" in node ? node.dataCatalogIdref : undefined;
  if (idref === undefined) return [];
  const roots = [
    ...(item.body?.children ?? []),
    ...item.modalFeedback,
    ...(item.catalogInfo === undefined ? [] : [item.catalogInfo]),
  ];
  return roots
    .flatMap((root) => [root, ...descendantNodes(root)])
    .filter(
      (candidate): candidate is Catalog => candidate.kind === "catalog" && "id" in candidate && candidate.id === idref,
    );
}

const CARDS = "BPIG §3.7.10";

/**
 * Checks a catalog against the rules of cards (BPIG §3.7.10).
 *
 * | Code                                    | Reported when                                                          |
 * | --------------------------------------- | ---------------------------------------------------------------------- |
 * | `assesskit/content/duplicate-card`           | two cards of the catalog have the same `support` (INFO §5.26.1)         |
 * | `assesskit/content/empty-card`               | a card or a card entry has neither HTML content nor a file reference    |
 * | `assesskit/content/duplicate-default-entry`  | more than one entry of a card is the `default` (INFO §5.27.2)           |
 *
 * @param catalog - The catalog.
 * @returns One error per violation, in document order.
 * @throws `DataError` when `catalog` is not an object of the model of `qti-catalog`.
 */
export function checkCatalog(catalog: Catalog): readonly Issue[] {
  checkRecord(catalog, "The catalog must be an object of the model of qti-catalog");
  checkArray(catalog.cards, "The cards of the catalog must be an array");
  const issues: Issue[] = [];
  const supports = new Set<string>();
  const report = (code: string, message: string, source: string, element: string): void => {
    issues.push({ severity: "error", code, message, source, location: { element: `qti-catalog/${element}` } });
  };
  for (const card of catalog.cards) {
    const name = describe(card.support);
    if (supports.has(card.support)) {
      report(
        "assesskit/content/duplicate-card",
        `The catalog has more than one qti-card for the support ${name}, but it may have one.`,
        "INFO §5.26.1",
        "qti-card",
      );
    }
    supports.add(card.support);
    const empty = (content: CardContent): boolean =>
      content.htmlContent === undefined && content.fileHrefs.length === 0;
    if (card.cardEntries.length === 0 && empty(card)) {
      report(
        "assesskit/content/empty-card",
        `The qti-card for the support ${name} has no qti-html-content and no qti-file-href, so it gives no content.`,
        CARDS,
        "qti-card",
      );
    }
    if (card.cardEntries.some(empty)) {
      report(
        "assesskit/content/empty-card",
        `A qti-card-entry of the qti-card for the support ${name} has no qti-html-content and no qti-file-href, so it gives no content.`,
        CARDS,
        "qti-card/qti-card-entry",
      );
    }
    if (card.cardEntries.filter((entry) => entry.default === true).length > 1) {
      report(
        "assesskit/content/duplicate-default-entry",
        `More than one qti-card-entry of the qti-card for the support ${name} is the default, but one may be.`,
        "INFO §5.27.2",
        "qti-card/qti-card-entry",
      );
    }
  }
  return issues;
}
