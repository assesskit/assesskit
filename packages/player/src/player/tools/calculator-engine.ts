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

/** A key of the basic calculator or of the standard one. */
export type CalculatorKey = (typeof BASIC_KEYS)[number] | (typeof STANDARD_ONLY_KEYS)[number];

type Operator = "add" | "subtract" | "multiply" | "divide";

/**
 * What the display holds: digits the candidate is typing, a number that the calculator computed or recalled, or the
 * left operand after an operation key.
 */
type Phase = "typing" | "value" | "operator";

/** A calculator between two key presses. */
export interface CalculatorState {
  /** The number on the display, as text; `"0"` after an error. */
  readonly display: string;
  /** What the display holds; a digit extends the number only while the candidate is typing. */
  readonly phase: Phase;
  /** The left operand of the pending operation, or `null`. */
  readonly left: number | null;
  /** The pending operation, or `null`. */
  readonly operator: Operator | null;
  /** The number in the memory. */
  readonly memory: number;
  /** Whether the last operation had no number as its result (a division by zero, a square root of a negative number). */
  readonly error: boolean;
}

/** A calculator that has just been switched on. */
export const INITIAL_STATE: CalculatorState = {
  display: "0",
  phase: "value",
  left: null,
  operator: null,
  memory: 0,
  error: false,
};

/** The digits a number being typed can have, the width of the display. */
const MAX_TYPED_DIGITS = DISPLAY_DIGITS;

const OPERATORS: ReadonlySet<string> = new Set<Operator>(["add", "subtract", "multiply", "divide"]);

function isOperator(key: CalculatorKey): key is Operator {
  return OPERATORS.has(key);
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
  }
}

/** The state after an operation that had no number as its result; the memory stays. */
function failed(state: CalculatorState): CalculatorState {
  return { ...INITIAL_STATE, memory: state.memory, error: true };
}

/** Shows a number as the result of an operation, or fails when there is none. */
function show(state: CalculatorState, result: number, phase: Phase): CalculatorState {
  return Number.isFinite(result) ? { ...state, display: formatNumber(result), phase } : failed(state);
}

function typeDigit(state: CalculatorState, digit: string): CalculatorState {
  if (state.phase !== "typing") return { ...state, display: digit, phase: "typing" };
  const sign = state.display.startsWith("-") ? "-" : "";
  const unsigned = state.display.slice(sign.length);
  if (unsigned === "0") return { ...state, display: sign + digit };
  if (unsigned.replace(".", "").length >= MAX_TYPED_DIGITS) return state;
  return { ...state, display: state.display + digit };
}

function typeDecimal(state: CalculatorState): CalculatorState {
  if (state.phase !== "typing") return { ...state, display: "0.", phase: "typing" };
  return state.display.includes(".") ? state : { ...state, display: `${state.display}.` };
}

function pressOperator(state: CalculatorState, operator: Operator): CalculatorState {
  if (state.phase === "operator") return { ...state, operator };
  const value = Number(state.display);
  const left = state.left === null || state.operator === null ? value : operate(state.left, state.operator, value);
  const shown = show(state, left, "operator");
  return shown.error ? shown : { ...shown, left: roundForDisplay(left), operator };
}

function pressEquals(state: CalculatorState): CalculatorState {
  if (state.left === null || state.operator === null) {
    return { ...state, display: formatNumber(Number(state.display)), phase: "value" };
  }
  const shown = show(state, operate(state.left, state.operator, Number(state.display)), "value");
  return shown.error ? shown : { ...shown, left: null, operator: null };
}

function changeSign(state: CalculatorState): CalculatorState {
  if (state.phase === "typing") {
    return { ...state, display: state.display.startsWith("-") ? state.display.slice(1) : `-${state.display}` };
  }
  return show(state, -Number(state.display), "value");
}

/**
 * Percent as the standard calculator of desktop systems does it: after an addition or a subtraction the number is that
 * percent of the left operand, so that 200 + 10 % is 200 + 20; after a multiplication or a division, and with no
 * operation pending, it is divided by 100.
 */
function pressPercent(state: CalculatorState): CalculatorState {
  const value = Number(state.display);
  const ofLeft =
    state.left !== null && (state.operator === "add" || state.operator === "subtract")
      ? (state.left * value) / 100
      : value / 100;
  return show(state, ofLeft, "value");
}

function pressMemory(state: CalculatorState, key: "memory-add" | "memory-subtract"): CalculatorState {
  const value = Number(state.display);
  const memory = roundForDisplay(key === "memory-add" ? state.memory + value : state.memory - value);
  // The number on the display stays, but the next digit starts another number.
  return { ...state, memory, phase: state.phase === "typing" ? "value" : state.phase };
}

/**
 * Presses a key.
 *
 * @remarks
 * Operations run as they are entered, from left to right, as on a desktop calculator, so 2 + 3 × 4 = is 20. Results are
 * rounded to 12 significant digits. After an error only `clear` has an effect, and it keeps the memory.
 *
 * @param state - The calculator before the key.
 * @param key - The key.
 * @returns The calculator after the key.
 */
export function press(state: CalculatorState, key: CalculatorKey): CalculatorState {
  if (key === "clear") return { ...INITIAL_STATE, memory: state.memory };
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
    case "square-root": {
      const value = Number(state.display);
      return value < 0 ? failed(state) : show(state, Math.sqrt(value), "value");
    }
    case "percent":
      return pressPercent(state);
    case "memory-recall":
      return show(state, state.memory, "value");
    case "memory-add":
    case "memory-subtract":
      return pressMemory(state, key);
    default:
      return typeDigit(state, key);
  }
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
]);
