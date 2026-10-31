import { type RubricCriterion, type RubricLevel, rubricScoreRange, type ScoringRubric } from "@assesskit/runtime/asi";
import { html, uniqueId } from "../internal.js";
import type { RatingSettings } from "./options.js";

/** A criterion on show, with the controls that choose its level. */
export interface CriterionView {
  /** The criterion. */
  readonly criterion: RubricCriterion;
  /** The element that holds the criterion: the group of radio buttons, or the entry of the read-only list. */
  readonly group: HTMLElement;
  /** The radio button of each level, in the order of the levels; empty in a read-only form. */
  readonly inputs: readonly HTMLInputElement[];
  /** The message that asks for a rating; absent until `reportValidity` shows it. */
  error: HTMLElement | undefined;
}

/** A form on show. */
export interface RatingView {
  /** The element to put in the shadow root. */
  readonly root: HTMLElement;
  /** The criteria in the order of the rubric. */
  readonly criteria: readonly CriterionView[];
  /** The criterion and level that each radio button chooses. */
  readonly choices: ReadonlyMap<HTMLInputElement, { readonly criterion: RubricCriterion; readonly level: RubricLevel }>;
  /** The element that tells the score. */
  readonly status: HTMLElement;
}

/**
 * Builds a text of the rubric: it takes the language of the rubric, which the interface may not share, and the direction
 * of its own script.
 */
function rubricText(rubric: ScoringRubric, text: string, tag: "span" | "strong" = "span"): HTMLElement {
  return html(tag, { ...(rubric.language === undefined ? {} : { lang: rubric.language }), dir: "auto" }, text);
}

/** Joins nodes with a space between them, so that the name of a control reads as words and not as one run. */
function spaced(nodes: readonly Node[]): Node[] {
  return nodes.flatMap((node, index) => (index === 0 ? [node] : [document.createTextNode(" "), node]));
}

/** Builds the name of a criterion: its description, or its identifier, and its weight when it is not 1. */
function criterionName(rubric: ScoringRubric, criterion: RubricCriterion, settings: RatingSettings): Node[] {
  const { messages, format } = settings;
  return spaced([
    rubricText(rubric, criterion.description ?? criterion.identifier),
    ...(criterion.weight === 1
      ? []
      : [html("span", { class: "ak-rating-weight" }, `${messages.ratingWeight} ${format(criterion.weight)}`)]),
  ]);
}

/** Builds what a level says: its name, its points and its description. */
function levelText(rubric: ScoringRubric, level: RubricLevel, settings: RatingSettings): Node[] {
  const { messages, format } = settings;
  const name =
    rubric.kind === "checklist"
      ? html("strong", {}, level.score === 0 ? messages.ratingNotMet : messages.ratingMet)
      : level.quality === undefined
        ? undefined
        : rubricText(rubric, level.quality, "strong");
  return spaced([
    ...(name === undefined ? [] : [name]),
    html("span", { class: "ak-rating-points" }, `${messages.ratingPoints} ${format(level.score)}`),
    ...(level.description === undefined ? [] : [rubricText(rubric, level.description)]),
  ]);
}

/** Builds the text of the score: "Score 7 out of 12", or that the criteria are not yet rated. */
export function scoreText(rubric: ScoringRubric, score: number | null, settings: RatingSettings): string {
  const { messages, format } = settings;
  if (score === null) return `${messages.ratingScore} ${messages.ratingNotRated}`;
  return `${messages.ratingScore} ${format(score)} ${messages.ratingOutOf} ${format(rubricScoreRange(rubric).maximum)}`;
}

function statusNode(rubric: ScoringRubric, score: number | null, settings: RatingSettings): HTMLElement {
  return html("output", { class: "ak-rating-score", role: "status" }, scoreText(rubric, score, settings));
}

/** Builds the group of radio buttons of a criterion. */
function criterionGroup(
  rubric: ScoringRubric,
  criterion: RubricCriterion,
  chosen: number | undefined,
  settings: RatingSettings,
  choices: Map<HTMLInputElement, { readonly criterion: RubricCriterion; readonly level: RubricLevel }>,
): CriterionView {
  const name = uniqueId("ak-rating-criterion");
  const rows = criterion.levels.map((level, index) => {
    const input = html("input", { type: "radio", name, value: String(index) });
    input.checked = level.score === chosen;
    choices.set(input, { criterion, level });
    return {
      input,
      label: html(
        "label",
        { class: "ak-rating-level" },
        input,
        html("span", {}, ...levelText(rubric, level, settings)),
      ),
    };
  });
  const group = html(
    "fieldset",
    { class: "ak-rating-criterion", role: "radiogroup" },
    html("legend", {}, ...criterionName(rubric, criterion, settings)),
    ...rows.map(({ label }) => label),
  );
  return { criterion, group, inputs: rows.map(({ input }) => input), error: undefined };
}

/** Builds the entry of a criterion in the read-only form: its name, and the level chosen or that there is none. */
function criterionEntry(
  rubric: ScoringRubric,
  criterion: RubricCriterion,
  chosen: number | undefined,
  settings: RatingSettings,
): CriterionView {
  const level = criterion.levels.find(({ score }) => score === chosen);
  const group = html(
    "div",
    { class: "ak-rating-criterion" },
    html("dt", {}, ...criterionName(rubric, criterion, settings)),
    level === undefined
      ? html("dd", { class: "ak-rating-none" }, settings.messages.ratingNotRated)
      : html("dd", {}, ...levelText(rubric, level, settings)),
  );
  return { criterion, group, inputs: [], error: undefined };
}

/**
 * Builds the form of a rubric with the ratings made so far, without touching the page.
 *
 * @param rubric - The scoring rubric, checked.
 * @param chosen - The score chosen for each criterion, by identifier.
 * @param score - The score of the ratings, or `null` while a criterion is unrated.
 * @param settings - The settings of the form.
 * @returns The view.
 */
export function buildRatingForm(
  rubric: ScoringRubric,
  chosen: ReadonlyMap<string, number>,
  score: number | null,
  settings: RatingSettings,
): RatingView {
  const choices = new Map<HTMLInputElement, { readonly criterion: RubricCriterion; readonly level: RubricLevel }>();
  const status = statusNode(rubric, score, settings);
  const label = settings.messages.ratingForm;
  if (settings.readOnly) {
    const criteria = rubric.criteria.map((criterion) =>
      criterionEntry(rubric, criterion, chosen.get(criterion.identifier), settings),
    );
    const list = html("dl", { class: "ak-rating-chosen" }, ...criteria.map(({ group }) => group));
    const root = html("section", { class: "ak-rating", "aria-label": label, lang: settings.language }, list, status);
    return { root, criteria, choices, status };
  }
  const criteria = rubric.criteria.map((criterion) =>
    criterionGroup(rubric, criterion, chosen.get(criterion.identifier), settings, choices),
  );
  const root = html(
    "form",
    { class: "ak-rating", "aria-label": label, lang: settings.language, novalidate: "" },
    ...criteria.map(({ group }) => group),
    status,
  );
  return { root, criteria, choices, status };
}
