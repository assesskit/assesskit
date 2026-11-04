/**
 * The Levenshtein distance between two sequences of code points, when it is at most `band`: insertions, deletions and
 * substitutions of one code point each cost 1. Only the cells within `band` of the diagonal are computed (Ukkonen's band), so
 * the cost is the length of the first sequence times 2 × `band` + 1, whatever the second.
 *
 * @returns The distance, or `undefined` when it is above `band`.
 * @see {@link https://doi.org/10.1016/S0019-9958(85)80046-2 | Ukkonen (1985), Algorithms for approximate string matching}
 */
export function boundedEditDistance(
  first: readonly number[],
  second: readonly number[],
  band: number,
): number | undefined {
  const rows = first.length;
  const columns = second.length;
  if (Math.abs(rows - columns) > band) return undefined;
  const width = 2 * band + 1;
  const beyond = band + 1;
  // A row holds the cells of columns row - band to row + band, at indexes 0 to 2 × band.
  let previous = new Int32Array(width).fill(beyond);
  let current = new Int32Array(width);
  for (let index = band; index < width && index - band <= columns; index += 1) previous[index] = index - band;
  for (let row = 1; row <= rows; row += 1) {
    if (fillRow(row, first, second, band, previous, current) > band) return undefined;
    [previous, current] = [current, previous];
  }
  const distance = previous[columns - rows + band] ?? beyond;
  return distance <= band ? distance : undefined;
}

/** Fills the cells of a row within the band, from the row above, and returns the least of them. */
function fillRow(
  row: number,
  first: readonly number[],
  second: readonly number[],
  band: number,
  previous: Int32Array,
  current: Int32Array,
): number {
  const beyond = band + 1;
  current.fill(beyond);
  let least = beyond;
  for (let index = 0; index < current.length; index += 1) {
    const column = row - band + index;
    if (column < 0 || column > second.length) continue;
    const cell = column === 0 ? row : cellOf(previous, current, index, first[row - 1] === second[column - 1]);
    current[index] = Math.min(cell, beyond);
    least = Math.min(least, cell);
  }
  return least;
}

/** A cell from its neighbors: a substitution or a match on the diagonal, a deletion above, an insertion to the left. */
function cellOf(previous: Int32Array, current: Int32Array, index: number, same: boolean): number {
  const diagonal = (previous[index] ?? 0) + (same ? 0 : 1);
  const above = index + 1 < previous.length ? (previous[index + 1] ?? 0) + 1 : diagonal + 1;
  const left = index > 0 ? (current[index - 1] ?? 0) + 1 : diagonal + 1;
  return Math.min(diagonal, above, left);
}
