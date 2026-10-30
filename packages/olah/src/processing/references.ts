import { ProcessingError } from "../errors.js";
import type { BaseType } from "../values/index.js";
import { describeType } from "./assign.js";
import { asNumber, asString, primitiveOf } from "./operands.js";
import type { Scope } from "./scope.js";

/** The source of the rules for attributes that name variables (INFO §2.7.2). */
const SOURCE = "INFO §2.7.2";

/** A `stringOrVariableRef` that names a variable: its identifier in braces (INFO §2.7.2, `EncVariableStringDType`). */
const BRACED = /^\{(.+)\}$/;

/**
 * Returns the value of the single variable an attribute names, NULL as `null`.
 *
 * @throws `ProcessingError` when no template or outcome variable in reach has the identifier, or it is not single of
 * one of the base types.
 */
function referenced(
  scope: Scope,
  identifier: string,
  baseTypes: readonly BaseType[],
  attribute: string,
): number | string | null {
  const value = scope.reference(identifier);
  if (value === undefined) {
    throw new ProcessingError(
      `The attribute ${attribute} names ${identifier}, which is no template or outcome variable in reach.`,
      SOURCE,
      identifier,
    );
  }
  if (value === null) return null;
  if (value.cardinality !== "single" || !baseTypes.includes(value.baseType)) {
    throw new ProcessingError(
      `The attribute ${attribute} names ${identifier}, which is ${describeType(value)}, not a single ${baseTypes.join(" or ")}.`,
      SOURCE,
      identifier,
    );
  }
  const primitive = primitiveOf(value);
  return typeof primitive === "string" ? asString(primitive) : asNumber(primitive);
}

/**
 * Resolves an `IntegerOrVariableRef` or `IntOrIdentifier` attribute (INFO §2.7.2, §9.3): an integer, or the identifier
 * of a single integer variable. NULL when that variable is NULL.
 *
 * @throws `ProcessingError` when the identifier names no such variable.
 */
export function integerAttribute(value: number | string, scope: Scope, attribute: string): number | null {
  if (typeof value === "number") return value;
  const found = referenced(scope, value, ["integer"], attribute);
  return found === null ? null : asNumber(found);
}

/**
 * Resolves a `FloatOrVariableRef` attribute or an item of a `ToleranceList` (INFO §2.7.2, §9.3, G34): a number, or the
 * identifier of a single float variable; an integer variable is promoted (D5). NULL when that variable is NULL.
 *
 * @throws `ProcessingError` when the identifier names no such variable.
 */
export function floatAttribute(value: number | string, scope: Scope, attribute: string): number | null {
  if (typeof value === "number") return value;
  const found = referenced(scope, value, ["float", "integer"], attribute);
  return found === null ? null : asNumber(found);
}

/**
 * Resolves a `StringOrVariableRef` attribute (INFO §2.7.2, §9.3): `{identifier}` names a single string variable, unless
 * no template or outcome variable in reach has the identifier, when the text is the string itself, as is any other text.
 * NULL when the variable is NULL.
 *
 * @throws `ProcessingError` when the identifier names a variable that is not a single string.
 */
export function stringAttribute(value: string, scope: Scope, attribute: string): string | null {
  const identifier = BRACED.exec(value)?.[1];
  if (identifier === undefined || scope.reference(identifier) === undefined) return value;
  const found = referenced(scope, identifier, ["string"], attribute);
  return found === null ? null : asString(found);
}
