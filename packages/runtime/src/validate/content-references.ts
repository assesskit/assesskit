import type { ElementVisit } from "../asi/internal.js";
import type { Findings } from "./findings.js";
import type { DeclaredVariable } from "./item-scope.js";
import { elementPath, textOf } from "./model-access.js";
import type { VariableKind } from "./scope.js";

/** The elements whose visibility an outcome variable controls. */
const FEEDBACK = new Set(["qti-feedback-block", "qti-feedback-inline", "qti-modal-feedback", "qti-test-feedback"]);

/**
 * The elements that name a template variable in `template-identifier` but are not content: the default of a template
 * variable that a test gives an item, and the variable that a portable custom interaction passes.
 */
const NOT_CONTENT = new Set(["qti-template-default", "qti-template-variable"]);

/** A variable that decides whether an element of the content shows, and what it is compared with. */
export interface Controller {
  /** The identifier of the variable. */
  readonly variable: string;
  /** Whether the variable is an outcome (feedback) or a template variable. */
  readonly kind: "outcome" | "template";
  /** The identifier the variable's value is compared with. */
  readonly identifier: string;
  /** Whether the element is shown when the value matches, or hidden. */
  readonly showHide: "show" | "hide";
}

/**
 * Returns what decides whether an element shows, `undefined` for an element that is always shown.
 *
 * @param visit - The element that the walk of the document reached.
 * @returns The controlling variable and the identifiers it shows for.
 */
export function controllerOf(visit: ElementVisit): Controller | undefined {
  const outcome = FEEDBACK.has(visit.name);
  const variable = textOf(visit.model, outcome ? "outcomeIdentifier" : "templateIdentifier");
  const identifier = textOf(visit.model, "identifier");
  if (variable === undefined || identifier === undefined || NOT_CONTENT.has(visit.name)) return undefined;
  return {
    variable,
    kind: outcome ? "outcome" : "template",
    identifier,
    showHide: visit.model.showHide === "hide" ? "hide" : "show",
  };
}

/**
 * Checks that the variables which the content of an item or a test names exist and suit what names them: the outcome
 * that shows feedback, the template variable that shows template content or a choice, and the variable a printed variable
 * prints.
 */
export class ContentReferences {
  private readonly findings: Findings;
  private readonly variable: (identifier: string) => DeclaredVariable | undefined;
  private readonly owner: string;

  /**
   * @param findings - Where the issues go.
   * @param variable - Finds a variable the content may name by its identifier.
   * @param owner - What declares the variables, `item` or `test`, for messages.
   */
  constructor(
    findings: Findings,
    variable: (identifier: string) => DeclaredVariable | undefined,
    owner: "item" | "test",
  ) {
    this.findings = findings;
    this.variable = variable;
    this.owner = owner;
  }

  /**
   * Checks one element of the content.
   *
   * @param visit - The element that the walk of the document reached.
   */
  visit(visit: ElementVisit): void {
    if (FEEDBACK.has(visit.name)) {
      this.controlling(visit, textOf(visit.model, "outcomeIdentifier"), ["outcome"], "outcome-identifier");
    } else if (visit.name === "qti-printed-variable") {
      this.named(visit, textOf(visit.model, "identifier"), ["outcome", "template"], "identifier");
    } else if (!NOT_CONTENT.has(visit.name)) {
      this.controlling(visit, textOf(visit.model, "templateIdentifier"), ["template"], "template-identifier");
    }
  }

  /** Looks up the variable an attribute names; reports it when the owner declares none or declares one of another kind. */
  private named(
    visit: ElementVisit,
    identifier: string | undefined,
    kinds: readonly VariableKind[],
    attribute: string,
  ): DeclaredVariable | undefined {
    if (identifier === undefined) return undefined;
    const found = this.variable(identifier);
    const here = elementPath(visit);
    if (found === undefined) {
      const message = `The attribute ${attribute} of the ${visit.name} names ${JSON.stringify(identifier)}, which the ${this.owner} does not declare. Declare it as ${kinds.join(" or ")} variable.`;
      this.findings.error("assesskit/validate/undeclared-variable", message, here);
      return undefined;
    }
    if (!kinds.includes(found.kind)) {
      const message = `The attribute ${attribute} of the ${visit.name} names ${JSON.stringify(identifier)}, a ${found.kind} variable, but it must name ${kinds.join(" or ")} variable.`;
      this.findings.error("assesskit/validate/reference-kind", message, here);
      return undefined;
    }
    return found;
  }

  /** Checks a variable that decides whether content shows: its base type is identifier, and it is single or multiple. */
  private controlling(
    visit: ElementVisit,
    identifier: string | undefined,
    kinds: readonly VariableKind[],
    attribute: string,
  ): void {
    const found = this.named(visit, identifier, kinds, attribute);
    if (found === undefined) return;
    const { cardinality, baseType } = found.type;
    if (baseType === "identifier" && (cardinality === "single" || cardinality === "multiple")) return;
    const message = `The attribute ${attribute} of the ${visit.name} names ${JSON.stringify(identifier)}, which must have the base type identifier and the cardinality single or multiple, found ${cardinality} ${baseType ?? "without a base type"}.`;
    this.findings.error("assesskit/validate/reference-type", message, elementPath(visit));
  }
}
