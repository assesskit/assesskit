import { html } from "../internal.js";

/** The glyph that shows each sort state of `aria-sort`: a column that is not sorted has the last one. */
const MARKS: ReadonlyMap<string, string> = new Map([
  ["ascending", "▲"],
  ["descending", "▼"],
]);
const UNSORTED_MARK = "↕";

/** A decimal number as a key: a sign, digits with or without a point, and an exponent. */
const NUMBER_KEY = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** The interactions that a move in the page ends: a recording stops, an upload lets go of the microphone, and a frame loads again. */
const RESTARTED_BY_A_MOVE =
  "qti-media-interaction, qti-upload-interaction, qti-custom-interaction, qti-portable-custom-interaction";

const markOf = (state: string | null): string => MARKS.get(state ?? "") ?? UNSORTED_MARK;

/** Returns the cell of a row at a column, counting the columns that a `colspan` takes. */
function cellAt(row: HTMLTableRowElement, column: number): HTMLTableCellElement | undefined {
  let start = 0;
  for (const cell of row.cells) {
    start += cell.colSpan;
    if (start > column) return cell;
  }
  return undefined;
}

/** Returns the column at which a cell of a row starts. */
function columnOf(cell: HTMLTableCellElement): number {
  let column = 0;
  for (const before of cell.parentElement instanceof HTMLTableRowElement ? cell.parentElement.cells : []) {
    if (before === cell) break;
    column += before.colSpan;
  }
  return column;
}

/** Returns the key that a cell sorts by: its `data-ak-sort-value`, else its text. */
const keyOf = (cell: HTMLTableCellElement | undefined): string =>
  (cell?.getAttribute("data-ak-sort-value") ?? cell?.textContent ?? "").trim();

/** Returns a collator that puts the numbers inside text in order, for a language; a tag that `Intl` does not accept gives English. */
function collatorFor(language: string | undefined): Intl.Collator {
  try {
    return new Intl.Collator(language, { numeric: true });
  } catch {
    return new Intl.Collator("en", { numeric: true });
  }
}

/** Returns the order of the keys of a column: by value when each one is a number, else by the collation of the language. */
function comparison(keys: readonly string[], language: string | undefined): (a: string, b: string) => number {
  if (!keys.every((key) => NUMBER_KEY.test(key))) return collatorFor(language).compare;
  return (a, b) => {
    const [x, y] = [Number(a), Number(b)];
    return x === y ? 0 : x < y ? -1 : 1;
  };
}

/** Returns the `tbody` of a table that can be sorted, or `undefined` for a table that stays as authored. */
function sortableBody(table: HTMLTableElement): HTMLTableSectionElement | undefined {
  const [body, ...others] = table.tBodies;
  const spanning = [...table.querySelectorAll<HTMLTableCellElement>("th, td")].some((cell) => cell.rowSpan !== 1);
  return body === undefined || others.length > 0 || spanning || body.querySelector(RESTARTED_BY_A_MOVE) !== null
    ? undefined
    : body;
}

/** Sorts the rows of a body by the column of a header and marks the headers; `direction` is 1 for ascending, -1 for descending. */
function sortBy(
  table: HTMLTableElement,
  body: HTMLTableSectionElement,
  header: HTMLTableCellElement,
  direction: 1 | -1,
): void {
  const column = columnOf(header);
  const rows = [...body.rows];
  const keys = new Map(rows.map((row) => [row, keyOf(cellAt(row, column))]));
  const compare = comparison([...keys.values()], header.closest("[lang]")?.getAttribute("lang") ?? undefined);
  rows.sort((a, b) => direction * compare(keys.get(a) ?? "", keys.get(b) ?? ""));
  body.append(...rows);
  for (const each of table.tHead?.querySelectorAll("th[aria-sort]") ?? []) {
    const state = each !== header ? "none" : direction === 1 ? "ascending" : "descending";
    each.setAttribute("aria-sort", state);
    const mark = each.querySelector(".ak-sort-mark");
    if (mark !== null) mark.textContent = markOf(state);
  }
}

/**
 * Lets the candidate sort the tables of rendered content by a column.
 *
 * @remarks
 * A `th` of the `thead` with `aria-sort` gets a `button` around its content. A press sorts the rows of the `tbody`, stably,
 * ascending first and then descending, and sets `aria-sort` on that header and `none` on the others; the focus stays on the
 * button. The rows keep their nodes, so what an interaction in a row holds stays. The key of a row is the `data-ak-sort-value`
 * of its cell, else the text of the cell. The keys of a column are numbers when each one reads as a decimal number; otherwise
 * they are compared by the collation of the language of the content, with the numbers inside text in order. A table with a
 * `rowspan`, with more than one `tbody`, or with an interaction that a move would restart in its rows, stays as authored.
 *
 * @param container - The rendered content.
 * @see {@link https://www.w3.org/WAI/ARIA/apg/patterns/table/examples/sortable-table/ | WAI-ARIA Authoring Practices, Sortable Table}
 */
export function enableSorting(container: Element): void {
  for (const table of container.querySelectorAll("table")) {
    const headers = [...(table.tHead?.querySelectorAll<HTMLTableCellElement>("th[aria-sort]") ?? [])];
    const body = sortableBody(table);
    if (headers.length === 0 || body === undefined) continue;
    for (const header of headers) {
      const mark = html(
        "span",
        { class: "ak-sort-mark", "aria-hidden": "true" },
        markOf(header.getAttribute("aria-sort")),
      );
      const button = html("button", { type: "button", class: "ak-sort" }, ...header.childNodes, mark);
      header.replaceChildren(button);
      button.addEventListener("click", () => {
        sortBy(table, body, header, header.getAttribute("aria-sort") === "ascending" ? -1 : 1);
      });
    }
  }
}
