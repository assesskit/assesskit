/**
 * The positive credits that Moodle accepts for an answer, as it stores them to seven decimals: p/q for q up to 6, p/10, 1/q
 * for q up to 10, and 1/20. With their negatives and 0 they are the grade list of `question_bank::fraction_options_full`.
 */
const POSITIVE_GRADES: readonly number[] = [
  1, 0.9, 0.8333333, 0.8, 0.75, 0.7, 0.6666667, 0.6, 0.5, 0.4, 0.3333333, 0.3, 0.25, 0.2, 0.1666667, 0.1428571, 0.125,
  0.1111111, 0.1, 0.05,
];

/** Every credit of the grade list, from -1 to 1. */
const GRADES: readonly number[] = [0, ...POSITIVE_GRADES, ...POSITIVE_GRADES.map((grade) => -grade)];

/** How far a credit may lie from a grade of the list and still be that grade, as `match_grade_options` reads a file. */
const GRADE_TOLERANCE = 0.00001;

/**
 * Returns the grade of Moodle's list that a credit is, as `match_grade_options` matches it on import, or `undefined` when no
 * grade lies within 0.00001 of it, which Moodle refuses with its question.
 *
 * @see {@link https://github.com/moodle/moodle/blob/v5.3.0/public/lib/questionlib.php | Moodle, match_grade_options}
 */
export function findGrade(credit: number): number | undefined {
  return GRADES.find((grade) => Math.abs(credit - grade) < GRADE_TOLERANCE);
}

/** Returns the grade of Moodle's list nearest a credit from -1 to 1, the first of two at the same distance. */
export function nearestGrade(credit: number): number {
  let best = 0;
  for (const grade of GRADES) if (Math.abs(credit - grade) < Math.abs(credit - best)) best = grade;
  return best;
}
