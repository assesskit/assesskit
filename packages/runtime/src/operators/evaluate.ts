import {
  abs,
  acos,
  add,
  asin,
  atan,
  type Complex,
  complex,
  cos,
  cosh,
  divide,
  exp,
  log,
  multiply,
  negate,
  power,
  sin,
  sinh,
  sqrt,
  subtract,
  tan,
  tanh,
} from "./complex.js";
import type { FunctionName, Node } from "./tree.js";

/**
 * A value with its magnitude: the size of what its computation cancelled, which bounds its rounding error. A sum's magnitude is
 * the sum of its terms' magnitudes, a product's the product of its factors' magnitudes over the size of its divisors, a
 * negation or a scaling keeps its operand's, and any other node's is the size of its own value.
 */
export interface Measured {
  readonly value: Complex;
  readonly magnitude: number;
}

/** What a tree is evaluated at: the value of each variable, and the side each `\pm` takes. */
export interface Point {
  /** The value of a variable, with its magnitude. */
  value(name: string): Measured;
  /** The sign a `\pm` of an entry takes, by its index: 1 or -1. */
  sign(index: number): 1 | -1;
}

const ONE = complex(1);
const LN_10 = complex(Math.LN10);
const LN_2 = complex(Math.LN2);
const DEGREE = Math.PI / 180;

const FUNCTIONS: Readonly<Record<FunctionName, (argument: Complex) => Complex>> = {
  sin,
  cos,
  tan,
  sec: (argument) => divide(ONE, cos(argument)),
  csc: (argument) => divide(ONE, sin(argument)),
  cot: (argument) => divide(cos(argument), sin(argument)),
  arcsin: asin,
  arccos: acos,
  arctan: atan,
  sinh,
  cosh,
  tanh,
  exp,
  ln: log,
  log: (argument) => divide(log(argument), LN_10),
  lb: (argument) => divide(log(argument), LN_2),
  sqrt,
  abs,
};

/** The size of a complex number. */
export function sizeOf(value: Complex): number {
  return Math.hypot(value.re, value.im);
}

/** A value whose magnitude is its own size. */
export function measured(value: Complex): Measured {
  return { value, magnitude: sizeOf(value) };
}

function sumOf(node: Extract<Node, { kind: "sum" }>, point: Point): Measured {
  let value = complex(0);
  let magnitude = 0;
  for (const term of node.terms) {
    const part = evaluate(term.node, point);
    const sign = term.sign === "plus-minus" ? point.sign(term.index) : term.sign;
    value = sign === 1 ? add(value, part.value) : subtract(value, part.value);
    magnitude += part.magnitude;
  }
  return { value, magnitude };
}

function productOf(node: Extract<Node, { kind: "product" }>, point: Point): Measured {
  let value = ONE;
  let magnitude = 1;
  for (const factor of node.factors) {
    const part = evaluate(factor.node, point);
    value = factor.inverse ? divide(value, part.value) : multiply(value, part.value);
    magnitude = factor.inverse ? magnitude / sizeOf(part.value) : magnitude * part.magnitude;
  }
  return { value, magnitude };
}

/**
 * Evaluates a tree at a point in the complex arithmetic, with its magnitude. A pole or an overflow gives a value or a magnitude
 * that is not finite.
 */
export function evaluate(node: Node, point: Point): Measured {
  switch (node.kind) {
    case "number":
      return measured(complex(node.value));
    case "variable":
      return point.value(node.name);
    case "constant":
      return measured(complex(node.name === "pi" ? Math.PI : Math.E));
    case "sum":
      return sumOf(node, point);
    case "product":
      return productOf(node, point);
    case "negate": {
      const inner = evaluate(node.node, point);
      return { value: negate(inner.value), magnitude: inner.magnitude };
    }
    case "power":
      return measured(power(evaluate(node.base, point).value, evaluate(node.exponent, point).value));
    case "call":
      return measured(FUNCTIONS[node.name](evaluate(node.argument, point).value));
    case "logarithm":
      return measured(divide(log(evaluate(node.argument, point).value), log(evaluate(node.base, point).value)));
    case "scale": {
      const inner = evaluate(node.node, point);
      const factor = DEGREE ** node.degrees / 100 ** node.percents;
      return { value: multiply(inner.value, complex(factor)), magnitude: inner.magnitude * factor };
    }
  }
}

/** The names of the variables of a tree, added to a set. */
export function collectVariables(node: Node, names: Set<string>): void {
  switch (node.kind) {
    case "variable":
      names.add(node.name);
      return;
    case "sum":
      for (const term of node.terms) collectVariables(term.node, names);
      return;
    case "product":
      for (const factor of node.factors) collectVariables(factor.node, names);
      return;
    case "negate":
    case "scale":
      collectVariables(node.node, names);
      return;
    case "power":
      collectVariables(node.base, names);
      collectVariables(node.exponent, names);
      return;
    case "call":
      collectVariables(node.argument, names);
      return;
    case "logarithm":
      collectVariables(node.base, names);
      collectVariables(node.argument, names);
      return;
    default:
      return;
  }
}
