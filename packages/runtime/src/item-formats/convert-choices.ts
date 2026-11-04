import { buildContainer, buildSingle, type Value } from "../values/index.js";
import { findAttribute, type XmlElement } from "../xml/index.js";
import {
  asGrade,
  type ConvertContext,
  classifyFeedback,
  elements,
  type FeedbackUse,
  type ItemView,
  readCorrect,
  SAME,
  type Sample,
  sampleOf,
} from "./item-view.js";
import type { Probe } from "./probe.js";
import {
  type ChoiceAnswer,
  emptyText,
  type FormattedText,
  percent,
  type Question,
  type QuestionCommon,
  Refused,
} from "./question.js";

// A choice interaction as Moodle's multiple choice: one answer gives its credit; several give the sum of theirs, floored at
// 0 and capped at the mark. The credits are learned by running the item's response processing on each choice, and on sets
// of choices that tell a sum of credits from any other rule.

/** The most choices whose every subset a writer runs; past it, it runs the subsets that tell a sum apart. */
const EXHAUSTIVE_CHOICES = 10;
/** The most sets of positive choices beside which a writer runs a choice of no credit alone, the largest sums first. */
const MAX_POSITIVE_SETS = 64;

/** A choice of an interaction: its identifier and its content. */
export interface Choice {
  readonly id: string;
  readonly content: FormattedText;
}

/** The scores that the item's response processing gives the choices. */
interface ChoiceScores {
  readonly single: boolean;
  readonly ids: readonly string[];
  /** The score of each choice alone. */
  readonly alone: readonly number[];
  /** The choices that earn credit alone. */
  readonly positive: readonly number[];
  /** The sets of choices that the writer runs together, with their scores. */
  readonly subsets: readonly (readonly number[])[];
  readonly subsetScores: readonly number[];
  readonly mark: number;
}

function choiceValue(single: boolean, ids: readonly string[]): Value | null {
  if (ids.length === 0) return null;
  return single ? buildSingle("identifier", ids[0] ?? "") : buildContainer("multiple", "identifier", ids);
}

function runChoices(probe: Probe, ids: readonly string[], members: readonly number[]): number {
  return (
    probe(
      choiceValue(
        false,
        members.map((index) => ids[index] ?? ""),
      ),
    ).score ?? 0
  );
}

function sumOf(members: readonly number[], values: readonly number[]): number {
  let sum = 0;
  for (const index of members) sum += values[index] ?? 0;
  return sum;
}

/** Every subset of a list when it is short, else its prefixes, as sets of indexes. */
function subsetsOf(list: readonly number[]): number[][] {
  if (list.length > EXHAUSTIVE_CHOICES) return list.map((_, at) => list.slice(0, list.length - at));
  const subsets: number[][] = [];
  for (let mask = 1; mask < 2 ** list.length; mask += 1) subsets.push(list.filter((_, at) => (mask >> at) & 1));
  return subsets;
}

/** Every subset of the choices when they are few; else the subsets that tell a sum of credits from other rules. */
function choiceSubsets(count: number, positive: readonly number[]): readonly (readonly number[])[] {
  const all = [...Array(count).keys()];
  if (count <= EXHAUSTIVE_CHOICES) return subsetsOf(all);
  return [
    ...all.map((index) => [index]),
    positive,
    ...all.filter((index) => !positive.includes(index)).map((index) => [...positive, index]),
    ...positive.map((index) => positive.filter((other) => other !== index)),
    all,
  ];
}

function scoreChoices(
  probe: Probe,
  ids: readonly string[],
  single: boolean,
  declared: number | undefined,
): ChoiceScores {
  const alone = ids.map((id) => probe(choiceValue(single, [id])).score ?? 0);
  const positive = [...alone.keys()].filter((index) => (alone[index] ?? 0) > 0);
  const subsets = single ? [] : choiceSubsets(ids.length, positive);
  const subsetScores = subsets.map((subset) => runChoices(probe, ids, subset));
  let best = 0;
  for (const score of single ? alone : subsetScores) best = Math.max(best, score);
  const mark = declared ?? best;
  if (!(mark > 0))
    throw new Refused("No response earns credit, and Moodle's multiple choice needs an answer that does.");
  return { single, ids, alone, positive, subsets, subsetScores, mark };
}

/**
 * Learns the credit of a choice of no credit alone, which shows only beside positive ones since the sum is floored at 0:
 * beside sets of positive choices, the largest sum first, until the sum lies strictly between 0 and the mark. When every
 * sum is floored, the credit takes away at least the largest, which -100% does for each set, as the item does.
 */
function creditBeside(probe: Probe, scores: ChoiceScores, index: number): number {
  const { ids, alone, positive, mark } = scores;
  const sets = subsetsOf([...positive].sort((left, right) => (alone[right] ?? 0) - (alone[left] ?? 0)))
    .map((members) => ({ members, sum: sumOf(members, alone) }))
    .sort((left, right) => right.sum - left.sum)
    .slice(0, MAX_POSITIVE_SETS);
  let floored = false;
  for (const { members, sum } of sets) {
    const withIt = runChoices(probe, ids, [...members, index]);
    if (withIt > 0 && withIt < mark * (1 - SAME)) return (withIt - sum) / mark;
    if (withIt <= 0) floored = true;
  }
  return floored ? -1 : 0;
}

function fitCredits(probe: Probe, scores: ChoiceScores): number[] {
  const { single, alone, positive, mark } = scores;
  return alone.map((score, index) =>
    single || score > 0 || positive.length === 0 ? score / mark : creditBeside(probe, scores, index),
  );
}

/**
 * Checks that the credits sum to the item's score on every set run, Moodle's rule; when they do not, the credits become an
 * equal share of each right answer of the correct response and -100% for a wrong one, and a loss says so.
 */
function checkSum(scores: ChoiceScores, credits: number[], view: ItemView): number[] {
  const { ids, subsets, subsetScores, mark, positive } = scores;
  const moodle = (subset: readonly number[]) => Math.min(1, Math.max(0, sumOf(subset, credits)));
  const differs = subsets.findIndex((subset, at) => Math.abs((subsetScores[at] ?? 0) / mark - moodle(subset)) > SAME);
  if (differs < 0 && positive.length > 0) return credits;
  const correct = readCorrect(view.declaration);
  const keys = ids.flatMap((id, index) => (correct.includes(id) ? [index] : []));
  const example = Math.max(differs, 0);
  view.losses.push({
    reason: "scoring",
    message: `The item gives ${percent((subsetScores[example] ?? 0) / mark)}% for the choices ${(subsets[example] ?? []).map((index) => ids[index]).join(", ")}, which a sum of credits per answer, Moodle's rule, does not: ${keys.length > 0 ? "each right answer earns an equal share and a wrong one takes 100%" : "the answers keep the credit they earn alone"}.`,
  });
  return keys.length > 0 ? ids.map((_, index) => (keys.includes(index) ? 1 / keys.length : -1)) : credits;
}

function recordSettings(interaction: XmlElement, single: boolean, count: number, view: ItemView): void {
  const shuffle = findAttribute(interaction, "shuffle") === "true";
  if (shuffle && elements(interaction).some((choice) => findAttribute(choice, "fixed") === "true")) {
    view.losses.push({
      reason: "setting",
      message: "Moodle shuffles every answer or none: the choices that stay in place are shuffled.",
    });
  }
  const maxChoices = Number(findAttribute(interaction, "max-choices") ?? "1");
  const minChoices = Number(findAttribute(interaction, "min-choices") ?? "0");
  if (!single && ((maxChoices > 0 && maxChoices < count) || minChoices > 1)) {
    view.losses.push({
      reason: "setting",
      message: "Moodle lets a candidate choose any number of answers: the limits of the choices are left out.",
    });
  }
}

function choiceFeedback(probe: Probe, scores: ChoiceScores, view: ItemView): FeedbackUse {
  const { single, ids, positive, mark } = scores;
  const samples: Sample[] = [
    { answers: [], result: probe(null), fraction: 0 },
    ...ids.map((id, index) => sampleOf(probe, choiceValue(single, [id]), [index], mark)),
  ];
  if (!single && positive.length > 0) {
    samples.push(
      sampleOf(
        probe,
        choiceValue(
          false,
          positive.map((index) => ids[index] ?? ""),
        ),
        positive,
        mark,
      ),
    );
  }
  return classifyFeedback(view, samples, ids.length);
}

/** A choice of the identifiers `true` and `false` with plain labels, one right and one wrong: a true-false question. */
function trueFalseAnswer(choices: readonly Choice[], grades: readonly number[], single: boolean): boolean | undefined {
  const [first, second] = choices;
  if (!single || choices.length !== 2 || first?.id !== "true" || second?.id !== "false") return undefined;
  if (choices.some(({ content }) => content.text.includes("<"))) return undefined;
  if (grades[0] === 1 && grades[1] === 0) return true;
  return grades[1] === 1 && grades[0] === 0 ? false : undefined;
}

/** Converts a choice interaction, or an inline one, into a multiple-choice or a true-false question. */
export function convertChoices(
  interaction: XmlElement,
  choices: readonly Choice[],
  probe: Probe,
  view: ItemView,
  common: QuestionCommon,
  context: ConvertContext,
): Question {
  const single = findAttribute(view.declaration ?? interaction, "cardinality") !== "multiple";
  if (choices.length < 2) throw new Refused("Moodle's multiple choice needs at least two answers.");
  if (choices.length > context.limits.maxAnswers) {
    throw new Refused(
      `The interaction has ${choices.length} choices, over the limit maxAnswers of ${context.limits.maxAnswers}.`,
    );
  }
  const scores = scoreChoices(
    probe,
    choices.map(({ id }) => id),
    single,
    view.mark,
  );
  const credits = single ? fitCredits(probe, scores) : checkSum(scores, fitCredits(probe, scores), view);
  recordSettings(interaction, single, choices.length, view);
  const feedback = choiceFeedback(probe, scores, view);
  const grades = credits.map((credit, index) => asGrade(credit, `the choice ${choices[index]?.id}`, view));
  const scored = { ...common, defaultMark: scores.mark, generalFeedback: feedback.general };
  const right = trueFalseAnswer(choices, grades, single);
  if (right !== undefined) {
    return {
      ...scored,
      qtype: "truefalse",
      correct: right,
      feedbackTrue: feedback.answers.get(0) ?? emptyText(),
      feedbackFalse: feedback.answers.get(1) ?? emptyText(),
    };
  }
  const answers: ChoiceAnswer[] = choices.map((choice, index) => ({
    text: choice.content,
    fraction: grades[index] ?? 0,
    feedback: feedback.answers.get(index) ?? emptyText(),
  }));
  return {
    ...scored,
    qtype: "multichoice",
    single,
    shuffle: findAttribute(interaction, "shuffle") === "true",
    numbering: "abc",
    answers,
    combined: feedback.combined,
  };
}
