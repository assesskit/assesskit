import { DISPLAY_DIGITS, formatNumber, roundForDisplay } from "./numbers.js";

/** The keys of the digits. */
export const DIGIT_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * The keys of the basic calculator: the digits, the decimal point, the four operations, equals and clear.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, calculators}
 */
export const BASIC_KEYS = [
  ...DIGIT_KEYS,
  "decimal",
  "add",
  "subtract",
  "multiply",
  "divide",
  "equals",
  "clear",
] as const;

/**
 * The keys that the standard calculator adds: square root, percent, change of sign and the memory.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, calculators}
 */
export const STANDARD_ONLY_KEYS = [
  "square-root",
  "percent",
  "sign",
  "memory-clear",
  "memory-recall",
  "memory-add",
  "memory-subtract",
] as const;

/**
 * The keys that the scientific calculator adds to those of the standard one: the inverse and hyperbolic functions,
 * parentheses, the trigonometric functions, π and e, squares, cubes, powers and roots, the logarithms and their inverses,
 * the reciprocal, the factorial, permutations and combinations.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, calculators}
 */
export const SCIENTIFIC_ONLY_KEYS = [
  "inverse",
  "hyperbolic",
  "open",
  "close",
  "sin",
  "cos",
  "tan",
  "pi",
  "euler",
  "square",
  "cube",
  "power",
  "cube-root",
  "root",
  "log",
  "ln",
  "ten-power",
  "exp",
  "reciprocal",
  "factorial",
  "permutations",
  "combinations",
] as const;

/** A key of a calculator. */
export type CalculatorKey =
  | (typeof BASIC_KEYS)[number]
  | (typeof STANDARD_ONLY_KEYS)[number]
  | (typeof SCIENTIFIC_ONLY_KEYS)[number];

/** An operation of two numbers. */
type Operator = "add" | "subtract" | "multiply" | "divide" | "power" | "root" | "permutations" | "combinations";

/**
 * The units of angle of the trigonometric functions: the scientific calculator works in degrees, radians and gradians.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, calculators}
 */
export const ANGLE_MODES = ["degree", "radian", "gradian"] as const;

/** A unit of angle of the trigonometric functions. */
export type AngleMode = (typeof ANGLE_MODES)[number];

/**
 * What the display holds: digits the candidate is typing, a number that the calculator computed or recalled, or the
 * left operand after an operation key.
 */
type Phase = "typing" | "value" | "operator";

/** What waits for the number on the display: an operation with its left operand, or an open parenthesis. */
type Pending =
  | { readonly kind: "operation"; readonly left: number; readonly operator: Operator }
  | { readonly kind: "group" };

/** A calculator between two key presses. */
export interface CalculatorState {
  /** The number on the display, as text; `"0"` after an error. */
  readonly display: string;
  /** The number on the display with all its digits, which the next operation takes. */
  readonly value: number;
  /** What the display holds; a digit extends the number only while the candidate is typing. */
  readonly phase: Phase;
  /** The operations and parentheses that wait, the latest last. */
  readonly pending: readonly Pending[];
  /** The number in the memory. */
  readonly memory: number;
  /** Whether the last operation had no number as its result (a division by zero, a square root of a negative number). */
  readonly error: boolean;
  /** Whether operations follow their order (scientific), or run as they are entered (basic and standard). */
  readonly ordered: boolean;
  /** The unit of angle of the trigonometric functions. */
  readonly angle: AngleMode;
  /** Whether the next function is the inverse one. */
  readonly inverse: boolean;
  /** Whether the next trigonometric function is the hyperbolic one. */
  readonly hyperbolic: boolean;
}

/** A basic or standard calculator that has just been switched on. */
export const INITIAL_STATE: CalculatorState = {
  display: "0",
  value: 0,
  phase: "value",
  pending: [],
  memory: 0,
  error: false,
  ordered: false,
  angle: "degree",
  inverse: false,
  hyperbolic: false,
};

/** A scientific calculator that has just been switched on: in degrees, with operations in their order. */
export const SCIENTIFIC_STATE: CalculatorState = { ...INITIAL_STATE, ordered: true };

/** The digits a number being typed can have, the width of the display. */
const MAX_TYPED_DIGITS = DISPLAY_DIGITS;

/** How tightly each operation binds when operations follow their order. */
const PRECEDENCE: Readonly<Record<Operator, number>> = {
  add: 1,
  subtract: 1,
  multiply: 2,
  divide: 2,
  permutations: 3,
  combinations: 3,
  power: 4,
  root: 4,
};

/** The operations that group from the right, as in mathematics: 2 ^ 3 ^ 2 is 2 ^ 9. */
const FROM_RIGHT: ReadonlySet<Operator> = new Set<Operator>(["power", "root"]);

const OPERATORS: ReadonlySet<string> = new Set<string>(Object.keys(PRECEDENCE));

function isOperator(key: CalculatorKey): key is Operator {
  return OPERATORS.has(key);
}

/** The largest number whose factorial is finite. */
const MAX_FACTORIAL = 170;

/** Returns n!, or NaN where it is not defined: n must be a whole number from 0. */
function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > MAX_FACTORIAL) return Number.NaN;
  let result = 1;
  for (let k = 2; k <= n; k += 1) result *= k;
  return result;
}

/**
 * Returns the permutations or the combinations of r of n things, or NaN where they are not defined. Each step multiplies
 * by at least 2 or stops at infinity, so the loop is short whatever the input.
 */
function arrangements(n: number, r: number, combine: boolean): number {
  if (!Number.isInteger(n) || !Number.isInteger(r) || r < 0 || r > n) return Number.NaN;
  const taken = combine ? Math.min(r, n - r) : r;
  let result = 1;
  for (let k = 1; k <= taken && Number.isFinite(result); k += 1) {
    result = combine ? (result * (n - taken + k)) / k : result * (n - taken + k);
  }
  return combine ? Math.round(result) : result;
}

/** Returns the y-th root of x: a negative x has one for an odd whole y only. */
function root(x: number, y: number): number {
  if (y === 0) return Number.NaN;
  if (x >= 0) return x ** (1 / y);
  return Number.isInteger(y) && Math.abs(y % 2) === 1 ? -((-x) ** (1 / y)) : Number.NaN;
}

function operate(left: number, operator: Operator, right: number): number {
  switch (operator) {
    case "add":
      return left + right;
    case "subtract":
      return left - right;
    case "multiply":
      return left * right;
    case "divide":
      return left / right;
    case "power":
      return left ** right;
    case "root":
      return root(left, right);
    case "permutations":
      return arrangements(left, right, false);
    case "combinations":
      return arrangements(left, right, true);
  }
}

/** The size of a full turn in each unit of angle. */
const TURNS: Readonly<Record<AngleMode, number>> = { degree: 360, radian: 2 * Math.PI, gradian: 400 };

/** The sine and cosine of the four right angles, which come out exact, so that the sine of 180 degrees is 0. */
const RIGHT_SINES = [0, 1, 0, -1];
const RIGHT_COSINES = [1, 0, -1, 0];

/**
 * Returns the sine, cosine or tangent of an angle in a unit. A multiple of a right angle, to the digits of the display, gives
 * an exact result, and its tangent has none where the cosine is 0.
 */
function circular(name: "sin" | "cos" | "tan", angle: number, unit: AngleMode): number {
  const turns = angle / TURNS[unit];
  const quarters = Number((turns * 4).toPrecision(DISPLAY_DIGITS));
  if (Number.isInteger(quarters)) {
    const index = ((quarters % 4) + 4) % 4;
    const sine = RIGHT_SINES[index] ?? 0;
    const cosine = RIGHT_COSINES[index] ?? 0;
    if (name === "sin") return sine;
    if (name === "cos") return cosine;
    return cosine === 0 ? Number.NaN : sine / cosine;
  }
  return Math[name]((turns % 1) * 2 * Math.PI);
}

/** A function of one number. */
type Unary = (value: number) => number;

/** The hyperbolic functions and their inverses, by the key of the circular function. */
const HYPERBOLIC: Readonly<Record<"sin" | "cos" | "tan", readonly [Unary, Unary]>> = {
  sin: [Math.sinh, Math.asinh],
  cos: [Math.cosh, Math.acosh],
  tan: [Math.tanh, Math.atanh],
};

/** The inverse circular functions, which give radians. */
const ARC: Readonly<Record<"sin" | "cos" | "tan", Unary>> = { sin: Math.asin, cos: Math.acos, tan: Math.atan };

/** Returns a trigonometric function, or its inverse, or the hyperbolic one, of the number on the display. */
function trigonometric(state: CalculatorState, name: "sin" | "cos" | "tan"): number {
  const { value, angle, inverse, hyperbolic } = state;
  if (hyperbolic) return HYPERBOLIC[name][inverse ? 1 : 0](value);
  if (!inverse) return circular(name, value, angle);
  return (ARC[name](value) / (2 * Math.PI)) * TURNS[angle];
}

/** The keys that change the number on the display by a function of it. */
type FunctionKey = Exclude<
  (typeof SCIENTIFIC_ONLY_KEYS)[number],
  "inverse" | "hyperbolic" | "open" | "close" | "pi" | "euler" | Operator
>;

/** Returns the function of a key of the scientific calculator applied to the number on the display. */
function applyFunction(state: CalculatorState, key: FunctionKey): number {
  const { value } = state;
  switch (key) {
    case "sin":
    case "cos":
    case "tan":
      return trigonometric(state, key);
    case "square":
      return value * value;
    case "cube":
      return value ** 3;
    case "cube-root":
      return Math.cbrt(value);
    case "log":
      return value > 0 ? Math.log10(value) : Number.NaN;
    case "ln":
      return value > 0 ? Math.log(value) : Number.NaN;
    case "ten-power":
      return 10 ** value;
    case "exp":
      return Math.exp(value);
    case "reciprocal":
      return 1 / value;
    case "factorial":
      return factorial(value);
  }
}

/** The state after an operation that had no number as its result; the memory and the unit of angle stay. */
function failed(state: CalculatorState): CalculatorState {
  return { ...INITIAL_STATE, ordered: state.ordered, angle: state.angle, memory: state.memory, error: true };
}

/** Shows a number as the result of an operation, or fails when there is none. */
function show(state: CalculatorState, result: number, phase: Phase): CalculatorState {
  return Number.isFinite(result) ? { ...state, display: formatNumber(result), value: result, phase } : failed(state);
}

/** Shows text that the candidate typed, which is the number too. */
function typed(state: CalculatorState, display: string): CalculatorState {
  return { ...state, display, value: Number(display), phase: "typing" };
}

function typeDigit(state: CalculatorState, digit: string): CalculatorState {
  if (state.phase !== "typing") return typed(state, digit);
  const sign = state.display.startsWith("-") ? "-" : "";
  const unsigned = state.display.slice(sign.length);
  if (unsigned === "0") return typed(state, sign + digit);
  if (unsigned.replace(".", "").length >= MAX_TYPED_DIGITS) return state;
  return typed(state, state.display + digit);
}

function typeDecimal(state: CalculatorState): CalculatorState {
  if (state.phase !== "typing") return typed(state, "0.");
  return state.display.includes(".") ? state : typed(state, `${state.display}.`);
}

/**
 * Runs the operations that wait inside the innermost parenthesis on the number given, as long as they bind at least as
 * tightly as an operation of `precedence`; 0 runs them all. Without order every operation binds alike.
 *
 * @returns The operations left and the result, which is NaN or infinite when an operation had no number as its result.
 */
function reduce(
  state: CalculatorState,
  value: number,
  precedence: number,
  fromRight: boolean,
): { readonly pending: readonly Pending[]; readonly value: number } {
  const pending = [...state.pending];
  let result = value;
  for (let last = pending.at(-1); last?.kind === "operation"; last = pending.at(-1)) {
    const bound = state.ordered ? PRECEDENCE[last.operator] : Number.POSITIVE_INFINITY;
    if (bound < precedence || (bound === precedence && fromRight)) break;
    result = operate(last.left, last.operator, result);
    pending.pop();
    if (!Number.isFinite(result)) break;
  }
  return { pending, value: result };
}

function pressOperator(state: CalculatorState, operator: Operator): CalculatorState {
  const last = state.pending.at(-1);
  if (state.phase === "operator" && last?.kind === "operation") {
    // The operation replaces the one pressed before it on the same left operand, so the operations that wait before it
    // run as they would have had it been pressed first: 2 × 3 ^ + is 6 +.
    return pressOperator({ ...state, pending: state.pending.slice(0, -1), value: last.left, phase: "value" }, operator);
  }
  const precedence = state.ordered ? PRECEDENCE[operator] : 1;
  const { pending, value } = reduce(state, state.value, precedence, state.ordered && FROM_RIGHT.has(operator));
  const shown = show({ ...state, pending }, value, "operator");
  return shown.error ? shown : { ...shown, pending: [...pending, { kind: "operation", left: value, operator }] };
}

/** Runs the operations that wait after the innermost open parenthesis, or all of them when none is open. */
function runGroup(state: CalculatorState): CalculatorState {
  const { pending, value } = reduce(state, state.value, 0, false);
  return show({ ...state, pending }, value, "value");
}

function pressEquals(state: CalculatorState): CalculatorState {
  let next = runGroup(state);
  while (!next.error && next.pending.length > 0) next = runGroup({ ...next, pending: next.pending.slice(0, -1) });
  return next;
}

/** Closes the innermost open parenthesis, if one is open, with the result of the operations inside it. */
function pressClose(state: CalculatorState): CalculatorState {
  if (!state.pending.some(({ kind }) => kind === "group")) return state;
  const inner = runGroup(state);
  return inner.error ? inner : { ...inner, pending: inner.pending.slice(0, -1) };
}

function changeSign(state: CalculatorState): CalculatorState {
  if (state.phase === "typing") {
    return typed(state, state.display.startsWith("-") ? state.display.slice(1) : `-${state.display}`);
  }
  return show(state, -state.value, "value");
}

/**
 * Percent as the standard calculator of desktop systems does it: after an addition or a subtraction the number is that
 * percent of the left operand, so that 200 + 10 % is 200 + 20; after a multiplication or a division, and with no
 * operation pending, it is divided by 100.
 */
function pressPercent(state: CalculatorState): CalculatorState {
  const last = state.pending.at(-1);
  const ofLeft =
    last?.kind === "operation" && (last.operator === "add" || last.operator === "subtract")
      ? (last.left * state.value) / 100
      : state.value / 100;
  return show(state, ofLeft, "value");
}

function pressMemory(state: CalculatorState, key: "memory-add" | "memory-subtract"): CalculatorState {
  const memory = roundForDisplay(key === "memory-add" ? state.memory + state.value : state.memory - state.value);
  // The number on the display stays, but the next digit starts another number.
  return { ...state, memory, phase: state.phase === "typing" ? "value" : state.phase };
}

/** An open parenthesis, which waits for the operations inside it. */
const GROUP: Pending = { kind: "group" };

/** Presses a key of the scientific calculator that the standard one lacks. */
function pressScientific(
  state: CalculatorState,
  key: Exclude<(typeof SCIENTIFIC_ONLY_KEYS)[number], Operator>,
): CalculatorState {
  switch (key) {
    case "inverse":
      return { ...state, inverse: !state.inverse };
    case "hyperbolic":
      return { ...state, hyperbolic: !state.hyperbolic };
    case "open":
      // A parenthesis starts a number of its own: what the display showed is not an operand.
      return { ...state, display: "0", value: 0, phase: "value", pending: [...state.pending, GROUP] };
    case "close":
      return pressClose(state);
    case "pi":
      return show(state, Math.PI, "value");
    case "euler":
      return show(state, Math.E, "value");
    default: {
      const shown = show(state, applyFunction(state, key), "value");
      return shown.error ? shown : { ...shown, inverse: false, hyperbolic: false };
    }
  }
}

/**
 * Presses a key.
 *
 * @remarks
 * The basic and standard calculators run operations as they are entered, from left to right, as a desktop calculator does,
 * so 2 + 3 × 4 = is 20. The scientific calculator follows the order of operations: powers and roots, then permutations and
 * combinations, then multiplication and division, then addition and subtraction, with parentheses, so 2 + 3 × 4 = is 14.
 * Each number keeps all its digits, and the display shows 12 significant digits. After an error only `clear` has an
 * effect, and it keeps the memory and the unit of angle.
 *
 * @param state - The calculator before the key.
 * @param key - The key.
 * @returns The calculator after the key.
 */
export function press(state: CalculatorState, key: CalculatorKey): CalculatorState {
  if (key === "clear") {
    return { ...INITIAL_STATE, ordered: state.ordered, angle: state.angle, memory: state.memory };
  }
  if (key === "memory-clear") return { ...state, memory: 0 };
  if (state.error) return state;
  if (isOperator(key)) return pressOperator(state, key);
  switch (key) {
    case "decimal":
      return typeDecimal(state);
    case "equals":
      return pressEquals(state);
    case "sign":
      return changeSign(state);
    case "square-root":
      return state.value < 0 ? failed(state) : show(state, Math.sqrt(state.value), "value");
    case "percent":
      return pressPercent(state);
    case "memory-recall":
      return show(state, state.memory, "value");
    case "memory-add":
    case "memory-subtract":
      return pressMemory(state, key);
    case "0":
    case "1":
    case "2":
    case "3":
    case "4":
    case "5":
    case "6":
    case "7":
    case "8":
    case "9":
      return typeDigit(state, key);
    default:
      return pressScientific(state, key);
  }
}

/**
 * Sets the unit of angle of the trigonometric functions.
 *
 * @param state - The calculator.
 * @param angle - The unit.
 * @returns The calculator in that unit; the number on the display stays.
 */
export function setAngle(state: CalculatorState, angle: AngleMode): CalculatorState {
  return { ...state, angle };
}

/** The symbol of each operation in the line of the calculation. */
const OPERATOR_SYMBOLS: Readonly<Record<Operator, string>> = {
  add: "+",
  subtract: "−",
  multiply: "×",
  divide: "÷",
  power: "^",
  root: "√",
  permutations: "P",
  combinations: "C",
};

/**
 * Writes the operations that wait as a line, such as `2 + 3 × (`, so that the candidate sees what the display will join.
 *
 * @param state - The calculator.
 * @returns The line, empty when nothing waits.
 */
export function calculation(state: CalculatorState): string {
  return state.pending
    .map((each) => (each.kind === "group" ? "(" : `${formatNumber(each.left)} ${OPERATOR_SYMBOLS[each.operator]}`))
    .join(" ");
}

/** The keys of a keyboard that stand for a key of the calculator, by `KeyboardEvent.key`. */
export const KEYBOARD_KEYS: ReadonlyMap<string, CalculatorKey> = new Map<string, CalculatorKey>([
  ...DIGIT_KEYS.map((digit): [string, CalculatorKey] => [digit, digit]),
  [".", "decimal"],
  [",", "decimal"],
  ["+", "add"],
  ["-", "subtract"],
  ["*", "multiply"],
  ["/", "divide"],
  ["=", "equals"],
  ["Enter", "equals"],
  ["%", "percent"],
  ["Escape", "clear"],
  ["Delete", "clear"],
  ["^", "power"],
  ["(", "open"],
  [")", "close"],
  ["!", "factorial"],
]);
