import type {
  AssessmentItem,
  ElementVisit,
  OutcomeDeclaration,
  OutcomeRule,
  ResponseRule,
  TemplateRule,
} from "../asi/index.js";
import { assignedIdentifiers } from "./constant-values.js";
import { type Controller, controllerOf } from "./content-references.js";
import type { Findings } from "./findings.js";
import { elementPath } from "./model-access.js";

type Rule = ResponseRule | OutcomeRule | TemplateRule;

/** Returns the values a lookup table gives, which are the identifiers an outcome with base type identifier can take. */
function tableValues(declaration: OutcomeDeclaration | undefined): readonly string[] | undefined {
  const table = declaration?.lookupTable;
  if (table === undefined) return undefined;
  const entries = table.kind === "match-table" ? table.matchTableEntries : table.interpolationTableEntries;
  return [
    ...entries.map((entry) => entry.targetValue),
    ...(table.defaultValue === undefined ? [] : [table.defaultValue]),
  ];
}

/**
 * Finds the feedback and template content that its controlling variable can never show or hide (INFO §5.93.2, L6): a
 * `show` element whose identifier the variable never takes is never shown, and a `hide` element is never hidden. It
 * knows what a variable can take only when it is declared with base type identifier and every rule that sets it gives a
 * constant; it says nothing when it cannot tell.
 */
export class UnreachableContent {
  private readonly controlled: { readonly visit: ElementVisit; readonly controller: Controller }[] = [];

  /** Takes note of one element of the content. */
  visit(visit: ElementVisit): void {
    const controller = controllerOf(visit);
    if (controller !== undefined) this.controlled.push({ visit, controller });
  }

  /**
   * Reports the elements that cannot show or hide.
   *
   * @param item - The item.
   * @param rules - The rules that set variables; absent when response processing names a template that cannot be found,
   * so that nothing is known of the outcomes it sets.
   */
  report(item: AssessmentItem, rules: readonly Rule[] | undefined, findings: Findings): void {
    const outcomes = new Map(item.outcomeDeclarations.map((declaration) => [declaration.identifier, declaration]));
    const templates = new Map(item.templateDeclarations.map((declaration) => [declaration.identifier, declaration]));
    const assigned = assignedIdentifiers(rules ?? [], (identifier) => tableValues(outcomes.get(identifier)));
    for (const { visit, controller } of this.controlled) {
      const outcome = controller.kind === "outcome" ? outcomes.get(controller.variable) : undefined;
      const declaration = controller.kind === "outcome" ? outcome : templates.get(controller.variable);
      // An externally scored outcome is given its value by someone else, and a missing template leaves the outcomes unknown.
      const unknown = outcome?.externalScored !== undefined || (controller.kind === "outcome" && rules === undefined);
      if (declaration?.baseType !== "identifier" || unknown) continue;
      const defaults = declaration.defaultValue?.values.map((value) => value.value) ?? [];
      const possible = this.possible(defaults, assigned, controller.variable);
      if (possible !== undefined && !possible.has(controller.identifier)) {
        this.warn(visit, controller, possible, findings);
      }
    }
  }

  private warn(visit: ElementVisit, controller: Controller, possible: ReadonlySet<string>, findings: Findings): void {
    const values = possible.size === 0 ? "NULL" : [...possible].map((value) => JSON.stringify(value)).join(", ");
    const shows = controller.showHide === "show";
    const message = `The ${visit.name} is ${shows ? "never shown" : "never hidden"}: it ${shows ? "shows" : "hides"} for the identifier ${JSON.stringify(controller.identifier)}, but the only values that ${controller.variable} can take are ${values}.`;
    findings.warning("assesskit/validate/unreachable-content", message, "INFO §5.93.2", elementPath(visit));
  }

  /** The identifiers a variable can take: its defaults and what the rules give it, `undefined` when the rules give it a computed value. */
  private possible(
    defaults: readonly string[],
    assigned: ReadonlyMap<string, ReadonlySet<string> | undefined>,
    variable: string,
  ): ReadonlySet<string> | undefined {
    if (!assigned.has(variable)) return new Set(defaults);
    const given = assigned.get(variable);
    return given === undefined ? undefined : new Set([...defaults, ...given]);
  }
}
