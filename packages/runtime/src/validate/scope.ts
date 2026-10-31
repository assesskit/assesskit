import type { OutcomeDeclaration, ResponseDeclaration } from "../asi/index.js";
import type { VariableType } from "../processing/index.js";
import type { StaticType } from "./static-type.js";

/** A problem with a variable that an expression names, ready to report. */
export interface Problem {
  /** The issue code. */
  readonly code: string;
  /** A full sentence that says what is wrong and what is expected. */
  readonly message: string;
}

/** What an expression's variable is: its type, which may come with warnings about naming it, or the problem with naming it. */
export type Lookup =
  | { readonly type: StaticType; readonly warnings?: readonly Problem[] }
  | { readonly problem: Problem };

/** What a response variable is: its declaration when the check can see it, or the problem with naming it. */
export type ResponseLookup = { readonly declaration?: ResponseDeclaration } | { readonly problem: Problem };

/** The processing that an expression belongs to. */
export type Processing = "response" | "template" | "outcome";

/**
 * What an expression reads, for the static checks: the variables in reach, as an item or a test has them. Looking a
 * variable up reports nothing; the caller reports the problem it gets.
 */
export interface ExpressionScope {
  /** The processing the expression belongs to; the expressions of a test, such as a pre-condition, are `outcome`. */
  readonly processing: Processing;
  /** Looks up the variable that `qti-variable` names, with the weight that `weightIdentifier` names when it is given. */
  variable(identifier: string, weightIdentifier: string | undefined): Lookup;
  /** Looks up the variable that `qti-default` names: any declared variable, whether or not it is in reach. */
  declared(identifier: string): Lookup;
  /** Looks up the response variable that `qti-correct`, `qti-map-response` or `qti-map-response-point` names. */
  response(identifier: string): ResponseLookup;
  /** Returns the problem with a weight that an expression over item sessions names, `undefined` when it is defined (INFO §7.47.2). */
  weight(weightIdentifier: string): Problem | undefined;
  /** Returns the type of the template or outcome variable in reach that an attribute names, `undefined` when there is none. */
  reference(identifier: string): StaticType | undefined;
}

/** The kinds of item variables (INFO §2.2.2). */
export type VariableKind = "context" | "response" | "outcome" | "template";

/** A variable that a rule sets. */
export interface Target {
  /** Whether it is a context, response, outcome or template variable. */
  readonly kind: VariableKind;
  /** Its cardinality and base type. */
  readonly type: VariableType;
  /** Its declaration, when it is an outcome that the check can see: the lookup table is there. */
  readonly outcome?: OutcomeDeclaration;
}

/** What the rules of a processing set, for the static checks. */
export interface RuleScope extends ExpressionScope {
  /** Names the owner in messages. */
  readonly owner: "item" | "test";
  /** Returns the variable that a rule sets, `undefined` when the owner declares none with the identifier. */
  target(identifier: string): Target | undefined;
}
