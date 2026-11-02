import type { Rule } from "./rule.ts";

/** The rules of the scripts of the repository that keep material out of it, each with the test that guards it. */
export const REPOSITORY_RULES: readonly Rule[] = [
  {
    rule: "A run of the official packages refuses a directory inside the repository, so that member-only material stays out of it.",
    file: "scripts/conformance.ts",
    find: "if (!outside) throw new Error(",
    replace: "if (false) throw new Error(",
    test: "scripts/test/conformance.test.ts",
  },
];
