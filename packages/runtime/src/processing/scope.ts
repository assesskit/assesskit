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
 * processing, and the checked context.
 *
 * @remarks
 * An item and a test each implement it.
 */
export interface Scope {
  readonly environment: Environment;
  /** The test whose item sessions the operators of outcome processing count and read; `undefined` in an item. */
  readonly test: TestScope | undefined;
  /**
   * Returns the value of a variable, weighted by the weight that `weightIdentifier` names when the identifier is
   * prefixed with an item.
   *
   * @throws `ProcessingError` when there is no such variable or it is out of reach.
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  variable(identifier: string, weightIdentifier: string | undefined): Value | null;
  /**
   * Returns the default value of a variable.
   *
   * @throws `ProcessingError` when there is no such variable.
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  defaultValue(identifier: string): Value | null;
  /**
   * Returns the correct response of a response variable.
   *
   * @throws `ProcessingError` when there is no such response variable.
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  correctResponse(identifier: string): Value | null;
  /**
   * Returns a response variable with its declaration.
   *
   * @throws `ProcessingError` when there is no such response variable or it is out of reach.
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  response(identifier: string): DeclaredResponse;
  /**
   * Returns the value of the template or outcome variable that an attribute names, `undefined` when there is none in
   * reach.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  reference(identifier: string): Value | null | undefined;
}
