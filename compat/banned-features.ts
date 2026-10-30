/** A browser engine of the baseline, by the name Playwright gives it: Chromium, Firefox and Safari's WebKit. */
export type Engine = "chromium" | "firefox" | "webkit";

/** The oldest version of each engine that tempuh supports (docs/baseline.md), as `browser.version()` starts. */
export const BASELINE: Readonly<Record<Engine, string>> = { chromium: "111.", firefox: "115.", webkit: "16.4" };

/** A check in a page: an expression that is true where the engine has the feature. */
interface Probe {
  /** JavaScript for `page.evaluate`. */
  readonly expression: string;
  /** The engines of the baseline that lack the feature; the others have it. */
  readonly absentIn: readonly Engine[];
}

/** Code that `baseline.grit` or `baseline-css.grit` must report. */
interface Sample {
  /** `js` for a TypeScript file of the player, `css` for a stylesheet. */
  readonly language: "js" | "css";
  /** The code of a file. */
  readonly code: string;
}

/** A feature that the browser baseline excludes (AGENTS.md, "Browser baseline"). */
export interface BannedFeature {
  /** The name in the lint message and the table. */
  readonly feature: string;
  /** The first versions of Chromium, Firefox and Safari, or why there are none. */
  readonly first: string;
  /** What to write instead, as the lint message continues `Use`. */
  readonly instead: string;
  /** The features in `@mdn/browser-compat-data` that this row stands for. */
  readonly bcd: readonly string[];
  /** Checks that run in the pinned engines. */
  readonly probes: readonly Probe[];
  /** Code the lint must report. */
  readonly samples: readonly Sample[];
}

/** The message that the lint reports for a banned feature. */
export function lintMessage({ feature, instead }: BannedFeature): string {
  return `${feature}: outside the browser baseline (see docs/baseline.md). Use ${instead}.`;
}

const ALL_ENGINES: readonly Engine[] = ["chromium", "firefox", "webkit"];

export const BANNED_FEATURES: readonly BannedFeature[] = [
  {
    feature: "The Popover API",
    first: "114, 125, 17",
    instead: "a dialog, or an element that script positions",
    bcd: ["api.HTMLElement.showPopover", "api.HTMLElement.popover", "html.global_attributes.popover"],
    probes: [{ expression: '"popover" in HTMLElement.prototype', absentIn: ALL_ENGINES }],
    samples: [
      { language: "js", code: "export const a = element.showPopover();" },
      { language: "js", code: "export const a = element.togglePopover();" },
      { language: "js", code: 'element.popover = "auto";' },
      { language: "js", code: 'element.setAttribute("popover", "auto");' },
      { language: "css", code: "[popover] { color: red; }" },
      { language: "css", code: "dialog:popover-open { color: red; }" },
    ],
  },
  {
    feature: "CSS nesting",
    first: "112, 117, 16.5",
    instead: "flat selectors",
    bcd: ["css.selectors.nesting"],
    probes: [
      {
        expression: `(() => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(".a { .b { color: red; } }");
          return (sheet.cssRules[0]?.cssRules?.length ?? 0) > 0;
        })()`,
        absentIn: ALL_ENGINES,
      },
    ],
    samples: [
      { language: "css", code: ".a { .b { color: red; } }" },
      { language: "css", code: ".a { & .b { color: red; } }" },
      { language: "css", code: ".a { color: blue; @media (min-width: 1px) { color: red; } }" },
    ],
  },
  {
    feature: "The :has() selector",
    first: "105, 121, 15.4",
    instead: "a class that script sets",
    bcd: ["css.selectors.has"],
    probes: [{ expression: 'CSS.supports("selector(:has(a))")', absentIn: ["firefox"] }],
    samples: [
      { language: "css", code: "a:has(b) { color: red; }" },
      { language: "js", code: 'export const a = document.querySelector("a:has(b)");' },
      { language: "js", code: "export const a = `a:has(b) { color: red; }`;" },
    ],
  },
  {
    feature: "ARIA reflection through ElementInternals",
    first: "81, 119, 16.4",
    instead: "aria-* attributes",
    bcd: ["api.ElementInternals.ariaLabel"],
    probes: [
      {
        expression: 'typeof ElementInternals !== "undefined" && "ariaLabel" in ElementInternals.prototype',
        absentIn: ["firefox"],
      },
    ],
    samples: [
      { language: "js", code: 'internals.ariaLabel = "name";' },
      { language: "js", code: 'this.internals.role = "button";' },
    ],
  },
  {
    feature: "The RegExp v flag",
    first: "112, 116, 17",
    instead: "the u flag; author patterns go through compileXsdRegex",
    bcd: ["javascript.builtins.RegExp.unicodeSets"],
    probes: [
      {
        expression: '(() => { try { new RegExp("a", "v"); return true; } catch { return false; } })()',
        absentIn: ALL_ENGINES,
      },
    ],
    samples: [
      { language: "js", code: "export const a = /[\\p{L}--[a-z]]/v;" },
      { language: "js", code: 'export const a = new RegExp(pattern, "v");' },
      { language: "js", code: 'export const a = RegExp(pattern, "dv");' },
    ],
  },
  {
    feature: "Intl.Segmenter",
    first: "87, 125, 14.1",
    instead: "counters that count code points",
    bcd: ["javascript.builtins.Intl.Segmenter"],
    probes: [{ expression: 'typeof Intl.Segmenter === "function"', absentIn: ["firefox"] }],
    samples: [{ language: "js", code: 'export const a = new Intl.Segmenter("en");' }],
  },
  {
    feature: "Declarative shadow DOM (shadowrootmode)",
    first: "111, 123, 16.4",
    instead: "attachShadow",
    bcd: ["html.elements.template.shadowrootmode"],
    probes: [{ expression: '"shadowRootMode" in HTMLTemplateElement.prototype', absentIn: ["firefox"] }],
    samples: [{ language: "js", code: "export const a = '<template shadowrootmode=\"open\"></template>';" }],
  },
  {
    feature: "Object.groupBy, Map.groupBy and Promise.withResolvers",
    first: "117–119, 119–121, 17.4",
    instead: "plain loops",
    bcd: [
      "javascript.builtins.Object.groupBy",
      "javascript.builtins.Map.groupBy",
      "javascript.builtins.Promise.withResolvers",
    ],
    probes: [
      { expression: 'typeof Object.groupBy === "function"', absentIn: ALL_ENGINES },
      { expression: 'typeof Map.groupBy === "function"', absentIn: ALL_ENGINES },
      { expression: 'typeof Promise.withResolvers === "function"', absentIn: ALL_ENGINES },
    ],
    samples: [
      { language: "js", code: "export const a = Object.groupBy(items, key);" },
      { language: "js", code: "export const a = Map.groupBy(items, key);" },
      { language: "js", code: "export const a = Promise.withResolvers();" },
    ],
  },
  {
    feature: "CSS @scope, anchor positioning, text-wrap: balance and subgrid",
    first: "outside at least one engine",
    instead: "a shadow root to scope styles, script to position elements, and plain wrapping and grids",
    bcd: [
      "css.at-rules.scope",
      "css.properties.anchor-name",
      "css.properties.text-wrap.balance",
      "css.properties.grid-template-columns.subgrid",
    ],
    probes: [
      { expression: 'typeof CSSScopeRule !== "undefined"', absentIn: ALL_ENGINES },
      { expression: 'CSS.supports("anchor-name: --a")', absentIn: ALL_ENGINES },
      { expression: 'CSS.supports("text-wrap: balance")', absentIn: ALL_ENGINES },
      { expression: 'CSS.supports("grid-template-columns: subgrid")', absentIn: ["chromium"] },
    ],
    samples: [
      { language: "css", code: "@scope (.a) { b { color: red; } }" },
      { language: "css", code: ".a { anchor-name: --a; }" },
      { language: "css", code: ".a { position-area: top; }" },
      { language: "css", code: ".a { top: anchor(bottom); }" },
      { language: "css", code: ".a { text-wrap: balance; }" },
      { language: "css", code: ".a { grid-template-columns: subgrid; }" },
      { language: "js", code: 'export const a = ".a { text-wrap: balance; }";' },
    ],
  },
  {
    feature: "The ES2025 Set methods",
    first: "122, 127, 17",
    instead: "loops over the sets",
    bcd: [
      "javascript.builtins.Set.union",
      "javascript.builtins.Set.intersection",
      "javascript.builtins.Set.difference",
      "javascript.builtins.Set.symmetricDifference",
      "javascript.builtins.Set.isSubsetOf",
      "javascript.builtins.Set.isSupersetOf",
      "javascript.builtins.Set.isDisjointFrom",
    ],
    probes: [
      {
        expression:
          '["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"].every((name) => typeof Set.prototype[name] === "function")',
        absentIn: ALL_ENGINES,
      },
    ],
    samples: [
      { language: "js", code: "export const a = left.union(right);" },
      { language: "js", code: "export const a = left.intersection(right);" },
      { language: "js", code: "export const a = left.difference(right);" },
      { language: "js", code: "export const a = left.symmetricDifference(right);" },
      { language: "js", code: "export const a = left.isSubsetOf(right);" },
      { language: "js", code: "export const a = left.isSupersetOf(right);" },
      { language: "js", code: "export const a = left.isDisjointFrom(right);" },
    ],
  },
  {
    feature: "Iterator helpers",
    first: "122, 131, 18.4",
    instead: "an array: spread the iterator first",
    bcd: ["javascript.builtins.Iterator.from", "javascript.builtins.Iterator.map"],
    probes: [
      { expression: 'typeof Iterator === "function" && typeof Iterator.from === "function"', absentIn: ALL_ENGINES },
      {
        expression: 'typeof Iterator === "function" && typeof Iterator.prototype.map === "function"',
        absentIn: ALL_ENGINES,
      },
    ],
    samples: [
      { language: "js", code: "export const a = Iterator.from(items);" },
      { language: "js", code: "export const a = map.values().map(f);" },
      { language: "js", code: "export const a = set.keys().filter(f);" },
      { language: "js", code: "export const a = array.entries().toArray();" },
    ],
  },
  {
    feature: "Array.fromAsync",
    first: "121, 115, 16.4",
    instead: "for await",
    bcd: ["javascript.builtins.Array.fromAsync"],
    probes: [{ expression: 'typeof Array.fromAsync === "function"', absentIn: ["chromium"] }],
    samples: [{ language: "js", code: "export const a = Array.fromAsync(items);" }],
  },
  {
    feature: "AbortSignal.any",
    first: "116, 124, 17.4",
    instead: "one controller that each source signal aborts",
    bcd: ["api.AbortSignal.any_static"],
    probes: [{ expression: 'typeof AbortSignal.any === "function"', absentIn: ALL_ENGINES }],
    samples: [{ language: "js", code: "export const a = AbortSignal.any(signals);" }],
  },
  {
    feature: "text-wrap: pretty and @starting-style",
    first: "outside at least one engine",
    instead: "plain wrapping, and transitions without entry styles",
    bcd: ["css.properties.text-wrap.pretty", "css.at-rules.starting-style"],
    probes: [
      { expression: 'CSS.supports("text-wrap: pretty")', absentIn: ALL_ENGINES },
      { expression: 'typeof CSSStartingStyleRule !== "undefined"', absentIn: ALL_ENGINES },
    ],
    samples: [
      { language: "css", code: ".a { text-wrap: pretty; }" },
      { language: "css", code: "@starting-style { .a { opacity: 0; } }" },
      { language: "js", code: 'export const a = ".a { text-wrap: pretty; }";' },
    ],
  },
];
