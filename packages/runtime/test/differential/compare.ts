import { type AcceptedDifference, showsIn } from "./accepted.js";
import type {
  Implementation,
  ItemCase,
  ItemRunner,
  Observed,
  Play,
  Run,
  SessionCase,
  TurnObservation,
} from "./model.js";

/** Where two implementations disagree about an item. */
export interface Difference {
  /** The name of the case. */
  readonly item: string;
  /**
   * What differs: whether the item, or a turn of its session, is accepted at all; an outcome value; a template value; or
   * `numAttempts` or whether the session closed after a turn.
   */
  readonly kind: "acceptance" | "outcome" | "template" | "session";
  /** The identifier of the variable; empty for acceptance. */
  readonly variable: string;
  /** What the reference reports; `undefined` when it has no such variable or does not accept the item. */
  readonly reference: Observed | undefined;
  /** What the subject reports; `undefined` when it has no such variable or does not accept the item. */
  readonly subject: Observed | undefined;
}

/** The result of comparing implementations on a list of cases or sessions. */
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

/**
 * Tells whether a difference is one of the accepted ones: it is on a listed item, whether the case is the item without
 * responses, with its correct responses or as a session of turns, on the variable or the kind of variable that the entry
 * names (an item that only one implementation accepts, when it names neither) and with the values that it names.
 */
export function isAccepted(accepted: readonly AcceptedDifference[], difference: Difference): boolean {
  return accepted.some(
    (entry) =>
      (entry.variable !== undefined
        ? entry.variable === difference.variable
        : entry.kind !== undefined
          ? entry.kind === difference.kind
          : difference.kind === "acceptance") &&
      (entry.items === undefined || entry.items.some((listed) => showsIn(listed, difference.item))) &&
      (entry.values === undefined ||
        (sameValue(entry.values.reference, difference.reference) &&
          sameValue(entry.values.subject, difference.subject))),
  );
}

/** Compares the variables of two records. */
function compareVariables(
  item: string,
  kind: Difference["kind"],
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

/** Compares the turns of the sessions of one item, each named by the item and its number from 1. */
function comparePlays(item: string, reference: Play, subject: Play): Difference[] {
  if (!(reference.accepted && subject.accepted)) {
    return reference.accepted === subject.accepted
      ? []
      : [{ item, kind: "acceptance", variable: "", reference: reference.accepted, subject: subject.accepted }];
  }
  const facts = ({ numAttempts, closed }: TurnObservation): Record<string, Observed> => ({ numAttempts, closed });
  return reference.turns.flatMap((turn, index) => {
    const name = `${item} turn ${index + 1}`;
    const other = subject.turns[index];
    if (other === undefined || turn.accepted !== other.accepted) {
      return [
        { item: name, kind: "acceptance" as const, variable: "", reference: turn.accepted, subject: other?.accepted },
      ];
    }
    return [
      ...compareVariables(name, "outcome", turn.outcomes, other.outcomes),
      ...compareVariables(name, "session", facts(turn), facts(other)),
    ];
  });
}

/** Builds a report from the results of each case: whether each implementation accepted it, and the differences. */
function report(
  results: readonly {
    readonly item: string;
    readonly reference: Run | Play;
    readonly subject: Run | Play;
    readonly differences: readonly Difference[];
  }[],
  accepted: readonly AcceptedDifference[],
): Report {
  const rejected: { item: string; reason: string }[] = [];
  const differences: Difference[] = [];
  const accepts: Difference[] = [];
  let compared = 0;
  for (const result of results) {
    const { reference, subject } = result;
    if (reference.accepted && subject.accepted) compared++;
    else if (!(reference.accepted || subject.accepted)) rejected.push({ item: result.item, reason: reference.reason });
    for (const difference of result.differences) {
      (isAccepted(accepted, difference) ? accepts : differences).push(difference);
    }
  }
  return { compared, rejected, differences, accepted: accepts };
}

/**
 * Runs both implementations on every case and compares what they report.
 *
 * @param accepted - The differences to set aside; they appear in the report as accepted.
 */
export function compare(
  cases: readonly ItemCase[],
  reference: ItemRunner,
  subject: ItemRunner,
  accepted: readonly AcceptedDifference[],
): Report {
  const results = cases.map((testCase) => {
    const referenceRun = reference.run(testCase);
    const subjectRun = subject.run(testCase);
    return {
      item: testCase.name,
      reference: referenceRun,
      subject: subjectRun,
      differences: compareRuns(testCase.name, referenceRun, subjectRun),
    };
  });
  return report(results, accepted);
}

/**
 * Plays the sessions of every case with both implementations and compares them turn by turn: whether each turn is
 * accepted, the outcome values, `numAttempts` and whether the session closed.
 *
 * @param accepted - The differences to set aside; they appear in the report as accepted.
 */
export function compareSessions(
  cases: readonly SessionCase[],
  reference: Implementation,
  subject: Implementation,
  accepted: readonly AcceptedDifference[],
): Report {
  const results = cases.map((testCase) => {
    const referencePlay = reference.play(testCase);
    const subjectPlay = subject.play(testCase);
    return {
      item: testCase.name,
      reference: referencePlay,
      subject: subjectPlay,
      differences: comparePlays(testCase.name, referencePlay, subjectPlay),
    };
  });
  return report(results, accepted);
}
