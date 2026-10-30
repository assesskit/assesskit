import { relative } from "node:path";
import { ESLint } from "eslint";
import compat from "eslint-plugin-compat";
import stylelint from "stylelint";

/** The baseline of docs/baseline.md as browserslist queries. */
const BROWSERS = ["chrome >= 111", "firefox >= 115", "safari >= 16.4"];

/**
 * The CSS features that the stylelint plugin reports as partial although the baseline browsers have what the stylesheet
 * uses of them. `text-indent` is partial for its `each-line` and `hanging` keywords; a length works everywhere.
 */
const PARTIAL_BUT_USABLE = ["css-text-indent"];

/** The folders of the package whose code runs on a server, which the baseline does not cover. */
const SERVER_FOLDERS = ["server", "scoring", "cat", "lti", "caliper"];

/** A use of a feature that the baseline browsers lack. */
export interface BaselineProblem {
  /** The path of the file, relative to the package. */
  readonly file: string;
  /** The line, from 1. */
  readonly line: number;
  /** What the linter says. */
  readonly message: string;
}

/**
 * Lints the built JavaScript and the CSS of the package for features that the baseline browsers lack: the JavaScript with
 * eslint-plugin-compat and the CSS with stylelint-no-unsupported-browser-features, both on caniuse and MDN data.
 *
 * @param packageDirectory - The package whose `dist/` and `*.css` files to lint.
 * @returns the problems, and how many JavaScript files were linted, so that an empty `dist/` is not a pass.
 */
export async function lintBaseline(
  packageDirectory: string,
): Promise<{ readonly problems: readonly BaselineProblem[]; readonly scripts: number }> {
  const eslint = new ESLint({
    cwd: packageDirectory,
    overrideConfigFile: true,
    overrideConfig: [
      { ignores: SERVER_FOLDERS.map((folder) => `dist/${folder}/**`) },
      compat.configs["flat/recommended"],
      { settings: { browsers: BROWSERS } },
    ],
    errorOnUnmatchedPattern: false,
  });
  const scripts = await eslint.lintFiles(["dist/**/*.js"]);
  const styles = await stylelint.lint({
    cwd: packageDirectory,
    files: ["**/*.css"],
    ignorePattern: ["node_modules", "dist"],
    allowEmptyInput: true,
    configBasedir: import.meta.dirname,
    config: {
      plugins: ["stylelint-no-unsupported-browser-features"],
      rules: {
        "plugin/no-unsupported-browser-features": [
          true,
          { browsers: BROWSERS, ignore: PARTIAL_BUT_USABLE, severity: "error" },
        ],
      },
    },
  });
  const problems = [
    ...scripts.flatMap(({ filePath, messages }) =>
      messages.map(({ line, message }) => ({ file: relative(packageDirectory, filePath), line, message })),
    ),
    ...styles.results.flatMap(({ source, warnings }) =>
      warnings.map(({ line, text }) => ({ file: relative(packageDirectory, source ?? ""), line, message: text })),
    ),
  ];
  return { problems, scripts: scripts.length };
}
