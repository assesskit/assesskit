import type { AssessmentItem, Expression, TemplateRule } from "../asi/index.js";
import { operandsOf } from "../processing/index.js";
import type { Findings } from "./findings.js";

/** Adds the identifiers of the variables an expression reads to a set. */
function readVariables(expression: Expression, into: Set<string>): void {
  if (expression.kind === "variable") into.add(expression.identifier);
  for (const operand of operandsOf(expression)) readVariables(operand, into);
}

/** Adds the identifiers of the variables that the constraints among the rules read to a set. */
function constraintVariables(rules: readonly TemplateRule[], into: Set<string>): void {
  for (const rule of rules) {
    if (rule.kind === "template-constraint") readVariables(rule.expression, into);
    if (rule.kind !== "template-condition") continue;
    for (const branch of [rule.templateIf, ...rule.templateElseIfs]) constraintVariables(branch.rules, into);
    constraintVariables(rule.templateElse?.rules ?? [], into);
  }
}

/**
 * Warns about a template variable that a `qti-template-constraint` reads and that has no default value: when the
 * constraint is not met after the last run, the variables take their default values, which for these are
 * NULL.
 *
 * @param item - The item.
 * @param findings - The findings of the document, which receive the issues.
 */
export function checkConstraintDefaults(item: AssessmentItem, findings: Findings): void {
  const read = new Set<string>();
  constraintVariables(item.templateProcessing?.rules ?? [], read);
  for (const declaration of item.templateDeclarations) {
    if (!read.has(declaration.identifier) || declaration.defaultValue !== undefined) continue;
    const message = `The template variable ${JSON.stringify(declaration.identifier)} is read by a qti-template-constraint but has no default value, so it is NULL when the constraint cannot be met.`;
    findings.warning(
      "assesskit/validate/constraint-without-default",
      message,
      "qti-assessment-item/qti-template-declaration",
    );
  }
}
