import type { AssessmentItem, OutcomeDeclaration, ResponseDeclaration } from "../asi/index.js";
import { describe } from "../checks.js";
import { ProcessingError } from "../errors.js";
import type { Value } from "../values/index.js";
import { assign, type VariableType } from "./assign.js";
import {
  BUILT_IN_CONTEXTS,
  BUILT_IN_OUTCOMES,
  BUILT_IN_RESPONSES,
  COMPLETION_STATUS,
  COMPLETION_STATUSES,
} from "./built-ins.js";
import type { Environment } from "./context.js";
import type { DeclaredResponse, Scope } from "./scope.js";
import { type ItemVariables, initialOutcome } from "./variables.js";

/** The kinds of item variables. */
type Kind = "context" | "response" | "outcome" | "template";

/**
 * Which variables expressions read: template processing reads only template and context variables.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export type Reach = "template-processing" | "item";

function undeclared(identifier: string, kind = "variable"): ProcessingError {
  return new ProcessingError(`The item declares no ${kind} ${identifier}.`, identifier);
}

/**
 * The variables of an item while processing reads and sets them.
 *
 * @remarks
 * It works on copies, so that the variables it was made from stay as they are; {@link ItemScope.variables} returns the
 * result.
 */
export class ItemScope implements Scope {
  readonly environment: Environment;
  readonly test = undefined;
  private readonly reach: Reach;
  private readonly kinds = new Map<string, Kind>();
  private readonly types = new Map<string, VariableType>();
  private readonly responseDeclarations = new Map<string, ResponseDeclaration>();
  private readonly outcomeDeclarations = new Map<string, OutcomeDeclaration>();
  private readonly contexts: Map<string, Value | null>;
  private readonly responses: Map<string, Value | null>;
  private outcomes: Map<string, Value | null>;
  private templates: Map<string, Value | null>;
  private correctResponses: Map<string, Value | null>;
  private defaults: Map<string, Value | null>;

  constructor(item: AssessmentItem, variables: ItemVariables, environment: Environment, reach: Reach) {
    this.environment = environment;
    this.reach = reach;
    const declare = (kind: Kind, identifier: string, type: VariableType): void => {
      this.kinds.set(identifier, kind);
      this.types.set(identifier, type);
    };
    for (const [identifier, type] of BUILT_IN_CONTEXTS) declare("context", identifier, type);
    for (const [identifier, type] of BUILT_IN_RESPONSES) declare("response", identifier, type);
    for (const [identifier, type] of BUILT_IN_OUTCOMES) declare("outcome", identifier, type);
    for (const declaration of item.contextDeclarations) declare("context", declaration.identifier, declaration);
    for (const declaration of item.responseDeclarations) {
      declare("response", declaration.identifier, declaration);
      this.responseDeclarations.set(declaration.identifier, declaration);
    }
    for (const declaration of item.outcomeDeclarations) {
      declare("outcome", declaration.identifier, declaration);
      this.outcomeDeclarations.set(declaration.identifier, declaration);
    }
    for (const declaration of item.templateDeclarations) declare("template", declaration.identifier, declaration);
    this.contexts = new Map(variables.contexts);
    this.responses = new Map(variables.responses);
    this.outcomes = new Map(variables.outcomes);
    this.templates = new Map(variables.templates);
    this.correctResponses = new Map(variables.correctResponses);
    this.defaults = new Map(variables.defaults);
  }

  /** Returns the kind of a variable, checking that it is in reach. */
  private kindInReach(identifier: string): Kind {
    const kind = this.kinds.get(identifier);
    if (kind === undefined) throw undeclared(identifier);
    if (this.reach === "template-processing" && (kind === "response" || kind === "outcome")) {
      throw new ProcessingError(
        `Template processing reads the ${kind} variable ${identifier}, but it may read only template and context variables.`,
        identifier,
      );
    }
    return kind;
  }

  private valuesOf(kind: Kind): Map<string, Value | null> {
    switch (kind) {
      case "context":
        return this.contexts;
      case "response":
        return this.responses;
      case "outcome":
        return this.outcomes;
      case "template":
        return this.templates;
    }
  }

  variable(identifier: string): Value | null {
    return this.valuesOf(this.kindInReach(identifier)).get(identifier) ?? null;
  }

  defaultValue(identifier: string): Value | null {
    if (!this.kinds.has(identifier)) throw undeclared(identifier);
    return this.defaults.get(identifier) ?? null;
  }

  correctResponse(identifier: string): Value | null {
    if (this.kinds.get(identifier) !== "response") throw undeclared(identifier, "response variable");
    return this.correctResponses.get(identifier) ?? null;
  }

  response(identifier: string): DeclaredResponse {
    const declaration = this.responseDeclarations.get(identifier);
    if (declaration === undefined) throw undeclared(identifier, "response variable");
    this.kindInReach(identifier);
    return { declaration, value: this.responses.get(identifier) ?? null };
  }

  reference(identifier: string): Value | null | undefined {
    const kind = this.kinds.get(identifier);
    const referable = kind === "template" || (kind === "outcome" && this.reach === "item");
    return referable ? (this.valuesOf(kind).get(identifier) ?? null) : undefined;
  }

  /**
   * Returns the declaration of an outcome, for its lookup table.
   *
   * @throws `ProcessingError` when the item declares no such outcome.
   */
  outcomeDeclaration(identifier: string): OutcomeDeclaration {
    const declaration = this.outcomeDeclarations.get(identifier);
    if (declaration === undefined) throw undeclared(identifier, "outcome");
    return declaration;
  }

  /** Returns the type of a variable of a kind, or fails naming the rule that sets it. */
  private typeOf(identifier: string, kinds: readonly Kind[], rule: string): VariableType {
    const kind = this.kinds.get(identifier);
    const type = this.types.get(identifier);
    if (kind === undefined || type === undefined || !kinds.includes(kind)) {
      const kindsText = `${kinds[0] === "outcome" ? "an" : "a"} ${kinds.join(" or ")} variable`;
      throw new ProcessingError(
        `The rule ${rule} sets ${identifier}, which is not ${kindsText} of the item.`,
        identifier,
      );
    }
    return type;
  }

  /**
   * Sets an outcome, `completionStatus` included (`qti-set-outcome-value`, `qti-lookup-outcome-value`).
   *
   * @throws `ProcessingError` when it is no outcome or the value does not fit it.
   */
  setOutcome(identifier: string, value: Value | null, rule: string): void {
    const type = this.typeOf(identifier, ["outcome"], rule);
    const assigned = assign(value, type, identifier);
    if (identifier === COMPLETION_STATUS && assigned?.cardinality === "single") {
      if (!COMPLETION_STATUSES.includes(String(assigned.value))) {
        throw new ProcessingError(
          `The outcome completionStatus cannot be ${describe(assigned.value)}; it is one of ${COMPLETION_STATUSES.join(", ")}.`,
          identifier,
        );
      }
    }
    this.outcomes.set(identifier, assigned);
  }

  /**
   * Sets a template variable (`qti-set-template-value`).
   *
   * @throws `ProcessingError` when it is no template variable or the value does not fit it.
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-set-template-value}
   */
  setTemplate(identifier: string, value: Value | null): void {
    const type = this.typeOf(identifier, ["template"], "qti-set-template-value");
    this.templates.set(identifier, assign(value, type, identifier));
  }

  /**
   * Sets the correct response of a response variable (`qti-set-correct-response`).
   *
   * @throws `ProcessingError` when it is no response variable or the value does not fit it.
   * @see
   * {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-set-correct-response}
   */
  setCorrectResponse(identifier: string, value: Value | null): void {
    const type = this.typeOf(identifier, ["response"], "qti-set-correct-response");
    this.correctResponses.set(identifier, assign(value, type, identifier));
  }

  /**
   * Sets the default value of a response variable or outcome (`qti-set-default-value`).
   *
   * @remarks
   * An outcome takes it as its value too, since outcomes start from their defaults.
   *
   * @throws `ProcessingError` when it is neither or the value does not fit it.
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-set-default-value}
   */
  setDefault(identifier: string, value: Value | null): void {
    const type = this.typeOf(identifier, ["response", "outcome"], "qti-set-default-value");
    const assigned = assign(value, type, identifier);
    this.defaults.set(identifier, assigned);
    const outcome = this.outcomeDeclarations.get(identifier);
    if (outcome !== undefined) this.outcomes.set(identifier, initialOutcome(outcome, assigned));
  }

  /**
   * Starts template processing again: the template variables take their default values, and the correct responses,
   * default values and outcomes that it set go back to their values before it.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  restart(start: ItemVariables): void {
    this.outcomes = new Map(start.outcomes);
    this.correctResponses = new Map(start.correctResponses);
    this.defaults = new Map(start.defaults);
    this.templates = new Map();
    for (const [identifier, kind] of this.kinds) {
      if (kind === "template") this.templates.set(identifier, start.defaults.get(identifier) ?? null);
    }
  }

  /** Returns the current variables. */
  variables(): ItemVariables {
    return {
      contexts: new Map(this.contexts),
      responses: new Map(this.responses),
      outcomes: new Map(this.outcomes),
      templates: new Map(this.templates),
      correctResponses: new Map(this.correctResponses),
      defaults: new Map(this.defaults),
    };
  }
}
