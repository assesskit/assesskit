import type { AssessmentItem, OutcomeDeclaration, ResponseDeclaration } from "../asi/index.js";
import {
  BUILT_IN_CONTEXTS,
  BUILT_IN_OUTCOMES,
  BUILT_IN_RESPONSES,
  DURATION,
  type VariableType,
} from "../processing/index.js";
import type { Lookup, Problem, Processing, ResponseLookup, RuleScope, Target, VariableKind } from "./scope.js";
import { type StaticType, typeOfVariable } from "./static-type.js";

/** A variable of an item, built in or declared. */
export interface DeclaredVariable {
  /** Whether it is a context, response, outcome or template variable. */
  readonly kind: VariableKind;
  /** Its cardinality and base type. */
  readonly type: VariableType;
}

/**
 * Returns the variables an item has by identifier: the built-in ones, then the declared ones. The first declaration of
 * an identifier wins, so that a duplicate does not change what the checks see.
 *
 * @param item - The item.
 * @returns The variables by identifier.
 */
export function itemVariables(item: AssessmentItem): ReadonlyMap<string, DeclaredVariable> {
  const variables = new Map<string, DeclaredVariable>();
  const add = (kind: VariableKind, identifier: string, type: VariableType): void => {
    if (!variables.has(identifier)) variables.set(identifier, { kind, type });
  };
  for (const [identifier, type] of BUILT_IN_CONTEXTS) add("context", identifier, type);
  for (const [identifier, type] of BUILT_IN_RESPONSES) add("response", identifier, type);
  for (const [identifier, type] of BUILT_IN_OUTCOMES) add("outcome", identifier, type);
  for (const declaration of item.contextDeclarations) add("context", declaration.identifier, declaration);
  for (const declaration of item.responseDeclarations) add("response", declaration.identifier, declaration);
  for (const declaration of item.outcomeDeclarations) add("outcome", declaration.identifier, declaration);
  for (const declaration of item.templateDeclarations) add("template", declaration.identifier, declaration);
  return variables;
}

const UNDECLARED: Pick<Problem, "code"> = { code: "assesskit/validate/undeclared-variable" };

/** The variables of an item, as the expressions of its response and template processing read them. */
export class ItemScope implements RuleScope {
  /** Names the item in messages. */
  readonly owner = "item";
  /** The processing whose expressions are checked. */
  readonly processing: Processing;
  private readonly variables: ReadonlyMap<string, DeclaredVariable>;
  private readonly responses: ReadonlyMap<string, ResponseDeclaration>;
  private readonly outcomes: ReadonlyMap<string, OutcomeDeclaration>;
  private readonly timeDependent: boolean;

  /**
   * @param item - The item.
   * @param processing - The processing whose expressions are checked: template processing reads only template and
   * context variables.
   */
  constructor(item: AssessmentItem, processing: "response" | "template") {
    this.processing = processing;
    this.variables = itemVariables(item);
    this.responses = new Map(item.responseDeclarations.map((declaration) => [declaration.identifier, declaration]));
    this.outcomes = new Map(item.outcomeDeclarations.map((declaration) => [declaration.identifier, declaration]));
    this.timeDependent = item.timeDependent;
  }

  private undeclared(identifier: string, what: string): Problem {
    return {
      ...UNDECLARED,
      message: `The item declares no ${what} ${JSON.stringify(identifier)}, which an expression reads. Declare it with the declaration of its kind.`,
    };
  }

  /**
   * Looks up the variable that `qti-variable` names, with the reach that the processing has.
   *
   * @param identifier - The identifier.
   * @param weightIdentifier - The weight that the expression names, when it names one.
   * @returns The type of the variable, or the problem with naming it.
   */
  variable(identifier: string, weightIdentifier: string | undefined): Lookup {
    const found = this.variables.get(identifier);
    if (found === undefined) return { problem: this.undeclared(identifier, "variable") };
    if (this.processing === "template" && (found.kind === "response" || found.kind === "outcome")) {
      return {
        problem: {
          code: "assesskit/validate/variable-out-of-reach",
          message: `Template processing reads the ${found.kind} variable ${JSON.stringify(identifier)}, but it may read only template and context variables.`,
        },
      };
    }
    if (identifier === DURATION && !this.timeDependent) {
      return {
        problem: {
          code: "assesskit/validate/duration-not-time-dependent",
          message:
            "An expression reads the built-in variable duration, but the item is not time dependent, so its value must not be used.",
        },
      };
    }
    const type = typeOfVariable(found.type);
    if (weightIdentifier === undefined) return { type };
    return { type, warnings: [this.weightProblem(weightIdentifier)] };
  }

  /**
   * An item has no item sessions to weigh, and the expressions that read them are reported as outcome-only.
   *
   * @returns Always `undefined`: an item has no weights.
   */
  weight(): undefined {
    return undefined;
  }

  private weightProblem(weightIdentifier: string): Problem {
    return {
      code: "assesskit/validate/weight-undefined",
      message: `The weight ${JSON.stringify(weightIdentifier)} is named in an item, but weights are defined by a qti-assessment-item-ref and apply only to the item variables a test reads, so it is ignored here.`,
    };
  }

  /**
   * Looks up the variable that `qti-default` names.
   *
   * @param identifier - The identifier.
   * @returns The type of the variable, or the problem with naming it.
   */
  declared(identifier: string): Lookup {
    const found = this.variables.get(identifier);
    return found === undefined
      ? { problem: this.undeclared(identifier, "variable") }
      : { type: typeOfVariable(found.type) };
  }

  /**
   * Looks up the response variable that `qti-correct` or a mapping names.
   *
   * @param identifier - The identifier.
   * @returns The declaration, or the problem with naming it.
   */
  response(identifier: string): ResponseLookup {
    const found = this.variables.get(identifier);
    if (found?.kind !== "response") return { problem: this.undeclared(identifier, "response variable") };
    return { declaration: this.responses.get(identifier) };
  }

  /**
   * Returns the variable that a rule sets.
   *
   * @param identifier - The identifier.
   * @returns The variable, or `undefined` when the item declares none.
   */
  target(identifier: string): Target | undefined {
    const found = this.variables.get(identifier);
    const outcome = this.outcomes.get(identifier);
    return found === undefined ? undefined : { ...found, ...(outcome === undefined ? {} : { outcome }) };
  }

  /**
   * Returns the type of the template or outcome variable that an attribute names.
   *
   * @param identifier - The identifier.
   * @returns The type, or `undefined` when no such variable is in reach.
   */
  reference(identifier: string): StaticType | undefined {
    const found = this.variables.get(identifier);
    const referable = found?.kind === "template" || (found?.kind === "outcome" && this.processing !== "template");
    return referable ? typeOfVariable(found.type) : undefined;
  }
}
