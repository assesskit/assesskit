import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { type Inventory, isScoped } from "./inventory.ts";

/** A test or suite whose title names inventory rows or WCAG criteria. */
export interface TestReference {
  /** The path of the test file, relative to the repository root. */
  readonly file: string;
  /** The identifiers of the rows the title names. */
  readonly ids: readonly string[];
  /** The WCAG success criteria the title names, such as `3.2.4`. */
  readonly criteria: readonly string[];
}

/** What the tests cover and miss. */
export interface Coverage {
  /** The rows of merged units that no test names. */
  readonly missing: readonly string[];
  /** The identifiers that tests name and the inventory does not have. */
  readonly unknown: readonly { readonly id: string; readonly file: string }[];
}

const ROW_TAG = /\[([A-Z][1-9]\d*)\]/g;
const CRITERION_TAG = /\[SC (\d\.\d\.\d{1,2})\]/g;
const SKIPPED = new Set(["skip", "todo"]);
const TEST_FUNCTIONS = new Set(["it", "test", "describe"]);

/**
 * Returns the root identifier of a Vitest call's callee and the members read from it, so that `it.skipIf(c)` gives
 * `it` and `skipIf`, and `it.each(table)` gives `it` and `each`.
 */
function calleeOf(expression: ts.Expression): { name: string; members: string[] } | undefined {
  const members: string[] = [];
  let current = expression;
  for (;;) {
    if (ts.isIdentifier(current)) return { name: current.text, members };
    if (ts.isPropertyAccessExpression(current)) {
      members.push(current.name.text);
      current = current.expression;
    } else if (ts.isCallExpression(current)) {
      current = current.expression;
    } else {
      return undefined;
    }
  }
}

/** Returns the titles of the tests and suites of a test file that run: skipped and todo ones are left out. */
export function testTitles(file: string, text: string): string[] {
  const titles: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = calleeOf(node.expression);
      const title = node.arguments[0];
      const isTest = callee && TEST_FUNCTIONS.has(callee.name) && !callee.members.some((member) => SKIPPED.has(member));
      if (isTest && title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))) {
        titles.push(title.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  return titles;
}

/** Returns the identifiers a title names in brackets, such as `[A79]`. */
export function rowTags(title: string): string[] {
  return [...title.matchAll(ROW_TAG)].map((match) => match[1] ?? "");
}

/** Returns the success criteria a title names in brackets, such as `[SC 3.2.4]`. */
export function criterionTags(title: string): string[] {
  return [...title.matchAll(CRITERION_TAG)].map((match) => match[1] ?? "");
}

/** Returns the paths of the files named `*.test.ts` below a directory. */
function testFiles(directory: string): string[] {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".test.ts"))
    .map((path) => join(directory, path));
}

/**
 * Collects the row identifiers and the criteria that tests name, from the `test/` folders of some packages.
 *
 * @param root - The repository root.
 * @param packages - The packages whose tests count, relative to the root. Each inventory has its own packages, so that a
 * row identifier of one package is not read as a row of the other.
 */
export function collectReferences(root: string, packages: readonly string[]): TestReference[] {
  return packages
    .flatMap((name) => testFiles(join(root, name, "test")))
    .flatMap((path) => {
      const file = relative(root, path);
      const titles = testTitles(file, readFileSync(path, "utf8"));
      const ids = titles.flatMap(rowTags);
      const criteria = titles.flatMap(criterionTags);
      return ids.length + criteria.length === 0 ? [] : [{ file, ids, criteria }];
    });
}

/** Compares what tests name with the rows of the inventory: a row of a merged unit needs a test. */
export function checkCoverage(inventory: Inventory, references: readonly TestReference[]): Coverage {
  const known = new Set(inventory.rows.map((row) => row.id));
  const named = new Set(references.flatMap((reference) => reference.ids));
  const merged = new Set(inventory.merged);
  const missing = inventory.rows
    .filter((row) => isScoped(row) && merged.has(row.unit) && !named.has(row.id))
    .map((row) => row.id);
  const unknown = references.flatMap(({ file, ids }) => ids.filter((id) => !known.has(id)).map((id) => ({ id, file })));
  return { missing, unknown };
}
