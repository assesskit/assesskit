import { type CodePointRange, type CodePointSet, codePointSet } from "./code-point-set.js";
import { CATEGORY_RUNS } from "./unicode-categories.js";

/** Reads the runs of `CATEGORY_RUNS` into the code points of every two-letter category and every major class. */
function decodeCategories(runs: string): ReadonlyMap<string, CodePointSet> {
  const ranges = new Map<string, CodePointRange[]>();
  const add = (name: string, range: CodePointRange): void => {
    const list = ranges.get(name);
    if (list === undefined) ranges.set(name, [range]);
    else list.push(range);
  };
  let first = 0;
  for (const token of runs.split(" ")) {
    const range: CodePointRange = [first, first + Number.parseInt(token.slice(2), 36) - 1];
    add(token.slice(0, 2), range);
    add(token.slice(0, 1), range);
    first = range[1] + 1;
  }
  return new Map([...ranges].map(([name, list]) => [name, codePointSet(list)]));
}

const CATEGORIES = decodeCategories(CATEGORY_RUNS);

/**
 * Returns the code points of a general category or major class, such as `Lu` or `L`, or `undefined` for a name that is
 * neither. The major class `C` also holds the lone surrogates, category `Cs`, which a JavaScript string can contain.
 */
export function categorySet(name: string): CodePointSet | undefined {
  return CATEGORIES.get(name);
}
