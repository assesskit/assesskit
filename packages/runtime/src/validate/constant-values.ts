import type { Expression, OutcomeRule, ResponseRule, TemplateRule } from "../asi/index.js";

type Rule = ResponseRule | OutcomeRule | TemplateRule;

/** Returns the identifiers an expression gives when it is a constant: `base-value`, `null`, or a container of them. */
function constantsOf(expression: Expression): readonly string[] | undefined {
  switch (expression.kind) {
    case "base-value":
      return [expression.value];
    case "null":
      return [];
    case "multiple":
    case "ordered": {
      const parts = expression.operands.map(constantsOf);
      return parts.every((part) => part !== undefined) ? parts.flat() : undefined;
    }
    default:
      return undefined;
  }
}

/** Returns the lists of rules inside a rule: those of the branches of a condition, and of a fragment. */
function nestedRules(rule: Exclude<Rule, { kind: "element" }>): readonly (readonly Rule[])[] {
  switch (rule.kind) {
    case "response-condition":
      return [...[rule.responseIf, ...rule.responseElseIfs].map(({ rules }) => rules), rule.responseElse?.rules ?? []];
    case "outcome-condition":
      return [...[rule.outcomeIf, ...rule.outcomeElseIfs].map(({ rules }) => rules), rule.outcomeElse?.rules ?? []];
    case "template-condition":
      return [...[rule.templateIf, ...rule.templateElseIfs].map(({ rules }) => rules), rule.templateElse?.rules ?? []];
    case "response-processing-fragment":
    case "outcome-processing-fragment":
      return [rule.rules];
    default:
      return [];
  }
}

/** Calls `visit` for each rule in a list and in the conditions and fragments below it, in order. */
function eachRule(rules: readonly Rule[], visit: (rule: Exclude<Rule, { kind: "element" }>) => void): void {
  for (const rule of rules) {
    if (rule.kind === "element") continue;
    visit(rule);
    for (const nested of nestedRules(rule)) eachRule(nested, visit);
  }
}

/** What a rule contributes to the values of the variable it sets: constants, or `undefined` when it gives none. */
interface Contribution {
  readonly variable: string;
  readonly values: readonly string[] | undefined;
}

function contributionOf(
  rule: Exclude<Rule, { kind: "element" }>,
  lookup: (identifier: string) => readonly string[] | undefined,
): Contribution | undefined {
  switch (rule.kind) {
    case "set-outcome-value":
    case "set-template-value":
    case "set-default-value":
      return { variable: rule.identifier, values: constantsOf(rule.expression) };
    case "lookup-outcome-value":
      return { variable: rule.identifier, values: lookup(rule.identifier) };
    case "set-correct-response":
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Finds the identifiers that the rules give each variable they set (INFO §5.93, L6): a set when every rule that sets the
 * variable gives constants, `undefined` when one does not. A variable that no rule sets is not in the map. The starting
 * value of a variable is not here: the caller adds the default value of its declaration.
 *
 * @param rules - The rules that run, in any order.
 * @param lookup - Returns the values a lookup table gives an outcome, `undefined` when it has none.
 */
export function assignedIdentifiers(
  rules: readonly Rule[],
  lookup: (identifier: string) => readonly string[] | undefined,
): ReadonlyMap<string, ReadonlySet<string> | undefined> {
  const assigned = new Map<string, Set<string> | undefined>();
  eachRule(rules, (rule) => {
    const contribution = contributionOf(rule, lookup);
    if (contribution === undefined) return;
    const { variable, values } = contribution;
    const taken = assigned.has(variable) ? assigned.get(variable) : new Set<string>();
    if (values === undefined || taken === undefined) {
      assigned.set(variable, undefined);
      return;
    }
    for (const value of values) taken.add(value);
    assigned.set(variable, taken);
  });
  return assigned;
}
