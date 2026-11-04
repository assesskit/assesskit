import type { Rule } from "./rule.ts";

const INTERACTION = "packages/custom-interactions/src/math-entry/interaction.ts";
const BROWSER_TEST = "packages/custom-interactions/test/math-entry.browser.test.ts";
const STROKES = "packages/custom-interactions/src/stroke-writing/interaction.ts";
const STROKES_TEST = "packages/custom-interactions/test/stroke-writing.browser.test.ts";
const CHARACTER = "packages/custom-interactions/src/write-character-module.ts";

/** The rules of the custom interactions that decide what a candidate's response is, each with the test that guards it. */
export const CUSTOM_INTERACTION_RULES: readonly Rule[] = [
  {
    rule: "The files of a module go below a folder of the package in normal form, never outside the package.",
    file: "packages/custom-interactions/src/node/read-module-files.ts",
    find: "if (!isPackageFolder(directory)) {",
    replace: 'if (!isPackageFolder("")) {',
    test: "packages/custom-interactions/test/node.test.ts",
  },
  {
    rule: "The shortcut log writes \\log, so that the argument of a logarithm is not read as its base.",
    file: "packages/custom-interactions/src/math-entry/shortcuts.ts",
    find: '["log", "\\\\log"],',
    replace: '["log", "\\\\log_{#?}"],',
    test: "packages/custom-interactions/test/math-entry.test.ts",
  },
  {
    rule: "A field writes with the item's shortcuts, which write only what the reader reads.",
    file: INTERACTION,
    find: "inlineShortcuts: INLINE_SHORTCUTS,",
    replace: "",
    test: BROWSER_TEST,
    browser: true,
  },
  {
    rule: "A field takes no input when its status is closed, solution or review.",
    file: INTERACTION,
    find: "readOnly: !editable,",
    replace: "readOnly: false,",
    test: BROWSER_TEST,
    browser: true,
  },
  {
    rule: "An empty line of worked steps is no step, and an empty field no response.",
    file: INTERACTION,
    find: '.filter((value) => value !== "")',
    replace: ".filter(() => true)",
    test: BROWSER_TEST,
    browser: true,
  },
  {
    rule: "An item's decimal mark is . or , and any other starts no interaction.",
    file: INTERACTION,
    find: 'if (value !== "." && value !== ",") {',
    replace: "if (false) {",
    test: BROWSER_TEST,
    browser: true,
  },
  {
    rule: "A stroke drawn that does not match its reference stroke counts as a mistake.",
    file: STROKES,
    find: "onMistake: ({ strokeNum, totalMistakes }) => update({ strokes: strokeNum, mistakes: before + totalMistakes }),",
    replace: "onMistake: ({ strokeNum }) => update({ strokes: strokeNum, mistakes: before }),",
    test: STROKES_TEST,
    browser: true,
  },
  {
    rule: "A quiz that resumes keeps the mistakes made before it.",
    file: STROKES,
    find: "update({ strokes: strokeNum + 1, mistakes: before + totalMistakes }),",
    replace: "update({ strokes: strokeNum + 1, mistakes: totalMistakes }),",
    test: STROKES_TEST,
    browser: true,
  },
  {
    rule: "Before the first stroke, the response is NULL.",
    file: STROKES,
    find: "if (strokes === 0 && mistakes === 0) return { record: null };",
    replace: "",
    test: STROKES_TEST,
    browser: true,
  },
  {
    rule: "A character takes no stroke when its status is closed, solution or review.",
    file: STROKES,
    find: "const editable = takesInput(configuration.status) && progress.strokes < total;",
    replace: "const editable = progress.strokes < total;",
    test: STROKES_TEST,
    browser: true,
  },
  {
    rule: "The outline of a stroke is SVG path data and nothing else.",
    file: CHARACTER,
    find: 'v.regex(PATH_DATA, "a string of SVG path data")',
    replace: 'v.regex(/^/, "a string of SVG path data")',
    test: "packages/custom-interactions/test/stroke-writing.test.ts",
  },
  {
    rule: "A character has a median for each stroke.",
    file: CHARACTER,
    find: "({ strokes, medians }) => medians.length === strokes.length",
    replace: "() => true",
    test: "packages/custom-interactions/test/stroke-writing.test.ts",
  },
];
