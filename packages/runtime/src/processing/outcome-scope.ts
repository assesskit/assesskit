import type { AssessmentTest, OutcomeDeclaration } from "../asi/index.js";
import { describe } from "../checks.js";
import { DataError, ProcessingError } from "../errors.js";
import { normalizeValue, type Value } from "../values/index.js";
import { assign, describeType, fitValue, type VariableType } from "./assign.js";
import type { Environment } from "./context.js";
import { readDeclaredValue } from "./declared-value.js";
import { ItemScope } from "./item-scope.js";
import { resolveItemIdentifier, weigh, weightOf } from "./item-session.js";
import type { DeclaredResponse, Scope } from "./scope.js";
import type { ItemSessionView, TestScope } from "./test-scope.js";
import { initialOutcome } from "./variables.js";

/**
 * The instance number in `ITEM.n.VAR`: a positive integer.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const INSTANCE = /^[1-9][0-9]*$/;

function undeclared(identifier: string, kind = "variable"): ProcessingError {
  return new ProcessingError(`The test has no ${kind} ${identifier}.`, identifier);
}

/** An item variable named with its item prefix: `ITEM.VAR` or `ITEM.n.VAR`. */
interface Prefixed {
  readonly view: ItemSessionView;
  readonly scope: ItemScope;
  readonly identifier: string;
}

/**
 * Checks the values a caller gives the outcomes of a test and returns them as the outcomes hold them.
 *
 * @throws `DataError` when a key is no outcome of the test or a value does not fit its outcome.
 */
function givenOutcomes(
  given: ReadonlyMap<string, Value | null>,
  declarations: ReadonlyMap<string, VariableType>,
): Map<string, Value | null> {
  if (!(given instanceof Map)) {
    throw new DataError(`The outcomes must be a Map from identifier to value, found ${describe(given)}.`);
  }
  const values = new Map<string, Value | null>();
  for (const [identifier, value] of given) {
    const type = declarations.get(identifier);
    if (type === undefined)
      throw new DataError(`The outcomes give ${describe(identifier)}, which the test does not declare.`);
    if (value === null) {
      values.set(identifier, null);
      continue;
    }
    const checked = normalizeValue(value);
    const fitted = fitValue(checked, type);
    if (fitted === undefined) {
      throw new DataError(`The outcome ${identifier} is ${describeType(type)}, found ${describeType(checked)}.`);
    }
    values.set(identifier, fitted);
  }
  return values;
}

/**
 * The variables that test-level expressions read: the outcomes of the test, which outcome processing sets, and through
 * the test scope its other variables and its item sessions.
 */
export class OutcomeScope implements Scope {
  readonly environment: Environment;
  readonly test: TestScope;
  private readonly declarations = new Map<string, OutcomeDeclaration>();
  private readonly defaults = new Map<string, Value | null>();
  private readonly outcomes = new Map<string, Value | null>();

  /**
   * @param given - The values the outcomes start from; an outcome left out starts from its default value, else 0 for a
   * single integer or float, else NULL.
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  constructor(
    test: AssessmentTest,
    given: ReadonlyMap<string, Value | null>,
    scope: TestScope,
    environment: Environment,
  ) {
    this.environment = environment;
    this.test = scope;
    for (const declaration of test.contextDeclarations) {
      const what = `The default value of ${declaration.identifier}`;
      this.defaults.set(declaration.identifier, readDeclaredValue(declaration.defaultValue?.values, declaration, what));
    }
    for (const declaration of test.outcomeDeclarations) this.declarations.set(declaration.identifier, declaration);
    const values = givenOutcomes(given, this.declarations);
    for (const declaration of test.outcomeDeclarations) {
      const what = `The default value of ${declaration.identifier}`;
      const defaultValue = readDeclaredValue(declaration.defaultValue?.values, declaration, what);
      this.defaults.set(declaration.identifier, defaultValue);
      const value = values.has(declaration.identifier)
        ? (values.get(declaration.identifier) ?? null)
        : initialOutcome(declaration, defaultValue);
      this.outcomes.set(declaration.identifier, value);
    }
  }

  /** Returns the item session and item identifier that a prefixed identifier names, `undefined` for any other. */
  private prefixed(identifier: string): Prefixed | undefined {
    const parts = identifier.split(".");
    const [item = "", middle = "", last = ""] = parts;
    const named =
      parts.length === 2
        ? { instance: undefined, name: middle }
        : parts.length === 3 && INSTANCE.test(middle)
          ? { instance: Number(middle), name: last }
          : undefined;
    const view = named === undefined ? undefined : this.test.itemSession(item, named.instance);
    if (named === undefined || view === undefined) return undefined;
    const scope = new ItemScope(view.item, view.variables, this.environment, "item");
    return { view, scope, identifier: resolveItemIdentifier(view.ref, named.name) };
  }

  variable(identifier: string, weightIdentifier: string | undefined): Value | null {
    const prefixed = this.prefixed(identifier);
    if (prefixed !== undefined) {
      const value = prefixed.scope.variable(prefixed.identifier);
      return weightIdentifier === undefined ? value : weigh(value, weightOf(prefixed.view.ref, weightIdentifier));
    }
    if (this.declarations.has(identifier)) return this.outcomes.get(identifier) ?? null;
    const value = this.test.variable(identifier);
    if (value === undefined) throw undeclared(identifier);
    return value;
  }

  defaultValue(identifier: string): Value | null {
    const prefixed = this.prefixed(identifier);
    if (prefixed !== undefined) return prefixed.scope.defaultValue(prefixed.identifier);
    if (!this.defaults.has(identifier)) throw undeclared(identifier);
    return this.defaults.get(identifier) ?? null;
  }

  correctResponse(identifier: string): Value | null {
    const prefixed = this.prefixed(identifier);
    if (prefixed === undefined) throw undeclared(identifier, "response variable");
    return prefixed.scope.correctResponse(prefixed.identifier);
  }

  response(identifier: string): DeclaredResponse {
    const prefixed = this.prefixed(identifier);
    if (prefixed === undefined) throw undeclared(identifier, "response variable");
    return prefixed.scope.response(prefixed.identifier);
  }

  reference(identifier: string): Value | null | undefined {
    return this.declarations.has(identifier) ? (this.outcomes.get(identifier) ?? null) : undefined;
  }

  /**
   * Returns the declaration of an outcome of the test, for its lookup table.
   *
   * @throws `ProcessingError` when the test declares no such outcome.
   */
  outcomeDeclaration(identifier: string): OutcomeDeclaration {
    const declaration = this.declarations.get(identifier);
    if (declaration === undefined) throw undeclared(identifier, "outcome");
    return declaration;
  }

  /**
   * Sets an outcome of the test (`qti-set-outcome-value`, `qti-lookup-outcome-value`).
   *
   * @throws `ProcessingError` when the test declares no such outcome or the value does not fit it.
   */
  setOutcome(identifier: string, value: Value | null, rule: string): void {
    const declaration = this.declarations.get(identifier);
    if (declaration === undefined) {
      throw new ProcessingError(
        `The rule ${rule} sets ${identifier}, which is not an outcome of the test.`,
        identifier,
      );
    }
    this.outcomes.set(identifier, assign(value, declaration, identifier));
  }

  /** Returns the current outcomes. */
  values(): ReadonlyMap<string, Value | null> {
    return new Map(this.outcomes);
  }
}
