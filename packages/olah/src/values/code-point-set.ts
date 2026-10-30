/** A range of Unicode code points, both ends included. */
export type CodePointRange = readonly [first: number, last: number];

/** A set of Unicode code points: ranges in ascending order, apart from each other and not adjacent. */
export type CodePointSet = readonly CodePointRange[];

/** The highest Unicode code point. */
export const MAX_CODE_POINT = 0x10ffff;

/** Returns the set of the code points in the ranges, which may overlap and come in any order. */
export function codePointSet(ranges: readonly CodePointRange[]): CodePointSet {
  const sorted = ranges.filter(([first, last]) => first <= last).toSorted((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [first, last] of sorted) {
    const previous = merged.at(-1);
    if (previous !== undefined && first <= previous[1] + 1) previous[1] = Math.max(previous[1], last);
    else merged.push([first, last]);
  }
  return merged;
}

/** Returns the code points in any of the sets. */
export function union(...sets: readonly CodePointSet[]): CodePointSet {
  return codePointSet(sets.flat());
}

/** Returns the code points, up to U+10FFFF, that are not in the set. */
export function complement(set: CodePointSet): CodePointSet {
  const gaps: CodePointRange[] = [];
  let next = 0;
  for (const [first, last] of set) {
    if (first > next) gaps.push([next, first - 1]);
    next = last + 1;
  }
  if (next <= MAX_CODE_POINT) gaps.push([next, MAX_CODE_POINT]);
  return gaps;
}

/** Returns the code points of the first set that are not in the second. */
export function subtract(set: CodePointSet, removed: CodePointSet): CodePointSet {
  return complement(union(complement(set), removed));
}

/** Returns whether a code point is in the set, by binary search. */
export function contains(set: CodePointSet, codePoint: number): boolean {
  let low = 0;
  let high = set.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = set[middle];
    if (range === undefined) return false;
    if (codePoint < range[0]) high = middle - 1;
    else if (codePoint > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}
