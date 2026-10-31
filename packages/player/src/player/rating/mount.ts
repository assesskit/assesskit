import { type RubricRating, type ScoringRubric, scoreFromRatings } from "@assesskit/runtime/asi";
import { describe } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import { html, uniqueId } from "../internal.js";
import { buildRatingForm, type CriterionView, type RatingView, scoreText } from "./build.js";
import { type RatingFormOptions, type RatingSettings, readRatingOptions } from "./options.js";
import { ratingStyleSheet } from "./styles.js";

/** A rating form on the page. */
export interface MountedRatingForm {
  /** The ratings the form holds, in the order of the criteria; a criterion without a rating is left out. */
  readonly ratings: readonly RubricRating[];
  /** Their score, or `null` while a criterion has no rating. */
  readonly score: number | null;
  /**
   * Shows another rubric in the same place, with its ratings, as a rater moves through a queue.
   *
   * @remarks
   * The old ratings go, and `onChange` is not called. When it throws, the form shows what it showed before.
   *
   * @param rubric - The scoring rubric.
   * @param ratings - The ratings to show at first. Default: `[]`.
   * @throws `DataError` when the rubric fails `checkScoringRubric`, or a rating names an unknown criterion, names a
   * criterion twice, or gives a score that no level of its criterion has.
   */
  update(rubric: ScoringRubric, ratings?: readonly RubricRating[]): void;
  /**
   * Marks each criterion without a rating, moves the focus to the first one, and returns whether every criterion is rated.
   *
   * @remarks
   * In a read-only form it marks nothing and moves no focus.
   *
   * @returns `true` when every criterion has a rating.
   */
  reportValidity(): boolean;
  /** Removes the form and its listeners from the page. The shadow root of the host stays, empty. */
  destroy(): void;
}

/** What the form holds for the rubric on show. */
interface Shown {
  readonly rubric: ScoringRubric;
  readonly chosen: Map<string, number>;
  readonly view: RatingView;
  /** Ends the listeners of the view. */
  readonly stop: AbortController;
}

/** Returns the ratings of a map of scores, in the order of the criteria of the rubric. */
function ratingsOf(rubric: ScoringRubric, chosen: ReadonlyMap<string, number>): RubricRating[] {
  return rubric.criteria.flatMap(({ identifier }) => {
    const score = chosen.get(identifier);
    return score === undefined ? [] : [{ criterion: identifier, score }];
  });
}

/** Marks a criterion that has no rating, with a message that the group refers to. */
function showError(criterion: CriterionView, message: string): void {
  if (criterion.error !== undefined) return;
  const error = html("p", { id: uniqueId("ak-rating-error"), class: "ak-rating-error" }, message);
  criterion.error = error;
  criterion.group.append(error);
  criterion.group.setAttribute("aria-describedby", error.id);
  criterion.group.setAttribute("aria-invalid", "true");
}

/** Takes the mark of a missing rating off a criterion. */
function clearError(criterion: CriterionView): void {
  criterion.error?.remove();
  criterion.error = undefined;
  criterion.group.removeAttribute("aria-describedby");
  criterion.group.removeAttribute("aria-invalid");
}

/**
 * Builds the form of a rubric and its ratings without touching the page, so that a rubric or a rating that fails leaves
 * what the page shows as it was.
 *
 * @throws `DataError` as {@link MountedRatingForm.update} does.
 */
function show(rubric: ScoringRubric, ratings: readonly RubricRating[], settings: RatingSettings): Shown {
  // The check of the rubric and of each rating is the runtime's, which also gives the score of the ratings.
  const score = scoreFromRatings(rubric, ratings);
  const chosen = new Map(ratings.map(({ criterion, score: chosenScore }) => [criterion, chosenScore]));
  return { rubric, chosen, view: buildRatingForm(rubric, chosen, score, settings), stop: new AbortController() };
}

/**
 * Shows an accessible form in which a rater chooses a level for each criterion of a scoring rubric, with the score of the
 * ratings. It lives in a shadow root of `host`. The workflow (submitting, assignment, double rating) is the host's.
 *
 * @remarks
 * Each criterion is a group of native radio buttons with its description as the legend, so that the keyboard works as the
 * browser has it: Tab moves between groups and the arrow keys within one. The texts of the rubric are plain text in the
 * language of the rubric, which the interface may not share. A checklist asks for met or not met for each criterion, so that
 * a criterion that nobody rated is not taken for one that was not met. Where the score is `null` the form says that a
 * criterion is not rated.
 *
 * @param host - An element in the page that has no shadow root.
 * @param rubric - The scoring rubric.
 * @param options - See {@link RatingFormOptions}.
 * @returns The handle that gives the ratings and the score, shows another rubric, checks the form and takes it down.
 * @throws `DataError` when `host` is not an element that can have a shadow root and has none, the rubric fails
 * `checkScoringRubric`, an option is not of its type, or an initial rating does not fit the rubric.
 */
export function mountRatingForm(
  host: HTMLElement,
  rubric: ScoringRubric,
  options: RatingFormOptions,
): MountedRatingForm {
  if (!(host instanceof HTMLElement)) throw new DataError(`The host must be an element, found ${describe(host)}.`);
  const settings = readRatingOptions(options);
  let shown = show(rubric, settings.ratings, settings);
  let shadow: ShadowRoot;
  try {
    shadow = host.attachShadow({ mode: "open" });
  } catch {
    throw new DataError("The host must be an element that can have a shadow root and has none.");
  }
  // A sheet of its own for each form: WebKit keeps the media queries of a sheet that no root has adopted as they were.
  shadow.adoptedStyleSheets = [settings.stylesheet, ratingStyleSheet()];

  const current = (): { readonly ratings: RubricRating[]; readonly score: number | null } => {
    const ratings = ratingsOf(shown.rubric, shown.chosen);
    return { ratings, score: scoreFromRatings(shown.rubric, ratings) };
  };

  /** Puts a view in the shadow root and listens for the rater's choices. */
  const place = (next: Shown): void => {
    shown = next;
    shadow.replaceChildren(next.view.root);
    const { view, stop } = next;
    view.root.addEventListener("submit", (event) => event.preventDefault(), { signal: stop.signal });
    view.root.addEventListener(
      "change",
      (event) => {
        const choice = event.target instanceof HTMLInputElement ? view.choices.get(event.target) : undefined;
        if (choice === undefined) return;
        const { criterion, level } = choice;
        next.chosen.set(criterion.identifier, level.score);
        const entry = view.criteria.find((candidate) => candidate.criterion === criterion);
        if (entry !== undefined) clearError(entry);
        const { ratings, score } = current();
        view.status.textContent = scoreText(next.rubric, score, settings);
        settings.onChange?.(ratings, score);
      },
      { signal: stop.signal },
    );
  };
  place(shown);

  return {
    get ratings() {
      return current().ratings;
    },
    get score() {
      return current().score;
    },
    update: (nextRubric, nextRatings = []) => {
      const next = show(nextRubric, nextRatings, settings);
      shown.stop.abort();
      place(next);
    },
    reportValidity: () => {
      const missing = shown.view.criteria.filter(({ criterion }) => !shown.chosen.has(criterion.identifier));
      if (settings.readOnly) return missing.length === 0;
      for (const criterion of missing) showError(criterion, settings.messages.ratingChooseLevel);
      missing[0]?.inputs[0]?.focus();
      return missing.length === 0;
    },
    destroy: () => {
      shown.stop.abort();
      shadow.replaceChildren();
    },
  };
}
