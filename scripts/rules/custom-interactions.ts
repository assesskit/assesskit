import type { Rule } from "./rule.ts";

const INTERACTION = "packages/custom-interactions/src/math-entry/interaction.ts";
const BROWSER_TEST = "packages/custom-interactions/test/math-entry.browser.test.ts";

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
];
