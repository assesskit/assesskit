import type { AcceptedDifference } from "../../conformance/accepted.ts";
import type { Implementation, ItemCase, Observed, Run } from "./model.ts";

/** Where two implementations disagree about an item. */
export interface Difference {
  /** The name of the case. */
  readonly item: string;
  /** What differs: whether the item is accepted at all, an outcome value, or a template value. */
  readonly kind: "acceptance" | "outcome" | "template";
  /** The identifier of the variable; empty for acceptance. */
  readonly variable: string;
  /** What the reference reports; `undefined` when it has no such variable or does not accept the item. */
  readonly reference: Observed | undefined;
  /** What the subject reports; `undefined` when it has no such variable or does not accept the item. */
  readonly subject: Observed | undefined;
}

/** The result of comparing implementations on a list of cases. */
export interface Report {
  /** The cases both implementations accepted, whose values were compared. */
  readonly compared: number;
  /** The cases both implementations rejected, with the reference's reason. */
  readonly rejected: readonly { readonly item: string; readonly reason: string }[];
  /** The disagreements that nothing accepts. */
  readonly differences: readonly Difference[];
  /** The disagreements that the accepted differences list. */
  readonly accepted: readonly Difference[];
}

/** Returns whether two values are equal: scalars by `===`, lists and records element by element. */
export function sameValue(a: Observed | undefined, b: Observed | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => item === b[i]);
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => sameValue(a[key], b[key]));
  }
  return a === b;
}

/** Compares the variables of two records. */
function compareVariables(
  item: string,
  kind: "outcome" | "template",
  reference: Readonly<Record<string, Observed>>,
  subject: Readonly<Record<string, Observed>>,
): Difference[] {
  const identifiers = [...new Set([...Object.keys(reference), ...Object.keys(subject)])].sort();
  return identifiers
    .filter((variable) => !sameValue(reference[variable], subject[variable]))
    .map((variable) => ({ item, kind, variable, reference: reference[variable], subject: subject[variable] }));
}

/** Compares the runs of one item. */
function compareRuns(item: string, reference: Run, subject: Run): Difference[] {
  if (reference.accepted && subject.accepted) {
    return [
      ...compareVariables(item, "outcome", reference.observation.outcomes, subject.observation.outcomes),
      ...compareVariables(item, "template", reference.observation.templateValues, subject.observation.templateValues),
    ];
  }
  if (reference.accepted !== subject.accepted) {
    return [{ item, kind: "acceptance", variable: "", reference: reference.accepted, subject: subject.accepted }];
  }
  return [];
}

/**
 * Runs both implementations on every case and compares what they report.
 *
 * @param accepted - The differences to set aside; they appear in the report as accepted.
 */
export function compare(
  cases: readonly ItemCase[],
  reference: Implementation,
  subject: Implementation,
  accepted: readonly AcceptedDifference[],
): Report {
  const rejected: { item: string; reason: string }[] = [];
  const differences: Difference[] = [];
  const accepts: Difference[] = [];
  let compared = 0;
  for (const testCase of cases) {
    const referenceRun = reference.run(testCase);
    const subjectRun = subject.run(testCase);
    if (referenceRun.accepted && subjectRun.accepted) compared++;
    else if (!(referenceRun.accepted || subjectRun.accepted))
      rejected.push({ item: testCase.name, reason: referenceRun.reason });
    for (const difference of compareRuns(testCase.name, referenceRun, subjectRun)) {
      const isAccepted = accepted.some(
        (entry) => entry.item === difference.item && entry.variable === difference.variable,
      );
      (isAccepted ? accepts : differences).push(difference);
    }
  }
  return { compared, rejected, differences, accepted: accepts };
}
