import type { InlineShortcutDefinition, InlineShortcutDefinitions } from "mathlive";

/**
 * What may come before the shortcut of a symbol for MathLive to apply it, as its defaults name them: nothing, a digit, a
 * function, a fraction, a root, an operator, a relation, punctuation, an array, a bracket, a space or text.
 */
const AFTER_SYMBOL = "nothing+digit+function+frac+surd+binop+relop+punct+array+openfence+closefence+space+text";

/**
 * MathLive's default shortcuts whose LaTeX the expression reader reads, each with the text that a candidate types, in
 * MathLive's order; `log` writes `\log` where MathLive writes `\log_{}`, which leaves the argument in the base.
 */
const SHORTCUTS: readonly (readonly [string, InlineShortcutDefinition])[] = [
  ["%", "\\%"],
  ["alpha", "\\alpha"],
  ["delta", "\\delta"],
  ["Delta", "\\Delta"],
  ["pi", "\\pi"],
  ["Pi", "\\Pi"],
  ["theta", "\\theta"],
  ["Theta", "\\Theta"],
  ["ee", { after: AFTER_SYMBOL, value: "\\exponentialE" }],
  ["deg", { after: "digit+space", value: "\\degree" }],
  ["sqrt", "\\sqrt{#?}"],
  ["sin", "\\sin"],
  ["cos", "\\cos"],
  ["tan", "\\tan"],
  ["arccos", "\\arccos"],
  ["arcsin", "\\arcsin"],
  ["arctan", "\\arctan"],
  ["cosh", "\\cosh"],
  ["cot", "\\cot"],
  ["csc", "\\csc"],
  ["sec", "\\sec"],
  ["sinh", "\\sinh"],
  ["tanh", "\\tanh"],
  ["lg", "\\lg"],
  ["lb", "\\operatorname{lb}"],
  ["log", "\\log"],
  ["ln", "\\ln"],
  ["exp", "\\exp"],
  ["sint", { after: AFTER_SYMBOL, value: "\\sin t" }],
  ["xx", "\\times"],
  ["+-", "\\pm"],
  ["≠", "\\ne"],
  ["!=", "\\ne"],
  ["≥", "\\ge"],
  [">=", "\\ge"],
  ["≤", "\\le"],
  ["<=", "\\le"],
  ["÷", "\\div"],
  ["beta", "\\beta"],
  ["chi", "\\chi"],
  ["epsilon", "\\epsilon"],
  ["varepsilon", "\\varepsilon"],
  ["eta", { after: AFTER_SYMBOL, value: "\\eta" }],
  ["gamma", "\\gamma"],
  ["Gamma", "\\Gamma"],
  ["iota", "\\iota"],
  ["kappa", "\\kappa"],
  ["lambda", "\\lambda"],
  ["Lambda", "\\Lambda"],
  ["mu", { after: AFTER_SYMBOL, value: "\\mu" }],
  ["nu", { after: AFTER_SYMBOL, value: "\\nu" }],
  ["µ", "\\mu"],
  ["phi", { after: AFTER_SYMBOL, value: "\\phi" }],
  ["Phi", { after: AFTER_SYMBOL, value: "\\Phi" }],
  ["varphi", "\\varphi"],
  ["psi", { after: AFTER_SYMBOL, value: "\\psi" }],
  ["Psi", { after: AFTER_SYMBOL, value: "\\Psi" }],
  ["rho", { after: AFTER_SYMBOL, value: "\\rho" }],
  ["sigma", "\\sigma"],
  ["Sigma", "\\Sigma"],
  ["tau", { after: AFTER_SYMBOL, value: "\\tau" }],
  ["vartheta", "\\vartheta"],
  ["upsilon", "\\upsilon"],
  [
    "xi",
    { after: "nothing+digit+function+frac+surd+binop+relop+punct+array+openfence+closefence+space", value: "\\xi" },
  ],
  ["Xi", { after: AFTER_SYMBOL, value: "\\Xi" }],
  ["zeta", "\\zeta"],
  ["omega", "\\omega"],
  ["Omega", "\\Omega"],
  ["Ω", "\\omega"],
  ["*", "\\cdot"],
  ["-:", "\\div"],
  ["divide", "\\div"],
  ["lt", "<"],
  ["lt=", "\\leq"],
  ["gt", ">"],
  ["gt=", "\\geq"],
  ["or", "\\lor"],
  ["times", "\\times"],
  ["frac", "\\frac{#?}{#?}"],
  ["cbrt", "\\sqrt[3]{#?}"],
  ["nthroot", "\\sqrt[#?]{#?}"],
];

/**
 * The inline shortcuts of the field. MathLive's other defaults are left out: they write what the reader does not read, such
 * as `\infty`, `\sum`, `\int`, `\imaginaryI` and the arrows.
 */
export const INLINE_SHORTCUTS: InlineShortcutDefinitions = Object.fromEntries(SHORTCUTS);
