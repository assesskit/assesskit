import type { VirtualKeyboardKeycap, VirtualKeyboardLayout } from "mathlive";

/** A key of the virtual keyboard, as MathLive takes it. */
type Keycap = Partial<VirtualKeyboardKeycap>;

/** The decimal mark that an item uses: the point, or the comma that MathLive writes as `{,}`. */
export type DecimalSeparator = "." | ",";

/** A key that writes LaTeX, shows it, and writes `shift` with the shift key down. */
const key = (latex: string, shift?: string): Keycap =>
  shift === undefined ? { latex, class: "hide-shift" } : { latex, shift: { latex: shift }, class: "hide-shift" };

/** A key that writes LaTeX under a label of its own. */
const labeled = (label: string, insert: string, shift?: string): Keycap => ({
  label,
  insert,
  class: "hide-shift",
  ...(shift === undefined ? {} : { shift: { latex: shift } }),
});

/** A key that writes a function name, shown upright as MathLive shows it in a formula. */
const named = (latex: string): Keycap => ({ latex, class: "small hide-shift" });

const SEPARATOR = "[separator-5]";
const DIGIT = (digit: string): Keycap => key(digit);

/** The key of the decimal mark, which writes the item's mark: `.`, or `{,}` after a digit with a comma. */
const decimalKey = (separator: DecimalSeparator): Keycap => ({
  label: separator,
  command: "performWithFeedback(insertDecimalSeparator)",
  class: "big-op hide-shift",
});

/**
 * The keyboard of numbers and operators: digits, the decimal mark, `+ − × ÷`, the templates of a fraction, a power, a square
 * and an n-th root, brackets and bars, `π`, `e`, `%`, `°`, `±`, the relations and the comma, with the keys that move and
 * delete. A list separates its values with `;` when the decimal mark is the comma, so the comma's shifted key writes it.
 */
function numbers(separator: DecimalSeparator): VirtualKeyboardLayout {
  return {
    id: "numbers",
    label: "123",
    rows: [
      [
        key("x", "X"),
        key("y", "Y"),
        SEPARATOR,
        DIGIT("7"),
        DIGIT("8"),
        DIGIT("9"),
        key("\\div"),
        SEPARATOR,
        labeled("a/b", "\\frac{#@}{#?}"),
        key("#@^{2}"),
        key("#@^{#?}"),
        key("\\pi"),
      ],
      [
        key("(", "["),
        key(")", "]"),
        SEPARATOR,
        DIGIT("4"),
        DIGIT("5"),
        DIGIT("6"),
        key("\\times", "\\cdot"),
        SEPARATOR,
        key("\\sqrt{#0}"),
        key("\\sqrt[#?]{#0}"),
        key("\\left|#0\\right|"),
        key("\\exponentialE"),
      ],
      [
        key("<", "\\le"),
        key(">", "\\ge"),
        SEPARATOR,
        DIGIT("1"),
        DIGIT("2"),
        DIGIT("3"),
        key("-"),
        SEPARATOR,
        key("\\%"),
        key("\\degree"),
        key("\\pm"),
        separator === "," ? key(",", ";") : key(","),
      ],
      [
        { label: "[shift]", width: 2 },
        SEPARATOR,
        DIGIT("0"),
        decimalKey(separator),
        key("=", "\\ne"),
        key("+"),
        SEPARATOR,
        "[left]",
        "[right]",
        { label: "[backspace]", width: 2 },
      ],
    ],
  };
}

/** The keyboard of the functions that the reader takes. */
const FUNCTIONS: VirtualKeyboardLayout = {
  id: "functions",
  label: "f(x)",
  rows: [
    [named("\\sin"), named("\\cos"), named("\\tan"), named("\\sec"), named("\\csc"), named("\\cot")],
    [named("\\arcsin"), named("\\arccos"), named("\\arctan"), named("\\sinh"), named("\\cosh"), named("\\tanh")],
    [named("\\exp"), named("\\ln"), named("\\log"), named("\\log_{#?}"), named("\\lg"), key("(", "[")],
    ["[left]", "[right]", key(")", "]"), { label: "[backspace]", width: 2 }],
  ],
};

/** A row of letters, each writing its capital with the shift key down. */
const letters = (row: string): Keycap[] => [...row].map((letter) => key(letter, letter.toUpperCase()));

/** The keyboard of the Latin letters, in the order of a QWERTY keyboard. */
const LATIN: VirtualKeyboardLayout = {
  id: "latin",
  label: "abc",
  rows: [
    letters("qwertyuiop"),
    [SEPARATOR, ...letters("asdfghjkl")],
    [{ label: "[shift]", width: 1.5 }, ...letters("zxcvbnm"), { label: "[backspace]", width: 1.5 }],
    ["[left]", "[right]"],
  ],
};

/** A Greek letter, with its capital where LaTeX has a command for it. */
const greek = (name: string, capital?: string): Keycap =>
  key(`\\${name}`, capital === undefined ? undefined : `\\${capital}`);

/** The keyboard of the Greek letters that the reader takes. */
const GREEK: VirtualKeyboardLayout = {
  id: "greek",
  label: "αβγ",
  rows: [
    [
      greek("alpha"),
      greek("beta"),
      greek("gamma", "Gamma"),
      greek("delta", "Delta"),
      greek("epsilon"),
      greek("varepsilon"),
      greek("zeta"),
      greek("eta"),
      greek("theta", "Theta"),
      greek("vartheta"),
    ],
    [
      greek("iota"),
      greek("kappa"),
      greek("lambda", "Lambda"),
      greek("mu"),
      greek("nu"),
      greek("xi", "Xi"),
      greek("pi", "Pi"),
      greek("rho"),
      greek("sigma", "Sigma"),
      greek("tau"),
    ],
    [
      { label: "[shift]", width: 1.5 },
      greek("upsilon", "Upsilon"),
      greek("phi", "Phi"),
      greek("varphi"),
      greek("chi"),
      greek("psi", "Psi"),
      greek("omega", "Omega"),
      { label: "[backspace]", width: 1.5 },
    ],
    ["[left]", "[right]"],
  ],
};

/**
 * The layouts of the virtual keyboard: numbers and operators, functions, Latin letters and Greek letters, each key writing
 * LaTeX that the expression reader of `@assesskit/runtime/operators` reads.
 *
 * @param separator - The item's decimal mark.
 * @returns The layouts, in the order of their tabs.
 */
export function buildKeyboardLayouts(separator: DecimalSeparator): readonly VirtualKeyboardLayout[] {
  return [numbers(separator), FUNCTIONS, LATIN, GREEK];
}
