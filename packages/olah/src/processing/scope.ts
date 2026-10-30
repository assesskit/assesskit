import type { ResponseDeclaration } from "../asi/index.js";
import type { Value } from "../values/index.js";
import type { Environment } from "./context.js";
import type { TestScope } from "./test-scope.js";

/** A response variable with its declaration, which the mapping operators read. */
export interface DeclaredResponse {
  readonly declaration: ResponseDeclaration;
  readonly value: Value | null;
}

/**
 * What an expression reads while it is evaluated: the variables in reach, the test for the operators of outcome
 * processing, and the checked context. An item and a test each implement it.
 */
export interface Scope {
  readonly environment: Environment;
  /** The test whose item sessions the operators of outcome processing count and read; `undefined` in an item. */
  readonly test: TestScope | undefined;
  /**
   * Returns the value of a variable, weighted by the weight that `weightIdentifier` names when the identifier is
   * prefixed with an item (INFO §2.11.1.2, §7.47.2).
   *
   * @throws `ProcessingError` when there is no such variable or it is out of reach.
   */
  variable(identifier: string, weightIdentifier: string | undefined): Value | null;
  /**
   * Returns the default value of a variable (INFO §2.11.1.3).
   *
   * @throws `ProcessingError` when there is no such variable.
   */
  defaultValue(identifier: string): Value | null;
  /**
   * Returns the correct response of a response variable (INFO §2.11.1.4).
   *
   * @throws `ProcessingError` when there is no such response variable.
   */
  correctResponse(identifier: string): Value | null;
  /**
   * Returns a response variable with its declaration (INFO §2.11.1.5).
   *
   * @throws `ProcessingError` when there is no such response variable or it is out of reach.
   */
  response(identifier: string): DeclaredResponse;
  /**
   * Returns the value of the template or outcome variable that an attribute names (INFO §2.7.2), `undefined` when there
   * is none in reach.
   */
  reference(identifier: string): Value | null | undefined;
}
