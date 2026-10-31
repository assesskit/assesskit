import type { Value } from "../values/index.js";

/**
 * The variables that content reads: the outcomes, which feedback and printed variables name, and the template
 * variables, which template content, hidden choices and printed variables name. The `ItemVariables` of `processing` fit.
 * For the content of a test, the outcomes are the test's and there are no template variables.
 */
export interface ContentVariables {
  /** The outcomes by identifier, NULL as `null`. */
  readonly outcomes: ReadonlyMap<string, Value | null>;
  /** The template variables by identifier, NULL as `null`. */
  readonly templates: ReadonlyMap<string, Value | null>;
}
