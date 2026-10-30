import type { Expression } from "../asi/index.js";
import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import {
  type CustomOperator,
  DEFAULT_RANDOM_MIN,
  DEFAULT_RANDOM_STEP,
  describeCount,
  describeOperand,
  OPERATOR_SIGNATURES,
  type OperatorSignature,
  operandsOf,
} from "../processing/index.js";
import { type BaseType, compileXsdRegex } from "../values/index.js";
import type { Findings } from "./findings.js";
import type { ExpressionScope, Lookup } from "./scope.js";
import { describeStatic, type StaticType, typeOfVariable, UNKNOWN } from "./static-type.js";

/** The expressions that read the item sessions of a test and so belong to outcome processing (INFO §2.11.2). */
const OUTCOME_ONLY = new Set<Expression["kind"]>([
  "number-correct",
  "number-incorrect",
  "number-presented",
  "number-responded",
  "number-selected",
  "outcome-maximum",
  "outcome-minimum",
  "test-variables",
]);

/** The ones of them that BIND §5.3.2 forbids in response processing by name. */
const BIND_OUTCOME_ONLY = new Set<Expression["kind"]>(["outcome-maximum", "outcome-minimum", "test-variables"]);

/** A `StringOrVariableRef` that names a variable: its identifier in braces (INFO §2.7.2). */
const BRACED = /^\{(.+)\}$/;

/** The `name`s of `qti-math-operator` whose result is an integer (INFO §2.11.3.39). */
const INTEGER_MATH = new Set(["signum", "floor", "ceil"]);

function known<T>(values: readonly (T | undefined)[]): T[] {
  return values.filter((value): value is T => value !== undefined);
}

/** Returns a type with the fields that are known, so that an unknown field is absent. */
function typed(cardinality: StaticType["cardinality"], baseType: BaseType | undefined): StaticType {
  return {
    ...(cardinality === undefined ? {} : { cardinality }),
    ...(baseType === undefined ? {} : { baseType }),
  };
}

/** Returns the base type that the `base-type` attribute of an expression gives its result, when it has one. */
function attributeBaseType(expression: Expression): BaseType | undefined {
  switch (expression.kind) {
    case "base-value":
      return expression.baseType;
    case "test-variables":
      // A weight makes integers and floats floats (INFO §7.39.6); without a base type the result depends on the values.
      return expression.baseType ?? (expression.weightIdentifier === undefined ? undefined : "float");
    default:
      return undefined;
  }
}

/** Returns the base type of a result that is an integer when every operand is one and a float when one is (INFO §2.11.3). */
function numericBaseType(operands: readonly StaticType[]): BaseType | undefined {
  const baseTypes = operands.map(({ baseType }) => baseType);
  if (baseTypes.every((baseType) => baseType === "integer")) return "integer";
  return baseTypes.includes("float") ? "float" : undefined;
}

/**
 * Checks the expressions of response, template and outcome processing without running them: the variables they name,
 * the cardinality and base type of each operand against the signature of its operator (INFO §2.11.3), and the values
 * that are constant. The type of an expression is inferred from the bottom up; what depends on a value is unknown, and an
 * unknown type passes every check, so that a check reports only what no value could satisfy.
 */
export class ExpressionChecker {
  private readonly findings: Findings;
  private readonly scope: ExpressionScope;
  private readonly customOperators: ReadonlyMap<string, CustomOperator> | undefined;

  /**
   * @param findings - Where the issues go.
   * @param scope - The variables the expressions read.
   * @param customOperators - The custom operators the host registers; absent when it is not known, so that a
   * `qti-custom-operator` is not checked.
   */
  constructor(
    findings: Findings,
    scope: ExpressionScope,
    customOperators: ReadonlyMap<string, CustomOperator> | undefined,
  ) {
    this.findings = findings;
    this.scope = scope;
    this.customOperators = customOperators;
  }

  /**
   * Checks an expression and everything below it and returns its type.
   *
   * @param expression - The expression.
   * @param trail - The element path of the element that holds it, for the location of issues.
   */
  check(expression: Expression, trail: string): StaticType {
    const here = `${trail}/qti-${expression.kind}`;
    const signature = OPERATOR_SIGNATURES.get(expression.kind);
    if (signature === undefined) {
      const message = `The model has the expression kind ${describe(expression.kind)}, which QTI 3.0 does not define.`;
      this.findings.error("olah/validate/unknown-expression", message, "INFO §2.11", here);
      return UNKNOWN;
    }
    const operands = operandsOf(expression).map((operand) => this.check(operand, here));
    this.checkOperands(expression.kind, signature, operands, here);
    const declared = this.checkLeaf(expression, operands, here);
    return this.resultOf(expression, signature, operands, declared);
  }

  private checkOperands(
    kind: string,
    signature: OperatorSignature,
    operands: readonly StaticType[],
    here: string,
  ): void {
    const operator = `qti-${kind}`;
    const count = operands.length;
    if (count < signature.minOperands || count > signature.maxOperands) {
      const message = `The operator ${operator} takes ${describeCount(signature)} operands, found ${count}.`;
      this.findings.error("olah/validate/operand-count", message, signature.source, here);
    }
    operands.forEach((type, index) => {
      const expected = signature.operands[Math.min(index, signature.operands.length - 1)];
      if (expected === undefined) return;
      const cardinalityFits = type.cardinality === undefined || expected.cardinalities.includes(type.cardinality);
      const baseTypeFits =
        type.baseType === undefined || expected.baseTypes === undefined || expected.baseTypes.includes(type.baseType);
      if (!(cardinalityFits && baseTypeFits)) {
        const message = `The operator ${operator} takes ${describeOperand(expected)} operands, found ${describeStatic(type)} as operand ${index + 1}.`;
        this.findings.error("olah/validate/operand-type", message, signature.source, here);
      }
    });
    const baseTypes = new Set(known(operands.map(({ baseType }) => baseType)));
    if (signature.sameBaseType && baseTypes.size > 1) {
      const message = `The operator ${operator} takes operands of one base type, found ${[...baseTypes].join(" and ")}.`;
      this.findings.error("olah/validate/operand-type", message, signature.source, here);
    }
    const cardinalities = new Set(known(operands.map(({ cardinality }) => cardinality)));
    if (signature.sameCardinality && cardinalities.size > 1) {
      const message = `The operator ${operator} takes operands of one cardinality, found ${[...cardinalities].join(" and ")}.`;
      this.findings.error("olah/validate/operand-type", message, signature.source, here);
    }
  }

  private lookup(found: Lookup, here: string): StaticType {
    if ("problem" in found) {
      this.findings.error(found.problem.code, found.problem.message, found.problem.source, here);
      return UNKNOWN;
    }
    for (const { code, message, source } of found.warnings ?? []) this.findings.warning(code, message, source, here);
    return found.type;
  }

  /** Checks what an expression says beyond its operands and returns the type its variable declares, if it names one. */
  private checkLeaf(expression: Expression, operands: readonly StaticType[], here: string): StaticType {
    switch (expression.kind) {
      case "variable":
        return this.lookup(this.scope.variable(expression.identifier, expression.weightIdentifier), here);
      case "default":
        return this.lookup(this.scope.declared(expression.identifier), here);
      case "correct": {
        const found = this.scope.response(expression.identifier);
        if ("problem" in found) return this.lookup(found, here);
        return found.declaration === undefined ? UNKNOWN : typeOfVariable(found.declaration);
      }
      case "map-response":
      case "map-response-point":
        this.checkMapping(expression.kind, expression.identifier, here);
        return UNKNOWN;
      case "custom-operator":
        this.checkCustomOperator(expression, here);
        return UNKNOWN;
      case "match":
        if (operands.some(({ baseType }) => baseType === "float")) {
          const message =
            "The operator qti-match compares floats, which it should not: floats are rarely exactly equal. Use qti-equal with a tolerance.";
          this.findings.warning("olah/validate/match-float", message, "INFO §2.11.3.28", here);
        }
        return UNKNOWN;
      case "random-integer":
        this.checkRandomInteger(expression, here);
        return UNKNOWN;
      case "random-float":
        this.checkRandomFloat(expression, here);
        return UNKNOWN;
      case "pattern-match":
        this.checkPattern(expression.pattern, here);
        return UNKNOWN;
      case "test-variables":
        if (expression.weightIdentifier !== undefined && expression.baseType === "integer") {
          const message =
            "The expression qti-test-variables has a weight-identifier and base-type integer, for which a weight is undefined.";
          this.findings.error("olah/validate/weight-with-integer", message, "INFO §7.39.5", here);
        }
        this.checkOutcomeOnly(expression, here);
        return UNKNOWN;
      default:
        this.checkOutcomeOnly(expression, here);
        return UNKNOWN;
    }
  }

  private checkMapping(kind: "map-response" | "map-response-point", identifier: string, here: string): void {
    const found = this.scope.response(identifier);
    if ("problem" in found) {
      this.lookup(found, here);
      return;
    }
    const { declaration } = found;
    if (declaration === undefined) return;
    const table = kind === "map-response" ? declaration.mapping : declaration.areaMapping;
    if (table === undefined) {
      const element = kind === "map-response" ? "qti-mapping" : "qti-area-mapping";
      const message = `The expression qti-${kind} names the response variable ${JSON.stringify(identifier)}, which has no ${element} to map its value with.`;
      this.findings.error("olah/validate/missing-mapping", message, "INFO §2.11.1.5", here);
    } else if (kind === "map-response-point" && declaration.baseType !== "point") {
      const message = `The expression qti-map-response-point names the response variable ${JSON.stringify(identifier)}, whose base type must be point, found ${declaration.baseType ?? "none"}.`;
      this.findings.error("olah/validate/missing-mapping", message, "INFO §2.11.1.6", here);
    }
  }

  private checkCustomOperator(expression: Extract<Expression, { kind: "custom-operator" }>, here: string): void {
    if (this.customOperators === undefined) return;
    const names = [expression.definition, expression.class].filter((name) => name !== undefined);
    if (names.some((name) => this.customOperators?.has(name))) return;
    const named =
      names.length === 0
        ? "no definition or class"
        : `the definition or class ${names.map((name) => JSON.stringify(name)).join(" or ")}`;
    const message = `No custom operator is registered for qti-custom-operator with ${named}. Register one in the option customOperators.`;
    this.findings.error("olah/validate/custom-operator", message, "INFO §2.11.3.2", here);
  }

  private checkRandomFloat(expression: Extract<Expression, { kind: "random-float" }>, here: string): void {
    const { min = DEFAULT_RANDOM_MIN, max } = expression;
    if (typeof max === "number" && typeof min === "number" && min > max) {
      const message = `The operator qti-random-float has min ${min} above max ${max}, so it is always NULL.`;
      this.findings.error("olah/validate/random-bounds", message, "INFO §7.33", here);
    }
  }

  private checkRandomInteger(expression: Extract<Expression, { kind: "random-integer" }>, here: string): void {
    const { min = DEFAULT_RANDOM_MIN, max, step = DEFAULT_RANDOM_STEP } = expression;
    if (typeof max === "number" && typeof min === "number" && min > max) {
      const message = `The operator qti-random-integer has min ${min} above max ${max}, so it is always NULL.`;
      this.findings.error("olah/validate/random-bounds", message, "INFO §7.34", here);
    }
    if (typeof step === "number" && step <= 0) {
      const message = `The operator qti-random-integer has step ${step}, which must be above 0, so it is always NULL.`;
      this.findings.error("olah/validate/random-bounds", message, "INFO §7.34", here);
    }
  }

  /** Compiles the pattern of `qti-pattern-match`, unless it names a variable that holds the pattern (INFO §5.104.1). */
  private checkPattern(pattern: string, here: string): void {
    const identifier = BRACED.exec(pattern)?.[1];
    if (identifier !== undefined && this.scope.reference(identifier) !== undefined) return;
    checkPatternText(this.findings, pattern, "The pattern of qti-pattern-match", "INFO §5.104.1", here);
  }

  private checkOutcomeOnly(expression: Expression, here: string): void {
    if (!OUTCOME_ONLY.has(expression.kind)) return;
    if (this.scope.processing === "outcome") {
      const weight = "weightIdentifier" in expression ? expression.weightIdentifier : undefined;
      const problem = weight === undefined ? undefined : this.scope.weight(weight);
      if (problem !== undefined) this.findings.warning(problem.code, problem.message, problem.source, here);
      return;
    }
    if (this.scope.processing === "response" && BIND_OUTCOME_ONLY.has(expression.kind)) {
      const message = `The expression qti-${expression.kind} must NOT be used in ResponseProcessing.`;
      this.findings.error("RULE_SET_GENERAL_1", message, "BIND §5.3.2", here);
      return;
    }
    const message = `The expression qti-${expression.kind} reads the item sessions of a test, so only outcome processing may use it.`;
    this.findings.error("olah/validate/outcome-only-expression", message, "INFO §2.11.2", here);
  }

  private resultOf(
    expression: Expression,
    signature: OperatorSignature,
    operands: readonly StaticType[],
    declared: StaticType,
  ): StaticType {
    const { cardinality, baseType } = signature.result;
    const container = operands.at(-1)?.cardinality;
    const resultCardinality =
      cardinality === "operand" ? container : cardinality === "declared" ? declared.cardinality : cardinality;
    const resultBaseType = this.baseTypeOf(expression, baseType, operands, declared);
    return typed(resultCardinality === "unknown" ? undefined : resultCardinality, resultBaseType);
  }

  private baseTypeOf(
    expression: Expression,
    baseType: OperatorSignature["result"]["baseType"],
    operands: readonly StaticType[],
    declared: StaticType,
  ): BaseType | undefined {
    switch (baseType) {
      case "unknown":
        return undefined;
      case "operand":
        return known(operands.map((operand) => operand.baseType))[0];
      case "numeric":
        return numericBaseType(operands);
      case "declared":
        return declared.baseType;
      case "attribute":
        return attributeBaseType(expression);
      case "name":
        return expression.kind === "math-operator" && INTEGER_MATH.has(expression.name) ? "integer" : "float";
      default:
        return baseType;
    }
  }
}

/**
 * Compiles the text of a pattern of the regular expression dialect of XML Schema and reports it when it is not in the
 * dialect or too large.
 */
export function checkPatternText(
  findings: Findings,
  pattern: string,
  what: string,
  source: string,
  element: string,
): void {
  try {
    compileXsdRegex(pattern);
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    findings.error("olah/validate/pattern", `${what} is not valid: ${error.message}`, source, element);
  }
}
