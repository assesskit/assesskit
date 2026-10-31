import type { OutcomeDeclaration, OutcomeRule, ResponseRule } from "../asi/index.js";
import { describe } from "../checks.js";
import { ProcessingError } from "../errors.js";
import type { Value } from "../values/index.js";
import { chosenRules } from "./conditions.js";
import { evaluateIn } from "./evaluate.js";
import { lookUp } from "./lookup.js";
import type { Scope } from "./scope.js";

/** What the rules of response and outcome processing read and set. */
export interface OutcomeTarget extends Scope {
  /**
   * Returns the declaration of an outcome, for its lookup table.
   *
   * @throws `ProcessingError` when there is no such outcome.
   */
  outcomeDeclaration(identifier: string): OutcomeDeclaration;
  /**
   * Sets an outcome.
   *
   * @throws `ProcessingError` when there is no such outcome or the value does not fit it.
   */
  setOutcome(identifier: string, value: Value | null, rule: string): void;
}

/** Whether processing goes on after a rule, or a `qti-exit-response` or `qti-exit-test` ended it (INFO §6.39.5, §6.32.5). */
type Flow = "continue" | "exit";

type Rule = ResponseRule | OutcomeRule;

function runRule(rule: Rule, target: OutcomeTarget): Flow {
  switch (rule.kind) {
    case "response-condition": {
      const rules = chosenRules(
        [rule.responseIf, ...rule.responseElseIfs],
        rule.responseElse?.rules,
        target,
        "qti-response-if",
      );
      return rules === undefined ? "continue" : runOutcomeRules(rules, target);
    }
    case "outcome-condition": {
      const rules = chosenRules(
        [rule.outcomeIf, ...rule.outcomeElseIfs],
        rule.outcomeElse?.rules,
        target,
        "qti-outcome-if",
      );
      return rules === undefined ? "continue" : runOutcomeRules(rules, target);
    }
    case "response-processing-fragment":
    case "outcome-processing-fragment":
      return runOutcomeRules(rule.rules, target);
    case "set-outcome-value":
      target.setOutcome(rule.identifier, evaluateIn(rule.expression, target), "qti-set-outcome-value");
      return "continue";
    case "lookup-outcome-value": {
      const declaration = target.outcomeDeclaration(rule.identifier);
      target.setOutcome(
        rule.identifier,
        lookUp(declaration, evaluateIn(rule.expression, target)),
        "qti-lookup-outcome-value",
      );
      return "continue";
    }
    case "exit-response":
    case "exit-test":
      return "exit";
    case "element":
      throw new ProcessingError(
        `The processing has an unresolved ${rule.prefix === undefined ? "" : `${rule.prefix}:`}${rule.name}; resolve includes before processing.`,
      );
    default:
      throw new ProcessingError(
        `The processing has the rule kind ${describe(Reflect.get(rule, "kind"))}, which QTI 3.0 does not define.`,
      );
  }
}

/**
 * Runs the rules of response or outcome processing in order, each seeing the outcomes the earlier ones set (INFO
 * §6.32, §6.39). A condition runs the rules of its first true branch; a fragment runs its rules; an exit rule ends the
 * processing.
 *
 * @returns `exit` when an exit rule ended the processing.
 * @throws `ProcessingError` when a rule fails.
 */
export function runOutcomeRules(rules: readonly Rule[], target: OutcomeTarget): Flow {
  for (const rule of rules) if (runRule(rule, target) === "exit") return "exit";
  return "continue";
}
