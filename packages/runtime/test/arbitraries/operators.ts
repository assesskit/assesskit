import fc from "fast-check";

/** The tokens that the lines of the subset are built from: commands, symbols, numbers, letters and spacing. */
const TOKENS = [
  "x",
  "y",
  "e",
  "2",
  "3.5",
  "{,}",
  "\\pi",
  "\\alpha",
  "_1",
  "^",
  "^2",
  "+",
  "-",
  "\\cdot",
  "\\times",
  "/",
  "\\div",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "|",
  "\\left(",
  "\\right)",
  "\\left|",
  "\\right|",
  "\\frac",
  "\\frac12",
  "\\sqrt",
  "\\sqrt[3]",
  "\\sin",
  "\\ln",
  "\\log_2",
  "\\operatorname{lb}",
  "\\mathrm{e}",
  "sin(",
  "=",
  "<",
  "\\le",
  ",",
  "\\lor",
  "\\pm",
  "\\{",
  "\\}",
  "\\%",
  "^\\circ",
  "\\,",
  " ",
  "\\quad",
  "\\text{a}",
  "!",
  "\\",
];

/** Lines made of the subset's tokens in any order: most do not read, and each must be read or refused cleanly. */
export const lineOf = fc.array(fc.constantFrom(...TOKENS), { maxLength: 40 }).map((tokens) => tokens.join(""));

/** Any text of up to 200 characters, the subset's tokens among others. */
export const textOf = fc.oneof(fc.string({ maxLength: 200, unit: "grapheme" }), lineOf);

/** A small expression of the subset that reads. */
const termOf = fc
  .tuple(
    fc.constantFrom(
      "x",
      "2x",
      "\\frac{x}{3}",
      "\\sin x",
      "\\sqrt{x^2+1}",
      "e^{x}",
      "\\ln\\left|x\\right|",
      "x_1y",
      "\\pi",
    ),
    fc.constantFrom("", "^2", "^{3}"),
  )
  .map(([base, power]) =>
    power === "" || base.startsWith("\\") || base.includes("x_") ? base : `\\left(${base}\\right)${power}`,
  );

/** Two expressions of the subset that read. */
export const shapeOf = fc.tuple(termOf, termOf);

/** The hits of up to six points on up to six areas: the targets each point may take, and the count of areas. */
export const pointsOf = fc.integer({ min: 0, max: 6 }).chain((targets) =>
  fc.record({
    targets: fc.constant(targets),
    edges: fc.array(fc.uniqueArray(fc.integer({ min: 0, max: Math.max(0, targets - 1) }), { maxLength: targets }), {
      maxLength: 6,
    }),
  }),
);
