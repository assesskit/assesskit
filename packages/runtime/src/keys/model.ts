/**
 * An area of an image that a point may hit: a rectangle by its left, top, right and bottom edges, a circle by its center and
 * radius, a polygon by its corners, in the pixels of QTI's `coords`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-area-map-entry}
 */
export interface Area {
  /** The area's identifier, unique in the key. */
  readonly id: string;
  /** The shape of the area. */
  readonly shape: "rect" | "circle" | "poly";
  /** The coordinates of the shape, as QTI's `coords` lists them. */
  readonly coords: readonly number[];
  /**
   * The points a hit earns under the `mapping` scheme.
   *
   * @defaultValue `1`
   */
  readonly points?: number;
}

/** How far a number may lie from its key and still be right; with neither bound, it must equal the key exactly. */
export interface Tolerance {
  /**
   * The largest distance from the key's value.
   *
   * @defaultValue none
   */
  readonly absolute?: number;
  /**
   * The largest distance from the key's value, as a share of its magnitude; either bound holds when both are given.
   *
   * @defaultValue none
   */
  readonly relative?: number;
}

/** A range of numbers that are all right; a bound that is `null` is open. */
export interface Interval {
  /** The lower bound, or `null` for none. */
  readonly min: number | null;
  /** The upper bound, or `null` for none. */
  readonly max: number | null;
  /**
   * Whether the lower bound is in the interval.
   *
   * @defaultValue `true`
   */
  readonly minIncluded?: boolean;
  /**
   * Whether the upper bound is in the interval.
   *
   * @defaultValue `true`
   */
  readonly maxIncluded?: boolean;
}

/** The range of the values that a variable of an expression takes at the sample points. */
export interface VariableRange {
  /** The least value. */
  readonly min: number;
  /** The greatest value, above `min`. */
  readonly max: number;
}

/** A tier of partial credit for a number outside the key's tolerance: within its own tolerance, it earns `share`. */
export interface NumberCredit {
  /** How far from the key's value the tier reaches. */
  readonly tolerance: Tolerance;
  /** The share of the response's points that the tier earns, from 0 to 1. */
  readonly share: number;
}

/** The unit in which `countLength` counts a text. */
export type LengthUnit = "words" | "characters" | "characters-without-spaces" | "manuscript-squares";

/**
 * A tier of partial credit for a string of a `text` response that matches no answer: its edit distance, in code points after
 * normalization, to the nearest accepted text of an answer, within `tolerance`, earns `share` of that answer's points.
 */
export interface TextCredit {
  /** `absolute`: the most edits; `relative`: the most edits as a share of the accepted text's length. */
  readonly tolerance: Tolerance;
  /** The share of the answer's points that the tier earns, from 0 to 1. */
  readonly share: number;
}

/** What a length rule does to the share of a response whose length passes a bound. */
export interface LengthEffect {
  /** `below`: the length is under `share` × `min`; `above`: it is over `share` × `max`. */
  readonly when: "below" | "above";
  /**
   * The share of the bound at which the effect starts.
   *
   * @defaultValue `1`
   */
  readonly share?: number;
  /** `zero`: the share becomes 0; `deduct`: that share of the response's points is taken off, floored at 0. */
  readonly effect:
    | "zero"
    | {
        /** The share of the response's points taken off, from 0 to 1. */
        readonly deduct: number;
      };
}

/** The length of a text response, counted by `countLength` in `unit`, and what passing its bounds does. */
export interface LengthRule {
  /** The unit of the count. */
  readonly unit: LengthUnit;
  /**
   * The least length.
   *
   * @defaultValue none
   */
  readonly min?: number;
  /**
   * The most length.
   *
   * @defaultValue none
   */
  readonly max?: number;
  /**
   * What passing a bound does, in order; with none, the length is advised only.
   *
   * @defaultValue none
   */
  readonly effects?: readonly LengthEffect[];
}

/** How a response and each answer of a `text` key are normalized before they are compared, in the order of the fields. */
export interface TextNormalization {
  /**
   * The Unicode normalization form applied first.
   *
   * @defaultValue `"NFKC"`
   */
  readonly form?: "NFC" | "NFD" | "NFKC" | "NFKD";
  /**
   * Whether the Halfwidth and Fullwidth Forms block is mapped by NFKC.
   *
   * @defaultValue `true`
   */
  readonly foldWidth?: boolean;
  /**
   * Whether nonspacing marks are removed after NFD, before the text is normalized back to `form`.
   *
   * @defaultValue `false`
   */
  readonly ignoreMarks?: boolean;
  /**
   * Whether case counts; when it does not, both sides are lowered as `toLowerCase` lowers them.
   *
   * @defaultValue `false`
   */
  readonly caseSensitive?: boolean;
  /**
   * Whether each run of Unicode White_Space becomes one space, and the ends are trimmed.
   *
   * @defaultValue `true`
   */
  readonly collapseWhitespace?: boolean;
}

/** An accepted answer of a `text` key: its texts and patterns, and the points it earns. */
export interface TextAnswer {
  /** The texts that match it once normalized. */
  readonly texts: readonly string[];
  /**
   * The points that matching it earns; an answer of fewer points credits a partly right form.
   *
   * @defaultValue `1`
   */
  readonly points?: number;
  /**
   * XSD regular expressions that a normalized string matches whole, as `qti-pattern-match` reads them.
   *
   * @defaultValue none
   */
  readonly patterns?: readonly string[];
}

/** The key of a mathematical expression, an equation or a solution set, typed as LaTeX of the subset. */
export interface ExpressionKey {
  /** The kind of the key. */
  readonly kind: "expression";
  /** The key's expression; for a solution set, its values or `v = value` joined by `,` or `\lor`. */
  readonly expression: string;
  /**
   * How a response is compared: as an expression, an equation, or the list of an equation's solutions.
   *
   * @defaultValue `"expression"`
   */
  readonly form?: "expression" | "equation" | "solution-set";
  /**
   * The range of the values that each variable takes at the sample points, by its name as the reader gives it.
   *
   * @defaultValue none: each variable is drawn from -10 to 10
   */
  readonly variables?: Readonly<Record<string, VariableRange>>;
  /**
   * The decimal mark of the key and its responses.
   *
   * @defaultValue `"."`
   */
  readonly decimalSeparator?: "." | ",";
}

/** The key of a number, with its unit, form and partial credit. */
export interface NumberKey {
  /** The kind of the key. */
  readonly kind: "number";
  /** The right value, read from its shortest decimal form, so that 1.1 is 11/10. */
  readonly value: number;
  /**
   * How far a response may lie from the value.
   *
   * @defaultValue none: exact
   */
  readonly tolerance?: Tolerance;
  /**
   * The decimal mark of a response.
   *
   * @defaultValue `"."`
   */
  readonly decimalSeparator?: "." | ",";
  /**
   * The units a response may write after its number, by name, each with the factor that converts it to the key's unit.
   *
   * @defaultValue none: a unit after the number is not named, and the response is wrong
   */
  readonly units?: Readonly<Record<string, number>>;
  /**
   * Whether a response may write `a/b` and a mixed `a b/c`.
   *
   * @defaultValue `false`
   */
  readonly fractions?: boolean;
  /**
   * The significant digits a response shows, against the value rounded to as many.
   *
   * @defaultValue none
   */
  readonly significantFigures?: number;
  /**
   * The tiers of partial credit for a response outside the tolerance, each with its own tolerance and share.
   *
   * @defaultValue none
   */
  readonly credit?: readonly NumberCredit[];
  /**
   * The ranges inside which every response is right; with them, the value is not read.
   *
   * @defaultValue none
   */
  readonly intervals?: readonly Interval[];
  /**
   * The values of an ordered response, one for each of its strings, such as the coordinates of a point.
   *
   * @defaultValue none
   */
  readonly components?: readonly number[];
}

/** The key of a text response: accepted answers, how many a response gives, and how it is normalized and credited. */
export interface TextKey {
  /** The kind of the key. */
  readonly kind: "text";
  /** The accepted answers. */
  readonly answers: readonly TextAnswer[];
  /**
   * How many answers a response gives.
   *
   * @defaultValue `1`
   */
  readonly count?: number;
  /**
   * `forms`: each string of the response is one form of a whole answer; `words`: the response's words match answers.
   *
   * @defaultValue `"forms"`
   */
  readonly scheme?: "forms" | "words";
  /**
   * How the response and the answers are normalized.
   *
   * @defaultValue each field's own default
   */
  readonly normalization?: TextNormalization;
  /**
   * Whether a string that reads as a number matches an answer's text that reads as the same number, in any notation:
   * `.5`, `0.50`, `5e-1` and `1/2` are one value.
   *
   * @defaultValue `false`
   */
  readonly numericEquivalence?: boolean;
  /**
   * The tiers of partial credit, by edit distance, for a string that matches no answer.
   *
   * @defaultValue none: a string matches an answer or earns 0
   */
  readonly credit?: readonly TextCredit[];
  /**
   * The length rule of the response.
   *
   * @defaultValue none
   */
  readonly length?: LengthRule;
}

/** The key of points on an image: areas, of which a response hits up to `select`, each point counting for one area. */
export interface AreasKey {
  /** The kind of the key. */
  readonly kind: "areas";
  /** The areas. */
  readonly areas: readonly Area[];
  /** `keyed`: areas matched over `select`, which `hotspot-matching` scores; `mapping`: QTI's `area-mapping`. */
  readonly scheme: "mapping" | "keyed";
  /**
   * How many areas a response selects.
   *
   * @defaultValue the count of areas
   */
  readonly select?: number;
}

/** An `areas` key of the scheme `keyed`, which `hotspot-matching` scores. */
export interface KeyedAreasKey extends AreasKey {
  /** The scheme, `keyed`. */
  readonly scheme: "keyed";
}

/** The key of a choice among options: the options that are right, and how a selection scores against them. */
export interface ChoiceKey {
  /** The kind of the key. */
  readonly kind: "choice";
  /** The identifiers of the options that are right. */
  readonly keys: readonly string[];
  /**
   * `all-or-nothing`: 1 when the selection equals the keys; `partial`: a point for each key selected less one for each other
   * option selected, floored at 0; `per-key`: a point for each key selected, another option costing nothing.
   *
   * @defaultValue `"all-or-nothing"`
   */
  readonly scheme?: "all-or-nothing" | "partial" | "per-key";
  /**
   * The most options a response selects.
   *
   * @defaultValue the count of keys
   */
  readonly maxChoices?: number;
}

/** The key of a choice whose options earn points of their own, summed as QTI's `qti-map-response` sums them. */
export interface ChoiceMappingKey {
  /** The kind of the key. */
  readonly kind: "choice-mapping";
  /** The points of each option, by its identifier; an option it does not name earns 0. */
  readonly points: Readonly<Record<string, number>>;
  /**
   * The most options a response selects.
   *
   * @defaultValue `1`, as QTI's `max-choices`
   */
  readonly maxChoices?: number;
}

/** The key of a choice marked per option: points for each key selected, for each other option selected, and for none. */
export interface ChoiceMarkingKey {
  /** The kind of the key. */
  readonly kind: "choice-marking";
  /** The identifiers of the options that are right. */
  readonly keys: readonly string[];
  /** The points for each key selected, above 0. */
  readonly correct: number;
  /** The points for each other option selected, below 0 for a negative mark. */
  readonly wrong: number;
  /**
   * The points when nothing is selected, at most what the right selection earns.
   *
   * @defaultValue `0`
   */
  readonly blank?: number;
  /**
   * The most options a response selects.
   *
   * @defaultValue the count of keys
   */
  readonly maxChoices?: number;
}

/** The key of pairs that a response makes: a match, an association or a gap match. */
export interface PairsKey {
  /** The kind of the key. */
  readonly kind: "pairs";
  /** The pairs that are right, by the identifiers of their choices: source first, then target. */
  readonly pairs: readonly (readonly [string, string])[];
  /**
   * Whether a pair has a source and a target, QTI's `directedPair`, or is unordered, QTI's `pair`.
   *
   * @defaultValue `true`
   */
  readonly directed?: boolean;
  /**
   * `all-or-nothing`: 1 when the pairs made equal the key's; `per-pair`: a point for each key pair made; `mapping`: the
   * `points` of each key pair made.
   *
   * @defaultValue `"all-or-nothing"`
   */
  readonly scheme?: "all-or-nothing" | "per-pair" | "mapping";
  /**
   * The points of each pair under `mapping`, in the order of `pairs`.
   *
   * @defaultValue none: required by `mapping`, refused otherwise
   */
  readonly points?: readonly number[];
  /**
   * The most pairs a response makes.
   *
   * @defaultValue the count of pairs
   */
  readonly maxPairs?: number;
  /**
   * The most pairs that one source takes.
   *
   * @defaultValue none: unlimited
   */
  readonly maxPerSource?: number;
  /**
   * The most pairs that one target takes.
   *
   * @defaultValue `1`, or none with `reuse`
   */
  readonly maxPerTarget?: number;
  /**
   * Whether a target may be taken by more than one source.
   *
   * @defaultValue `false`
   */
  readonly reuse?: boolean;
  /**
   * The points lost for each pair a response makes past the count of the key's pairs.
   *
   * @defaultValue `0`
   */
  readonly surplus?: number;
  /**
   * The identifier of the target that answers "none", which any number of sources may take.
   *
   * @defaultValue none
   */
  readonly none?: string;
}

/** The key of an order of choices. */
export interface OrderKey {
  /** The kind of the key. */
  readonly kind: "order";
  /** The identifiers of the choices, in the right order. */
  readonly order: readonly string[];
  /**
   * `all-or-nothing`: 1 when the order equals the key's; `per-position`: a point for each position right; `adjacent-pairs`:
   * a point for each pair of the key's neighbors that stands next to each other, in that order.
   *
   * @defaultValue `"all-or-nothing"`
   */
  readonly scheme?: "all-or-nothing" | "per-position" | "adjacent-pairs";
}

/** The key of one response: a choice, pairs, an order, areas, a text, a number or an expression. */
export type Key =
  | ChoiceKey
  | ChoiceMappingKey
  | ChoiceMarkingKey
  | PairsKey
  | OrderKey
  | AreasKey
  | TextKey
  | NumberKey
  | ExpressionKey;

/** Credit for an answer that follows from an earlier response: the key's operator scores it against both. */
export interface FollowThrough {
  /** The identifier of the earlier response, the operator's second operand. */
  readonly from: string;
  /** An expression of the subset in `variable`, whose value with the earlier response in its place also earns the credit. */
  readonly expression: string;
  /**
   * The variable of `expression` that the earlier response replaces.
   *
   * @defaultValue `"r"`
   */
  readonly variable?: string;
}

/** A response of an item, its key, and the points it earns. */
export interface ScoredResponse {
  /** The identifier of the response, a QTI identifier. */
  readonly identifier: string;
  /** The key that scores it. */
  readonly key: Key;
  /**
   * The points of the response: the key's share of its own maximum, scaled to them.
   *
   * @defaultValue the key's own maximum
   */
  readonly maxPoints?: number;
  /**
   * The factor of the response's points in the item's score.
   *
   * @defaultValue `1`
   */
  readonly weight?: number;
  /**
   * Credit for an answer that follows from an earlier response, on a `number` or `expression` key.
   *
   * @defaultValue none
   */
  readonly followThrough?: FollowThrough;
}
