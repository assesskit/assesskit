import type { AssessmentItem, AssessmentItemRef, AssessmentTest, OutcomeDeclaration } from "../asi/index.js";
import { BUILT_IN_CONTEXTS, DURATION, itemIdentifier, QTI_CONTEXT } from "../processing/index.js";
import { type DeclaredVariable, itemVariables } from "./item-scope.js";
import type { Lookup, Problem, Processing, ResponseLookup, RuleScope, Target } from "./scope.js";
import { type StaticType, typeOfVariable, UNKNOWN } from "./static-type.js";

/** An item reference of a test, with the item it names when the check could resolve it. */
export interface ItemRefInfo {
  /** The item reference. */
  readonly ref: AssessmentItemRef;
  /** The item; absent when it could not be resolved or is a link to a tool, whose variables are then not known. */
  readonly item?: AssessmentItem;
  /** Whether `ITEM.VAR`, with no instance number, names no value of the item reference (INFO §2.11.1.2, G9). */
  readonly undefinedInstance: boolean;
}

/** What the expressions of a test can name besides its own variables: the item references, and the parts and sections. */
export interface TestContext {
  /** The item references by identifier. */
  readonly itemRefs: ReadonlyMap<string, ItemRefInfo>;
  /** The identifiers of the test parts and sections, whose `duration` a test can read. */
  readonly containers: ReadonlySet<string>;
}

/** The instance number in `ITEM.n.VAR`: a positive integer (INFO §2.11.1.2). */
const INSTANCE = /^[1-9][0-9]*$/;

const UNDECLARED = { code: "assesskit/validate/undeclared-variable" } as const;

/** The problem with a weight that an expression names and that is not defined where it is looked up (INFO §7.47.2). */
function weightProblem(weightIdentifier: string, owner: string): Problem {
  return {
    code: "assesskit/validate/weight-undefined",
    message: `An expression names the weight ${JSON.stringify(weightIdentifier)}, but ${owner} has no qti-weight with that identifier, so the weight 1 applies.`,
  };
}

/**
 * The problem with a value that an expression reads without naming the instance of an item that selection with
 * replacement can repeat (INFO §2.11.1.2).
 */
function instanceProblem(identifier: string, head: string, name: string): Problem {
  return {
    code: "assesskit/validate/item-variable-undefined",
    message: `The expression reads ${JSON.stringify(identifier)}, but selection with replacement can repeat the item reference ${JSON.stringify(head)} in a test part that submits each item alone, so the specification leaves the value undefined and the runtime reads the instance whose attempt ended last. Name an instance, as in ${JSON.stringify(`${head}.1.${name}`)}.`,
  };
}

/** The variables of a test, as the expressions of its outcome processing, pre-conditions and branch rules read them. */
export class TestScope implements RuleScope {
  readonly owner = "test";
  readonly processing: Processing = "outcome";
  private readonly outcomes: ReadonlyMap<string, OutcomeDeclaration>;
  private readonly contexts: ReadonlyMap<string, DeclaredVariable>;
  private readonly context: TestContext | undefined;
  private readonly itemVariables = new Map<AssessmentItem, ReadonlyMap<string, DeclaredVariable>>();

  /**
   * @param test - The test.
   * @param context - The item references, parts and sections; absent when the test is checked alone, so that a variable
   * with a prefix is not checked.
   */
  constructor(test: AssessmentTest, context: TestContext | undefined) {
    this.context = context;
    this.outcomes = new Map(test.outcomeDeclarations.map((declaration) => [declaration.identifier, declaration]));
    const contexts = new Map<string, DeclaredVariable>();
    for (const [identifier, type] of BUILT_IN_CONTEXTS) contexts.set(identifier, { kind: "context", type });
    for (const declaration of test.contextDeclarations) {
      if (!contexts.has(declaration.identifier))
        contexts.set(declaration.identifier, { kind: "context", type: declaration });
    }
    this.contexts = contexts;
  }

  /** The variables of the test that are its own: outcomes, context variables and its `duration`. */
  own(identifier: string): DeclaredVariable | undefined {
    const outcome = this.outcomes.get(identifier);
    if (outcome !== undefined) return { kind: "outcome", type: outcome };
    if (identifier === DURATION) return { kind: "response", type: { cardinality: "single", baseType: "duration" } };
    return this.contexts.get(identifier);
  }

  private problem(identifier: string, what: string): Problem {
    return {
      ...UNDECLARED,
      message: `The test declares no ${what} ${JSON.stringify(identifier)}, which an expression reads. Declare it with a qti-outcome-declaration or qti-context-declaration.`,
    };
  }

  /**
   * Splits `ITEM.VAR` and `ITEM.n.VAR` into the item reference and the variable, and says whether an instance is named;
   * `undefined` for any other identifier.
   */
  private static prefixed(
    identifier: string,
  ): { readonly head: string; readonly name: string; readonly instance: boolean } | undefined {
    const [head = "", middle = "", last = "", ...rest] = identifier.split(".");
    if (rest.length > 0 || middle === "") return undefined;
    if (last === "") return { head, name: middle, instance: false };
    return INSTANCE.test(middle) ? { head, name: last, instance: true } : undefined;
  }

  private variablesOf(item: AssessmentItem): ReadonlyMap<string, DeclaredVariable> {
    let variables = this.itemVariables.get(item);
    if (variables === undefined) {
      variables = itemVariables(item);
      this.itemVariables.set(item, variables);
    }
    return variables;
  }

  /** Looks up a variable that an identifier with a prefix reads: an item's variable, or the duration of a part or section. */
  private prefixedVariable(
    identifier: string,
    head: string,
    name: string,
    weightIdentifier: string | undefined,
  ): Lookup {
    if (this.context === undefined) return { type: UNKNOWN };
    const info = this.context.itemRefs.get(head);
    if (info === undefined) {
      if (this.context.containers.has(head) && name === DURATION)
        return { type: { cardinality: "single", baseType: "duration" } };
      return { problem: this.problem(identifier, "item variable or duration") };
    }
    if (info.item === undefined) return { type: UNKNOWN };
    const found = this.variablesOf(info.item).get(itemIdentifier(info.ref, name));
    if (found === undefined) {
      return {
        problem: {
          ...UNDECLARED,
          message: `The expression reads ${JSON.stringify(identifier)}, but the item of the item reference ${JSON.stringify(head)} declares no variable ${JSON.stringify(name)}.`,
        },
      };
    }
    if (name === DURATION && !info.item.timeDependent) {
      return {
        problem: {
          code: "assesskit/validate/duration-not-time-dependent",
          message: `The expression reads ${JSON.stringify(identifier)}, but the item of the item reference ${JSON.stringify(head)} is not time dependent, so its duration must not be used.`,
        },
      };
    }
    const type = this.weighted(typeOfVariable(found.type), weightIdentifier !== undefined);
    const undefinedWeight =
      weightIdentifier !== undefined && !info.ref.weights.some(({ identifier: each }) => each === weightIdentifier);
    return undefinedWeight
      ? { type, warnings: [weightProblem(weightIdentifier, `the item reference ${JSON.stringify(head)}`)] }
      : { type };
  }

  /** A weight turns the values of integer and float variables into floats (INFO §7.47.2). */
  private weighted(type: StaticType, weighted: boolean): StaticType {
    if (!weighted || (type.baseType !== "integer" && type.baseType !== "float")) return type;
    return { ...type, baseType: "float" };
  }

  /** Looks up the variable that an identifier names, whichever instance of an item it is read from. */
  private find(identifier: string, weightIdentifier: string | undefined): Lookup {
    const own = this.own(identifier);
    if (own !== undefined) {
      const type = typeOfVariable(own.type);
      return weightIdentifier === undefined
        ? { type }
        : { type, warnings: [weightProblem(weightIdentifier, "the test")] };
    }
    const split = TestScope.prefixed(identifier);
    if (split === undefined) return { problem: this.problem(identifier, "variable") };
    return this.prefixedVariable(identifier, split.head, split.name, weightIdentifier);
  }

  variable(identifier: string, weightIdentifier: string | undefined): Lookup {
    const found = this.find(identifier, weightIdentifier);
    const split = this.own(identifier) === undefined ? TestScope.prefixed(identifier) : undefined;
    if ("problem" in found || split === undefined || split.instance) return found;
    if (this.context?.itemRefs.get(split.head)?.undefinedInstance !== true) return found;
    return { ...found, warnings: [...(found.warnings ?? []), instanceProblem(identifier, split.head, split.name)] };
  }

  /** Looks up the variable that `qti-default` names: a default value does not depend on the instance. */
  declared(identifier: string): Lookup {
    return this.find(identifier, undefined);
  }

  weight(weightIdentifier: string): Problem | undefined {
    if (this.context === undefined) return undefined;
    const defined = [...this.context.itemRefs.values()].some(({ ref }) =>
      ref.weights.some(({ identifier }) => identifier === weightIdentifier),
    );
    return defined ? undefined : weightProblem(weightIdentifier, "any item reference of the test");
  }

  response(identifier: string): ResponseLookup {
    const split = TestScope.prefixed(identifier);
    if (split === undefined) return { problem: this.problem(identifier, "response variable") };
    if (this.context === undefined) return {};
    const info = this.context.itemRefs.get(split.head);
    if (info === undefined) return { problem: this.problem(identifier, "response variable") };
    if (info.item === undefined) return {};
    const name = itemIdentifier(info.ref, split.name);
    const declaration = info.item.responseDeclarations.find((each) => each.identifier === name);
    return declaration === undefined ? { problem: this.problem(identifier, "response variable") } : { declaration };
  }

  reference(identifier: string): StaticType | undefined {
    const outcome = this.outcomes.get(identifier);
    return outcome === undefined ? undefined : typeOfVariable(outcome);
  }

  target(identifier: string): Target | undefined {
    const outcome = this.outcomes.get(identifier);
    return outcome === undefined ? undefined : { kind: "outcome", type: outcome, outcome };
  }
}

/** The identifier of the built-in context variable, for the declarations a test must not repeat. */
export const TEST_BUILT_IN: readonly string[] = [DURATION, QTI_CONTEXT];
