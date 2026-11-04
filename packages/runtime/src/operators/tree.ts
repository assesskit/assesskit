/** The functions of the subset, by the name the reader gives them; `log` is base 10 and `lb` base 2. */
export type FunctionName =
  | "sin"
  | "cos"
  | "tan"
  | "sec"
  | "csc"
  | "cot"
  | "arcsin"
  | "arccos"
  | "arctan"
  | "sinh"
  | "cosh"
  | "tanh"
  | "exp"
  | "ln"
  | "log"
  | "lb"
  | "sqrt"
  | "abs";

/** A term of a sum, with its sign; a `±` sign has its index among the signs of the entry, which a solution set expands. */
export interface Term {
  readonly sign: 1 | -1 | "plus-minus";
  readonly index: number;
  readonly node: Node;
}

/** A factor of a product, which divides when `inverse` is set. */
export interface Factor {
  readonly inverse: boolean;
  readonly node: Node;
}

/**
 * A node of an expression's tree. Sums and products hold their terms and factors as lists, and runs of signs, degrees and
 * percents are counted, so the tree is no deeper than the nesting of the text, which the reader bounds.
 */
export type Node =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "variable"; readonly name: string }
  | { readonly kind: "constant"; readonly name: "pi" | "e" }
  | { readonly kind: "sum"; readonly terms: readonly Term[] }
  | { readonly kind: "product"; readonly factors: readonly Factor[] }
  | { readonly kind: "negate"; readonly node: Node }
  | { readonly kind: "power"; readonly base: Node; readonly exponent: Node }
  | { readonly kind: "call"; readonly name: FunctionName; readonly argument: Node }
  | { readonly kind: "logarithm"; readonly base: Node; readonly argument: Node }
  | { readonly kind: "scale"; readonly node: Node; readonly degrees: number; readonly percents: number };

/** A relation between two sides. */
export type Relation = "=" | "<" | ">" | "<=" | ">=" | "!=";

/** One entry of a line: an expression, or two sides and their relation. */
export type Entry =
  | { readonly kind: "expression"; readonly node: Node; readonly signs: number }
  | {
      readonly kind: "relation";
      readonly relation: Relation;
      readonly left: Node;
      readonly right: Node;
      readonly signs: number;
    };

/**
 * What a line reads as: one entry, or a list of entries (joined by commas, `\lor` or set braces), which only a solution
 * set takes. `signs` counts the `±` signs of an entry.
 */
export type Statement =
  | { readonly kind: "entry"; readonly entry: Entry }
  | { readonly kind: "list"; readonly entries: readonly Entry[] };
