/** The budget of an interaction's module: the most its script may take after gzip, its other files, and the packages it holds. */
export interface ModuleBudget {
  /** The most that `<name>.js` may take after gzip at its best level, which is what a server sends, in bytes. */
  readonly gzip: number;
  /** The most that the files below `<name>/` may take together as they are, in bytes, as fonts are compressed already. */
  readonly files: number;
  /** The packages of `node_modules` whose code the script holds, by name, so that a new dependency fails until it is listed. */
  readonly holds: readonly string[];
}

/**
 * The budget of each module, built as `pnpm build` builds it: minified for the browsers of the player's baseline. A size is
 * 1.25 times the size measured, rounded up to the next 500 bytes, as the budgets of the player's entry points are
 * (docs/custom-interactions/architecture.md lists them). A budget changes only with the reason in the commit that changes it.
 */
export const MODULE_BUDGETS: Readonly<Record<string, ModuleBudget>> = {
  // 230,345 bytes, and 264,499 bytes of 20 fonts and their license, with MathLive 0.111.4.
  "math-entry": { gzip: 288_000, files: 331_000, holds: ["mathlive"] },
  // 13,159 bytes with Hanzi Writer 3.7.3; the reference strokes are the item's, never the module's.
  "stroke-writing": { gzip: 16_500, files: 0, holds: ["hanzi-writer"] },
};
