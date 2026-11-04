import { buildContainer, type Value } from "../values/index.js";
import { findAttribute, type XmlElement } from "../xml/index.js";
import { hasMarkup, plainText } from "./body-html.js";
import {
  type ConvertContext,
  classifyFeedback,
  elements,
  html,
  type ItemView,
  readCorrect,
  SAME,
  type Sample,
  sampleOf,
} from "./item-view.js";
import type { Probe } from "./probe.js";
import { emptyText, type Question, type QuestionCommon, Refused, type Subquestion } from "./question.js";

// A match interaction as Moodle's matching question, whose stems each have one right answer and earn an equal share of the
// mark.

type Pair = readonly [XmlElement, XmlElement];

function identifierOf(element: XmlElement): string {
  return findAttribute(element, "identifier") ?? "";
}

function pairsValue(list: readonly Pair[]): Value | null {
  if (list.length === 0) return null;
  return buildContainer(
    "multiple",
    "directedPair",
    list.map(([source, target]) => [identifierOf(source), identifierOf(target)] as const),
  );
}

/** The right answer of each stem: the target of most credit with it, or of the correct response when none earns any. */
function rightTargets(
  sources: readonly XmlElement[],
  targets: readonly XmlElement[],
  credit: readonly (readonly number[])[],
  view: ItemView,
): (XmlElement | undefined)[] {
  const correct = new Set(readCorrect(view.declaration));
  return sources.map((source, index) => {
    const row = credit[index] ?? [];
    let best = -1;
    for (const [at, score] of row.entries()) if (score > 0 && (best < 0 || score > (row[best] ?? 0))) best = at;
    if (row.filter((score) => score > 0).length > 1) {
      view.losses.push({
        reason: "scoring",
        message: `The stem ${identifierOf(source)} has several right answers; Moodle's match has one: the best is kept.`,
      });
    }
    if (best >= 0) return targets[best];
    return targets.find((target) => correct.has(`${identifierOf(source)} ${identifierOf(target)}`));
  });
}

/** Checks that each right stem earns an equal share of the mark and all of them the mark, Moodle's rule. */
function checkShares(
  targets: readonly XmlElement[],
  right: readonly (XmlElement | undefined)[],
  credit: readonly (readonly number[])[],
  shares: { readonly full: number; readonly mark: number; readonly stems: number },
  view: ItemView,
): void {
  const { full, mark, stems } = shares;
  const equal = right.every((target, index) => {
    const at = target === undefined ? -1 : targets.indexOf(target);
    return target === undefined || Math.abs((credit[index]?.[at] ?? 0) / mark - 1 / stems) <= SAME;
  });
  if (!equal || Math.abs(full / mark - 1) > SAME) {
    view.losses.push({
      reason: "scoring",
      message:
        "The item does not credit each right stem an equal share, Moodle's rule: each right stem earns an equal share.",
    });
  }
  const limited = (target: XmlElement) => {
    const max = Number(findAttribute(target, "match-max") ?? "1");
    return max !== 0 && max < stems;
  };
  if (targets.some(limited)) {
    view.losses.push({
      reason: "setting",
      message: "Moodle lets a candidate give an answer to several stems: the answers' limits are left out.",
    });
  }
}

/** The stems with their right answers' texts, then each target that no stem takes as an extra wrong answer. */
function subquestionsOf(
  sources: readonly XmlElement[],
  targets: readonly XmlElement[],
  right: readonly (XmlElement | undefined)[],
  view: ItemView,
): Subquestion[] {
  const answerText = (target: XmlElement) => {
    if (hasMarkup(target.children)) {
      view.losses.push({
        reason: "content",
        message: `The answer ${identifierOf(target)} keeps its text alone: Moodle's answers of a match are plain text.`,
      });
    }
    return plainText(target.children);
  };
  return [
    ...sources.flatMap((source, index) => {
      const target = right[index];
      return target === undefined ? [] : [{ text: html(source.children, view), answer: answerText(target) }];
    }),
    ...targets
      .filter((target) => !right.includes(target))
      .map((target) => ({ text: emptyText(), answer: answerText(target) })),
  ];
}

/** Converts a match interaction into a matching question. */
export function convertMatch(
  interaction: XmlElement,
  probe: Probe,
  view: ItemView,
  common: QuestionCommon,
  context: ConvertContext,
): Question {
  const [sources, targets] = elements(interaction, "qti-simple-match-set").map((set) =>
    elements(set, "qti-simple-associable-choice"),
  );
  if (sources === undefined || targets === undefined || sources.length === 0)
    throw new Refused("The match has no stems.");
  if (sources.length > context.limits.maxAnswers || targets.length > context.limits.maxAnswers) {
    throw new Refused(`The match has more than ${context.limits.maxAnswers} choices in a set, the limit maxAnswers.`);
  }
  const credit = sources.map((source) => targets.map((target) => probe(pairsValue([[source, target]])).score ?? 0));
  const right = rightTargets(sources, targets, credit, view);
  const full: Pair[] = sources.flatMap((source, index) => {
    const target = right[index];
    return target === undefined ? [] : [[source, target] as const];
  });
  const fullScore = probe(pairsValue(full)).score ?? 0;
  const mark = view.mark ?? fullScore;
  if (!(mark > 0)) throw new Refused("No response earns credit, and Moodle's match needs right answers.");
  if (full.length < sources.length) {
    view.losses.push({
      reason: "scoring",
      message: "A stem has no right answer, which Moodle's match needs: it is left out.",
    });
  }
  checkShares(targets, right, credit, { full: fullScore, mark, stems: full.length }, view);
  const samples: Sample[] = [
    { answers: [], result: probe(null), fraction: 0 },
    ...full.map((pair, index) => sampleOf(probe, pairsValue([pair]), [index], mark)),
    sampleOf(
      probe,
      pairsValue(full),
      full.map((_, index) => index),
      mark,
    ),
  ];
  const feedback = classifyFeedback(view, samples, full.length);
  if (feedback.answers.size > 0) {
    view.losses.push({
      reason: "feedback",
      message: "Moodle's match has no feedback of one stem: the feedback of single pairs is left out.",
    });
  }
  return {
    ...common,
    defaultMark: mark,
    generalFeedback: feedback.general,
    qtype: "match",
    shuffle: findAttribute(interaction, "shuffle") === "true",
    subquestions: subquestionsOf(sources, targets, right, view),
    combined: feedback.combined,
  };
}
