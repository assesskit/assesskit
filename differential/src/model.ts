/** A scalar value as both implementations report it. */
export type Scalar = string | number | boolean;

/**
 * A QTI value in the neutral form the implementations are compared in: a scalar, a list of scalars, a record of fields,
 * or `null` for NULL. Pairs and points are space-separated strings and durations seconds as numbers, as the oracle
 * reports them. Values are never modified.
 */
export type Observed = Scalar | Scalar[] | { [field: string]: Observed } | null;

/** An item with the responses to give it and the seed to draw its template values with. */
export interface ItemCase {
  /** The name of the case in reports: the file name of a corpus item, or a name the generator gives. */
  readonly name: string;
  /** The item document. */
  readonly xml: string;
  /** The responses by response identifier; none leaves every response NULL. */
  readonly responses: Readonly<Record<string, Observed>>;
  /** The seed for template processing. */
  readonly seed: number;
}

/** What an implementation reports about an item after template and response processing. */
export interface Observation {
  /** The outcome values by identifier, after response processing. */
  readonly outcomes: Readonly<Record<string, Observed>>;
  /** The template values by identifier, after template processing. */
  readonly templateValues: Readonly<Record<string, Observed>>;
}

/** The result of running an item: an observation, or why the implementation does not accept the item. */
export type Run =
  | { readonly accepted: true; readonly observation: Observation }
  | { readonly accepted: false; readonly reason: string };

/** An implementation that processes items. */
export interface Implementation {
  /** The name in reports. */
  readonly name: string;
  /** Processes the item: template processing, then the responses, then response processing. */
  run(testCase: ItemCase): Run;
}
