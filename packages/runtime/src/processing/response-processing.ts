import type { AssessmentItem, ResponseProcessing, ResponseRule } from "../asi/index.js";
import { checkRecord, describe } from "../checks.js";
import { DataError, ProcessingError } from "../errors.js";
import { checkContext, type Environment, type ProcessingContext } from "./context.js";
import { ItemScope } from "./item-scope.js";
import { runOutcomeRules } from "./outcome-rules.js";
import { STANDARD_TEMPLATES, standardTemplateUri } from "./standard-templates.js";
import { checkItem, checkVariables, type ItemVariables } from "./variables.js";

/**
 * Returns the rules of an item's response processing (INFO §4.6, §2.5.1): its own rules when it has any, which win over
 * a template; else those of the standard template its `template` names; else those the resolver returns for its
 * `template-location`, or its `template` when it has no location. An empty `template` names none.
 *
 * @throws `ProcessingError` when a template URI is neither standard nor resolved (G17).
 * @throws `DataError` when the resolver returns something that is not response processing.
 */
function responseRules(processing: ResponseProcessing | undefined, environment: Environment): readonly ResponseRule[] {
  if (processing === undefined || processing.rules.length > 0) return processing?.rules ?? [];
  const template = processing.template === "" ? undefined : processing.template;
  const standard = template === undefined ? undefined : STANDARD_TEMPLATES.get(standardTemplateUri(template) ?? "");
  if (standard !== undefined) return standard.rules;
  const location = processing.templateLocation ?? template;
  if (location === undefined) return [];
  const resolved = environment.resolveTemplate?.(location);
  if (resolved === undefined) {
    throw new ProcessingError(
      `The response processing template ${JSON.stringify(location)} is not a standard template and the option resolveTemplate does not resolve it.`,
      location,
    );
  }
  checkRecord(resolved, "The option resolveTemplate must return response processing or undefined");
  if (resolved.kind !== "response-processing" || !Array.isArray(resolved.rules)) {
    throw new DataError(
      `The option resolveTemplate must return the model of qti-response-processing, found ${describe(resolved)}.`,
    );
  }
  return resolved.rules;
}

/**
 * Runs the response processing of an item (INFO §2.5, §6.39): its rules, or those of the template it names (B45), in
 * order from the outcomes as given, so that the delivery engine decides whether they were reset to their defaults first
 * (INFO §2.5: reset for non-adaptive items, kept for adaptive ones). `qti-set-outcome-value` and
 * `qti-lookup-outcome-value` set outcomes, `completionStatus` included, a condition runs its first true branch, a
 * fragment its rules, and `qti-exit-response` ends processing. Responses are read as given: the last submitted values.
 *
 * @param item - The item, as `readAsi` reads it, with its includes resolved.
 * @param variables - The variables of the session.
 * @param context - The source of random draws, the custom operators, the resolver of templates and the limits.
 * @returns The variables after response processing; the variables given are not changed.
 * @throws `DataError` when an argument has the wrong type.
 * @throws `ProcessingError` when a template cannot be resolved (G17), an include is left, a rule sets something other
 * than an outcome or with a value of another type, or an expression fails.
 * @throws `SecurityError` when a container would exceed `maxContainerSize`.
 */
export function runResponseProcessing(
  item: AssessmentItem,
  variables: ItemVariables,
  context: ProcessingContext,
): ItemVariables {
  checkItem(item);
  checkVariables(variables);
  const environment = checkContext(context);
  const rules = responseRules(item.responseProcessing, environment);
  const scope = new ItemScope(item, variables, environment, "item");
  runOutcomeRules(rules, scope);
  return scope.variables();
}
