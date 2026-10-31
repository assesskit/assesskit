import type { Expression, OutcomeRule, ResponseRule, TemplateRule } from "../asi/index.js";
import { COMPLETION_STATUS, COMPLETION_STATUSES } from "../processing/index.js";
import type { ExpressionChecker } from "./expressions.js";
import type { Findings } from "./findings.js";
import type { RuleScope, VariableKind } from "./scope.js";
import { describeStatic, fitsVariable, type StaticType, typeOfVariable } from "./static-type.js";

type Rule = ResponseRule | OutcomeRule;

/** A branch of a condition: its expression and the rules to run when it is true. */
interface Branch<TRule> {
  readonly kind: string;
  readonly condition: Expression;
  readonly rules: readonly TRule[];
}

/** The base types a lookup table takes as its source: a match table needs integers (INFO §5.87.2). */
const MATCH_SOURCE = ["integer"];
const INTERPOLATION_SOURCE = ["integer", "float", "duration"];

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a";
}

/**
 * Checks the rules of response, outcome and template processing without running them: the variable each rule sets, the
 * type of the value it gives against the variable's (INFO §5.130.2, D5), the lookup tables, and that each condition is a
 * single boolean. The expressions go to the `ExpressionChecker`.
 */
export class RuleChecker {
  private readonly findings: Findings;
  private readonly scope: RuleScope;
  private readonly expressions: ExpressionChecker;

  constructor(findings: Findings, scope: RuleScope, expressions: ExpressionChecker) {
    this.findings = findings;
    this.scope = scope;
    this.expressions = expressions;
  }

  /** Checks the rules of response processing or outcome processing; the rules of an `xi:include` are left out. */
  outcomeRules(rules: readonly Rule[], trail: string): void {
    for (const rule of rules) {
      if (rule.kind === "element") continue;
      const here = `${trail}/qti-${rule.kind}`;
      switch (rule.kind) {
        case "response-condition":
          this.branches(
            [rule.responseIf, ...rule.responseElseIfs],
            rule.responseElse?.rules,
            "response-else",
            here,
            (rules, at) => this.outcomeRules(rules, at),
          );
          break;
        case "outcome-condition":
          this.branches(
            [rule.outcomeIf, ...rule.outcomeElseIfs],
            rule.outcomeElse?.rules,
            "outcome-else",
            here,
            (rules, at) => this.outcomeRules(rules, at),
          );
          break;
        case "response-processing-fragment":
        case "outcome-processing-fragment":
          this.outcomeRules(rule.rules, here);
          break;
        case "set-outcome-value":
          this.setOutcome(rule.identifier, rule.expression, here);
          break;
        case "lookup-outcome-value":
          this.lookupOutcome(rule.identifier, rule.expression, here);
          break;
        default:
          break;
      }
    }
  }

  /**
   * Checks the rules of template processing.
   *
   * @param nested - Whether the rules are inside a condition, where `qti-template-constraint` may not be (INFO §5.150).
   */
  templateRules(rules: readonly TemplateRule[], trail: string, nested = false): void {
    for (const rule of rules) {
      const here = `${trail}/qti-${rule.kind}`;
      switch (rule.kind) {
        case "set-template-value":
          this.assign(rule.identifier, ["template"], "qti-set-template-value", rule.expression, here);
          break;
        case "set-correct-response":
          this.assign(rule.identifier, ["response"], "qti-set-correct-response", rule.expression, here);
          break;
        case "set-default-value":
          this.assign(rule.identifier, ["response", "outcome"], "qti-set-default-value", rule.expression, here);
          break;
        case "template-condition":
          this.branches(
            [rule.templateIf, ...rule.templateElseIfs],
            rule.templateElse?.rules,
            "template-else",
            here,
            (rules, at) => this.templateRules(rules, at, true),
          );
          break;
        case "template-constraint":
          if (nested) {
            const message =
              "A qti-template-constraint may occur only as a child of qti-template-processing, not inside a condition.";
            this.findings.error("assesskit/validate/template-constraint", message, here);
          }
          this.condition(rule.expression, "qti-template-constraint", here);
          break;
        default:
          break;
      }
    }
  }

  /** Checks an expression and returns its type, for a caller that sets a variable itself. */
  expressionType(expression: Expression, trail: string): StaticType {
    return this.expressions.check(expression, trail);
  }

  /** Checks that the expression of a condition is a single boolean, as the interpreter demands (B47). */
  condition(expression: Expression, element: string, trail: string): void {
    const type = this.expressions.check(expression, trail);
    const booleanFits = type.baseType === undefined || type.baseType === "boolean";
    if (!(booleanFits && (type.cardinality === undefined || type.cardinality === "single"))) {
      const message = `The expression of ${element} must be a single boolean, found ${describeStatic(type)}.`;
      this.findings.error("assesskit/validate/condition-type", message, trail);
    }
  }

  private branches<TRule>(
    branches: readonly Branch<TRule>[],
    otherwise: readonly TRule[] | undefined,
    elseKind: string,
    here: string,
    check: (rules: readonly TRule[], trail: string) => void,
  ): void {
    for (const branch of branches) {
      const at = `${here}/qti-${branch.kind}`;
      this.condition(branch.condition, `qti-${branch.kind}`, at);
      check(branch.rules, at);
    }
    if (otherwise !== undefined) check(otherwise, `${here}/qti-${elseKind}`);
  }

  private setOutcome(identifier: string, expression: Expression, here: string): void {
    this.assign(identifier, ["outcome"], "qti-set-outcome-value", expression, here);
    if (this.scope.owner === "test" && this.scope.target(identifier)?.outcome?.externalScored !== undefined) {
      const message = `The rule qti-set-outcome-value sets ${JSON.stringify(identifier)}, which is scored externally; the supplied score is its starting value for every run of outcome processing, and the rule replaces it (G24).`;
      this.findings.warning("assesskit/validate/external-score-assigned", message, here);
    }
    if (identifier === COMPLETION_STATUS && expression.kind === "base-value" && expression.baseType === "identifier") {
      const value = expression.value.trim();
      if (!COMPLETION_STATUSES.includes(value)) {
        const message = `The outcome completionStatus cannot be ${JSON.stringify(value)}; it is one of ${COMPLETION_STATUSES.join(", ")}.`;
        this.findings.error("assesskit/validate/completion-status", message, here);
      }
    }
  }

  /** Checks a rule that sets a variable: the variable exists, is of a kind the rule sets, and fits the value. */
  private assign(
    identifier: string,
    kinds: readonly VariableKind[],
    rule: string,
    expression: Expression,
    here: string,
  ): void {
    const value = this.expressions.check(expression, here);
    const target = this.scope.target(identifier);
    const owner = this.scope.owner;
    if (target === undefined) {
      const message = `The rule ${rule} sets ${JSON.stringify(identifier)}, which the ${owner} does not declare. Declare it as ${article(kinds[0] ?? "")} ${kinds.join(" or ")} variable.`;
      this.findings.error("assesskit/validate/undeclared-variable", message, here);
    } else if (!kinds.includes(target.kind)) {
      const message = `The rule ${rule} sets ${JSON.stringify(identifier)}, which is not ${article(kinds[0] ?? "")} ${kinds.join(" or ")} variable of the ${owner}.`;
      this.findings.error("assesskit/validate/assignment-target", message, here);
    } else if (!fitsVariable(value, target.type)) {
      const message = `The variable ${JSON.stringify(identifier)} is ${describeStatic(typeOfVariable(target.type))} and cannot be set to ${describeStatic(value)}.`;
      this.findings.error("assesskit/validate/assignment-type", message, here);
    }
  }

  private lookupOutcome(identifier: string, expression: Expression, here: string): void {
    const source = this.expressions.check(expression, here);
    const target = this.scope.target(identifier);
    if (target === undefined || target.kind !== "outcome") {
      this.assign(identifier, ["outcome"], "qti-lookup-outcome-value", expression, here);
      return;
    }
    const table = target.outcome?.lookupTable;
    if (target.outcome !== undefined && (table === undefined || target.type.cardinality !== "single")) {
      const message = `The rule qti-lookup-outcome-value sets ${JSON.stringify(identifier)}, which is not a single outcome with a lookup table.`;
      this.findings.error("assesskit/validate/lookup-table", message, here);
      return;
    }
    const accepted = table?.kind === "match-table" ? MATCH_SOURCE : INTERPOLATION_SOURCE;
    const cardinalityFits = source.cardinality === undefined || source.cardinality === "single";
    const baseTypeFits = source.baseType === undefined || accepted.includes(source.baseType);
    if (!(cardinalityFits && baseTypeFits)) {
      const message = `The rule qti-lookup-outcome-value for ${JSON.stringify(identifier)} needs a single ${accepted.join(", ")}, found ${describeStatic(source)}.`;
      this.findings.error("assesskit/validate/lookup-source", message, here);
    }
  }
}
