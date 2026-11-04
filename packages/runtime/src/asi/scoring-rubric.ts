import * as v from "valibot";
import { describe, nonEmptyStringSchema, parseWith, positiveSchema, strictRecord } from "../checks.js";
import { nonNegativeSchema } from "../checks-internal.js";
import { DataError } from "../errors.js";
import { isIdentifier } from "../values/index.js";

/** The class token that marks a rubric block as the scoring rubric of an outcome (a convention of the runtime). */
export const SCORING_RUBRIC_CLASS = "external-scoring-rubric";

/** The kinds of scoring rubric, which constrain the shape of the criteria and levels. */
export const RUBRIC_KINDS = ["analytic", "holistic", "checklist", "single-point"] as const;

/** How the criteria and levels of a scoring rubric are shaped: analytic, holistic, checklist or single-point. */
export type RubricKind = (typeof RUBRIC_KINDS)[number];

/** A level of performance on a criterion. */
export interface RubricLevel {
  /** The points of the level: finite, 0 or more, unique within the criterion. */
  readonly score: number;
  /** A short name of the level, such as "Proficient"; absent when the block gives none. */
  readonly quality?: string;
  /** What performance at the level looks like, with white space normalized; absent when empty. */
  readonly description?: string;
}

/** A criterion of a scoring rubric. */
export interface RubricCriterion {
  /** The identifier of the criterion, which ratings name. */
  readonly identifier: string;
  /** The weight of the criterion: finite and greater than 0. */
  readonly weight: number;
  /** What the criterion rates, with white space normalized; absent when empty. */
  readonly description?: string;
  /** The levels, in document order. */
  readonly levels: readonly RubricLevel[];
}

/**
 * The scoring rubric of an externally scored outcome (a convention of the runtime), aligned with the rubric of the CASE
 * information model.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/CASE/casev1p0/information_model/caseservicev1p0_infomodelv1p0.html | CASE 1.0 Information Model, CFRubric}
 */
export interface ScoringRubric {
  /** The identifier of the outcome that the rubric rates. */
  readonly outcomeIdentifier: string;
  /** The kind of the rubric. */
  readonly kind: RubricKind;
  /** The language of its texts, from `xml:lang`; absent when the document gives none. */
  readonly language?: string;
  /** The criteria, in document order. */
  readonly criteria: readonly RubricCriterion[];
}

/** What is wrong with a scoring rubric, and the rule under which `validate` reports it. */
export interface RubricIssue {
  /** The rule that is broken: the form of the block or of a value, the shape that the kind requires, or an identity used twice. */
  readonly rule: "malformed" | "shape" | "duplicate";
  /** Where the rule is broken, such as `criteria[1].levels`; empty for the rubric as a whole. */
  readonly path: string;
  /** What is wrong, as a clause that follows the path. */
  readonly message: string;
}

/** The fewest levels of a criterion: a level to choose from needs a level to choose against. */
const MINIMUM_LEVELS = 2;
/** The levels of a checklist criterion: not met and met. */
const CHECKLIST_LEVELS = 2;
/** The levels of a single-point criterion: below, meets and above. */
const SINGLE_POINT_LEVELS = 3;
/** The weight of a criterion that gives none, and the only weight of a holistic rubric. */
export const DEFAULT_WEIGHT = 1;

const scoringRubricSchema = strictRecord({
  outcomeIdentifier: v.string(),
  kind: v.picklist(RUBRIC_KINDS),
  language: v.optional(nonEmptyStringSchema),
  criteria: v.array(
    strictRecord({
      identifier: v.string(),
      weight: positiveSchema,
      description: v.optional(v.string()),
      levels: v.array(
        strictRecord({
          score: nonNegativeSchema,
          quality: v.optional(v.string()),
          description: v.optional(v.string()),
        }),
      ),
    }),
  ),
});

/** Returns whether each score is greater than the one before. */
function ascends(scores: readonly number[]): boolean {
  let previous = Number.NEGATIVE_INFINITY;
  for (const score of scores) {
    if (score <= previous) return false;
    previous = score;
  }
  return true;
}

function levelIssues(kind: RubricKind, criterion: RubricCriterion, at: string): RubricIssue[] {
  const issues: RubricIssue[] = [];
  const { levels } = criterion;
  const add = (rule: RubricIssue["rule"], path: string, message: string): void => {
    issues.push({ rule, path, message });
  };
  const scores = new Set<number>();
  for (const [index, { score }] of levels.entries()) {
    if (scores.has(score)) {
      add(
        "duplicate",
        `${at}.levels[${index}].score`,
        `the score ${score} occurs twice among the levels, so a rating cannot name one`,
      );
    }
    scores.add(score);
  }
  if (kind === "checklist") {
    if (levels.length !== CHECKLIST_LEVELS) {
      add("shape", `${at}.levels`, `a checklist criterion has two levels, found ${levels.length}`);
    } else if (levels.filter(({ score }) => score === 0).length !== 1) {
      add("shape", `${at}.levels`, "a checklist criterion has exactly one level that scores 0, the level not met");
    }
  } else if (kind === "single-point") {
    if (levels.length !== SINGLE_POINT_LEVELS) {
      add("shape", `${at}.levels`, `a single-point criterion has three levels, found ${levels.length}`);
    } else if (!ascends(levels.map(({ score }) => score))) {
      add(
        "shape",
        `${at}.levels`,
        "the levels of a single-point criterion, below, meets and above, must score strictly more in turn",
      );
    }
  } else if (levels.length < MINIMUM_LEVELS) {
    add("shape", `${at}.levels`, `a criterion has two or more levels, found ${levels.length}`);
  }
  return issues;
}

/**
 * Returns each rule that a scoring rubric of the model breaks, in the order of the rubric: the identifiers, the criteria
 * and levels that each kind requires, and the identities that occur twice. A value that is not of the model is not
 * checked here.
 */
export function rubricIssues(rubric: ScoringRubric): RubricIssue[] {
  const issues: RubricIssue[] = [];
  if (!isIdentifier(rubric.outcomeIdentifier)) {
    const message = `the outcome identifier must be an identifier, found ${describe(rubric.outcomeIdentifier)}`;
    issues.push({ rule: "malformed", path: "outcomeIdentifier", message });
  }
  if (rubric.criteria.length === 0) {
    issues.push({
      rule: "malformed",
      path: "criteria",
      message: "a scoring rubric has one or more criteria, found none",
    });
  }
  if (rubric.kind === "holistic" && rubric.criteria.length > 1) {
    const message = `a holistic rubric has one criterion, found ${rubric.criteria.length}`;
    issues.push({ rule: "shape", path: "criteria", message });
  }
  const identifiers = new Set<string>();
  for (const [index, criterion] of rubric.criteria.entries()) {
    const at = `criteria[${index}]`;
    if (!isIdentifier(criterion.identifier)) {
      const message = `the criterion identifier must be an identifier, found ${describe(criterion.identifier)}`;
      issues.push({ rule: "malformed", path: `${at}.identifier`, message });
    } else if (identifiers.has(criterion.identifier)) {
      const message = `the criterion identifier ${criterion.identifier} occurs twice, so a rating cannot name one`;
      issues.push({ rule: "duplicate", path: `${at}.identifier`, message });
    }
    identifiers.add(criterion.identifier);
    if (rubric.kind === "holistic" && criterion.weight !== DEFAULT_WEIGHT) {
      const message = `the weight of the criterion of a holistic rubric is ${DEFAULT_WEIGHT}, found ${criterion.weight}, because the score is the score of the chosen level`;
      issues.push({ rule: "shape", path: `${at}.weight`, message });
    }
    for (const issue of levelIssues(rubric.kind, criterion, at)) issues.push(issue);
  }
  return issues;
}

/**
 * Checks a scoring rubric that arrived as JSON or from a caller: its shape, its numbers and identifiers, and the shape that
 * its kind requires.
 *
 * @param value - The value to check.
 * @throws `DataError` naming the first rule that the value breaks, such as `The scoring rubric is invalid at
 * criteria[1].levels: a single-point criterion has three levels, found 2.`
 */
export function checkScoringRubric(value: unknown): asserts value is ScoringRubric {
  const [issue] = rubricIssues(parseWith(scoringRubricSchema, value, "The scoring rubric"));
  if (issue === undefined) return;
  throw new DataError(
    `The scoring rubric is invalid${issue.path === "" ? "" : ` at ${issue.path}`}: ${issue.message}.`,
  );
}
