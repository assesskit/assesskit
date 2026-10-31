import * as v from "valibot";
import { finiteSchema, parseWith, strictRecord } from "../checks.js";
import { DataError } from "../errors.js";
import { checkScoringRubric, type ScoringRubric } from "./scoring-rubric.js";

/** A rating of one criterion: the score of the level chosen. A list of them is plain JSON. */
export interface RubricRating {
  /** The identifier of the criterion. */
  readonly criterion: string;
  /** The score of the chosen level of that criterion. */
  readonly score: number;
}

const ratingsSchema = v.array(strictRecord({ criterion: v.string(), score: finiteSchema }));

/** Returns the score of each criterion that ratings name, refusing a rating that does not fit the rubric. */
function chosenScores(rubric: ScoringRubric, ratings: readonly RubricRating[]): ReadonlyMap<string, number> {
  const chosen = new Map<string, number>();
  for (const { criterion, score } of ratings) {
    const found = rubric.criteria.find(({ identifier }) => identifier === criterion);
    if (found === undefined) {
      throw new DataError(
        `A rating names the criterion ${JSON.stringify(criterion)}, which the scoring rubric does not have.`,
      );
    }
    if (chosen.has(criterion))
      throw new DataError(`The criterion ${JSON.stringify(criterion)} has more than one rating.`);
    if (!found.levels.some((level) => level.score === score)) {
      const message = `The rating of the criterion ${JSON.stringify(criterion)} gives the score ${score}, which no level of the criterion has.`;
      throw new DataError(message);
    }
    chosen.set(criterion, score);
  }
  return chosen;
}

/**
 * Returns the score that ratings give under a scoring rubric: the sum over the criteria, in document order, of weight
 * times the score of the chosen level.
 *
 * @remarks
 * CASE gives the weight of a criterion no formula; the weighted sum is the rule of this convention. The sum runs in the
 * order of the criteria in binary floating point, so the result does not depend on the order of the ratings and is the
 * same on every machine.
 *
 * @param rubric - The scoring rubric.
 * @param ratings - One rating for each criterion rated; a criterion may be left out.
 * @returns The score, or `null` when a criterion has no rating.
 * @throws `DataError` when the rubric fails {@link checkScoringRubric}, a rating is not an object with a string
 * `criterion` and a finite `score`, names an unknown criterion or one that already has a rating, or gives a score that no
 * level of its criterion has.
 * @see {@link https://www.imsglobal.org/sites/default/files/CASE/casev1p0/information_model/caseservicev1p0_infomodelv1p0.html | CASE 1.0 Information Model, CFRubricCriterion}
 */
export function scoreFromRatings(rubric: ScoringRubric, ratings: readonly RubricRating[]): number | null {
  checkScoringRubric(rubric);
  const chosen = chosenScores(rubric, parseWith(ratingsSchema, ratings, "The ratings"));
  let score = 0;
  for (const { identifier, weight } of rubric.criteria) {
    const level = chosen.get(identifier);
    if (level === undefined) return null;
    score += weight * level;
  }
  return score;
}

/**
 * Returns the lowest and the highest score that ratings of a scoring rubric can give: the sums, in the order of the
 * criteria, of weight times the lowest and of weight times the highest score of the levels. The rubric is trusted.
 */
export function scoreRange(rubric: ScoringRubric): { readonly minimum: number; readonly maximum: number } {
  let minimum = 0;
  let maximum = 0;
  for (const { weight, levels } of rubric.criteria) {
    const scores = levels.map(({ score }) => score);
    minimum += weight * Math.min(...scores);
    maximum += weight * Math.max(...scores);
  }
  return { minimum, maximum };
}
