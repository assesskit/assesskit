import type { AssessmentItem, TemplateRule } from "../asi/index.js";
import { describe } from "../checks.js";
import { ProcessingError } from "../errors.js";
import { chosenRules, holds } from "./conditions.js";
import { checkContext, type ProcessingContext } from "./context.js";
import { evaluateIn } from "./evaluate.js";
import { ItemScope } from "./item-scope.js";
import { checkItem, checkVariables, type ItemVariables } from "./variables.js";

/**
 * The most times template processing runs to meet its constraints: the 100 iterations that the specification assumes.
 * After the last, the template variables keep their default values and processing goes on.
 */
const MAX_TEMPLATE_RUNS = 100;

/** Whether template processing goes on after a rule, ends, or starts again from the first rule. */
type Flow = "continue" | "exit" | "restart";

/** A run of template processing: its scope, and whether it is the last that a failed constraint may restart. */
interface Run {
  readonly scope: ItemScope;
  readonly start: ItemVariables;
  readonly last: boolean;
}

function runRule(rule: TemplateRule, run: Run): Flow {
  const { scope } = run;
  switch (rule.kind) {
    case "set-template-value":
      scope.setTemplate(rule.identifier, evaluateIn(rule.expression, scope));
      return "continue";
    case "set-correct-response":
      scope.setCorrectResponse(rule.identifier, evaluateIn(rule.expression, scope));
      return "continue";
    case "set-default-value":
      scope.setDefault(rule.identifier, evaluateIn(rule.expression, scope));
      return "continue";
    case "template-condition": {
      const branches = [rule.templateIf, ...rule.templateElseIfs];
      const rules = chosenRules(branches, rule.templateElse?.rules, scope, "qti-template-if");
      return rules === undefined ? "continue" : runRules(rules, run);
    }
    case "template-constraint":
      if (holds(rule.expression, scope, "qti-template-constraint")) return "continue";
      if (!run.last) return "restart";
      // The runs are used up: the variables keep their defaults and processing goes on.
      scope.restart(run.start);
      return "continue";
    case "exit-template":
      return "exit";
    default:
      throw new ProcessingError(
        `Template processing has the rule kind ${describe(Reflect.get(rule, "kind"))}, which QTI 3.0 does not define.`,
      );
  }
}

function runRules(rules: readonly TemplateRule[], run: Run): Flow {
  for (const rule of rules) {
    const flow = runRule(rule, run);
    if (flow !== "continue") return flow;
  }
  return "continue";
}

/**
 * Runs the template processing of an item for a new item session.
 *
 * @remarks
 * Template variables start from their default values in `variables.defaults`, so that a test's template defaults apply
 * when the caller puts them there. The rules run in order: `qti-set-template-value`, `qti-set-correct-response` and
 * `qti-set-default-value` set what they name, a condition runs its first true branch, and `qti-exit-template` ends
 * processing. A `qti-template-constraint` whose expression is false or NULL starts processing again from the defaults
 * (the template variables, and the correct responses, defaults and outcomes as they were given), at most 100 times in
 * all; when the last run fails it, the template variables keep their default values and processing goes on after it. An
 * outcome whose default value is set takes it as its value. Template rules read only template and context variables.
 * Draws come from `context.random`, so a seeded source reproduces the instance.
 *
 * @param item - The item, as `readAsi` reads it.
 * @param variables - The variables of the session, as `createItemVariables` returns them.
 * @param context - The source of random draws, the custom operators and the limits.
 * @returns The variables after template processing; the variables given are not changed.
 * @throws `DataError` when an argument has the wrong type.
 * @throws `ProcessingError` when a rule reads a response or outcome variable or one that is not declared, sets a
 * variable of another kind or with a value of another type, or an expression fails.
 * @throws `SecurityError` when a container would exceed `maxContainerSize`.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-set-template-value}
 */
export function runTemplateProcessing(
  item: AssessmentItem,
  variables: ItemVariables,
  context: ProcessingContext,
): ItemVariables {
  checkItem(item);
  checkVariables(variables);
  const environment = checkContext(context);
  const processing = item.templateProcessing;
  const scope = new ItemScope(item, variables, environment, "template-processing");
  scope.restart(variables);
  if (processing === undefined) return scope.variables();
  for (let runs = 1; runs <= MAX_TEMPLATE_RUNS; runs++) {
    const flow = runRules(processing.rules, { scope, start: variables, last: runs === MAX_TEMPLATE_RUNS });
    if (flow !== "restart") break;
    scope.restart(variables);
  }
  return scope.variables();
}
