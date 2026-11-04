import type { AssessmentItem, BodyNode, Catalog, FileHref, HtmlContent } from "../asi/index.js";
import { withDescendants } from "../asi/internal.js";
import {
  checkArray,
  checkOptional,
  checkOptions,
  checkPositiveInteger,
  checkRecord,
  checkString,
  describe,
} from "../checks.js";
import type { Issue } from "../errors.js";
import type { Braille, SupportName } from "../pnp/index.js";

/**
 * The content of a card: HTML content, or references to files.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
export interface CardContent {
  /** The HTML content; absent when the card gives files. */
  readonly htmlContent?: HtmlContent;
  /** References to files in the package; empty when the card gives HTML content. */
  readonly fileHrefs: readonly FileHref[];
}

/** Returns the primary language subtag of a language tag, in lower case: `fr` for `fr-CA`. */
const primaryOf = (tag: string): string => (tag.split("-")[0] ?? "").toLowerCase();

/**
 * Selects the card entry for a language: the entry whose `xml:lang` is the language, ignoring case; else the first
 * entry whose primary subtag is the language's; else the entry designated `default`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
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
 * The attributes of a card entry that state a preference of braille, with the setting of the profile that each matches. The
 * guide adds `data-` to the names of the parameters of the PNP, and calls the grade `braille-grade`, so both names of the
 * grade are read (spec gaps, G52).
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, braille and tactile}
 */
const BRAILLE_ATTRIBUTES: readonly (readonly [string, (braille: Braille) => string | undefined])[] = [
  ["data-braille-type", ({ brailleType }) => brailleType],
  ["data-braille-grade", ({ grade }) => (grade === undefined ? undefined : String(grade))],
  ["data-grade", ({ grade }) => (grade === undefined ? undefined : String(grade))],
  ["data-math-type", ({ mathType }) => mathType],
];

/** An attribute of a card entry beyond those of the schema, as the model of `asi` keeps it. */
interface EntryAttribute {
  readonly namespace: string;
  readonly name: string;
  readonly value: string;
}

/** Returns what an entry states of the preferences of braille: for each attribute it has, whether it agrees. */
function brailleAgreement(extensions: readonly EntryAttribute[], braille: Braille): readonly boolean[] {
  return BRAILLE_ATTRIBUTES.flatMap(([name, wanted]) => {
    const stated = extensions.find((attribute) => attribute.namespace === "" && attribute.name === name)?.value;
    const preferred = wanted(braille);
    return stated === undefined || preferred === undefined
      ? []
      : [stated.trim().toLowerCase() === preferred.toLowerCase()];
  });
}

/**
 * Checks the preferences of braille that choose an entry, each of its type; a term outside the vocabulary is valid here, and
 * agrees with no entry that states another.
 *
 * @throws `DataError` when they are not an object, or a preference of the choice has the wrong type.
 */
function checkBraille(braille: unknown): void {
  checkRecord(braille, "The braille settings must be an object");
  const { brailleType, grade, mathType } = braille;
  checkOptional(brailleType, (value) => checkString(value, "The braille type"));
  checkOptional(grade, (value) => checkPositiveInteger(value, "The braille grade"));
  checkOptional(mathType, (value) => checkString(value, "The math type"));
}

/**
 * Selects the card entry for the preferences of braille and the language: among the entries whose braille attributes agree
 * with the preferences, the entry of the language or the default; else the first entry that states a preference and agrees;
 * else the entry of the language or the default among all, as the guide gives grade 2 where a higher grade is missing.
 */
function brailleEntryFor<
  T extends { readonly language?: string; readonly default?: boolean; readonly extensions: readonly EntryAttribute[] },
>(entries: readonly T[], language: string | undefined, braille: Braille): T | undefined {
  const agreements = entries.map(({ extensions }) => brailleAgreement(extensions, braille));
  const agreeing = entries.filter((_, index) => (agreements[index] ?? []).every(Boolean));
  const stating = entries.find((_, index) => {
    const agreement = agreements[index] ?? [];
    return agreement.length > 0 && agreement.every(Boolean);
  });
  return entryFor(agreeing, language) ?? stating ?? entryFor(entries, language);
}

/** The options of {@link selectCard}. */
export interface SelectCardOptions {
  /**
   * The language tag of the candidate's PNP, such as the `item-translation` language.
   *
   * @defaultValue none, which gives the default entry
   */
  readonly language?: string;
  /**
   * The settings of the candidate's `braille` support while it is on, whose preferences choose among entries that state
   * them, as those of a braille or a tactile card may.
   *
   * @defaultValue none
   */
  readonly braille?: Braille;
}

/**
 * Selects the content of the card that a catalog has for a support.
 *
 * @remarks
 * A card without card entries gives its own content. A card with entries gives the entry for the language, by
 * `xml:lang` (the same tag, then the same primary language), and else the entry marked `default`. With the braille settings
 * of the candidate, entries whose `data-braille-type`, `data-braille-grade` (or `data-grade`) and `data-math-type` disagree
 * with them are left out, and the first entry that states one and agrees is taken when no entry is of the language or the
 * default; when none is left, the rule of the language applies to all, as the guide gives grade 2 where a higher grade is
 * missing.
 *
 * @param catalog - The catalog.
 * @param support - The support that was requested, such as `glossary-on-screen` or `ext:name`.
 * @param options - See {@link SelectCardOptions}.
 * @returns The content, or `undefined` when the catalog has no card for the support or no entry fits.
 * @throws `DataError` when an argument has the wrong type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function selectCard(
  catalog: Catalog,
  support: SupportName,
  options: SelectCardOptions = {},
): CardContent | undefined {
  checkRecord(catalog, "The catalog must be an object of the model of qti-catalog");
  checkArray(catalog.cards, "The cards of the catalog must be an array");
  checkString(support, "The support");
  checkOptions(options);
  const { language, braille } = options;
  if (language !== undefined) checkString(language, "The language");
  if (braille !== undefined) checkBraille(braille);
  const card = catalog.cards.find((candidate) => candidate.support === support);
  if (card === undefined) return undefined;
  const { cardEntries } = card;
  const entry =
    braille === undefined ? entryFor(cardEntries, language) : brailleEntryFor(cardEntries, language, braille);
  const chosen = cardEntries.length === 0 ? card : entry;
  if (chosen === undefined) return undefined;
  return {
    ...(chosen.htmlContent === undefined ? {} : { htmlContent: chosen.htmlContent }),
    fileHrefs: chosen.fileHrefs,
  };
}

/**
 * Returns the catalogs that a node refers to with `data-catalog-idref`.
 *
 * @remarks
 * A catalog may be anywhere in the item, in its `qti-catalog-info` or in that of feedback or a rubric block, and its
 * `id` is unique.
 *
 * @param item - The item.
 * @param node - A node of the item's content, such as an interaction or a paragraph.
 * @returns The catalogs with the node's `data-catalog-idref` as their `id`; none when the node has no such attribute.
 * @throws `DataError` when an argument has the wrong type.
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, qti-catalog-info}
 */
export function listCatalogs(item: AssessmentItem, node: BodyNode): readonly Catalog[] {
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
  return withDescendants(roots).filter(
    (candidate): candidate is Catalog => candidate.kind === "catalog" && "id" in candidate && candidate.id === idref,
  );
}

/**
 * Checks a catalog against the rules of cards.
 *
 * @remarks
 * | Code                                        | Reported when                                                        |
 * | ------------------------------------------- | -------------------------------------------------------------------- |
 * | `assesskit/content/duplicate-card`          | two cards of the catalog have the same `support`                     |
 * | `assesskit/content/empty-card`              | a card or a card entry has neither HTML content nor a file reference |
 * | `assesskit/content/duplicate-default-entry` | more than one entry of a card is the `default`                       |
 *
 * @param catalog - The catalog.
 * @returns One error per violation, in document order.
 * @throws `DataError` when `catalog` is not an object of the model of `qti-catalog`.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function validateCatalog(catalog: Catalog): readonly Issue[] {
  checkRecord(catalog, "The catalog must be an object of the model of qti-catalog");
  checkArray(catalog.cards, "The cards of the catalog must be an array");
  const issues: Issue[] = [];
  const supports = new Set<string>();
  const report = (code: string, message: string, element: string): void => {
    issues.push({ severity: "error", code, message, location: { element: `qti-catalog/${element}` } });
  };
  for (const card of catalog.cards) {
    const name = describe(card.support);
    if (supports.has(card.support)) {
      report(
        "assesskit/content/duplicate-card",
        `The catalog has more than one qti-card for the support ${name}, but it may have one.`,
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
        "qti-card",
      );
    }
    if (card.cardEntries.some(empty)) {
      report(
        "assesskit/content/empty-card",
        `A qti-card-entry of the qti-card for the support ${name} has no qti-html-content and no qti-file-href, so it gives no content.`,
        "qti-card/qti-card-entry",
      );
    }
    if (card.cardEntries.filter((entry) => entry.default === true).length > 1) {
      report(
        "assesskit/content/duplicate-default-entry",
        `More than one qti-card-entry of the qti-card for the support ${name} is the default, but one may be.`,
        "qti-card/qti-card-entry",
      );
    }
  }
  return issues;
}
