import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import { drawIndex, type Random, shuffle } from "../random.js";
import type { ContentNode, SectionNode } from "./structure.js";

/** Whether a child must be selected (INFO §4.2.2): `required` on an item reference or a section. */
function isRequired(child: ContentNode): boolean {
  return child.model.required === true;
}

/**
 * Checks the number a selection asks for against the children it chooses from.
 *
 * @throws `DataError` when `select` is negative, is below the number of required children, is above the number of
 * children without replacement, or asks for children from a section that has none.
 */
function checkSelection(section: SectionNode, select: number, withReplacement: boolean, required: number): void {
  const count = section.children.length;
  const where = `The section ${describe(section.model.identifier)} selects ${select} of its ${count} children`;
  if (!Number.isSafeInteger(select) || select < 0) {
    throw new DataError(`${where}, but select must be a non-negative integer.`);
  }
  if (select < required) {
    throw new DataError(`${where}, but ${required} of them are required and must all be selected.`);
  }
  if (select > count && !withReplacement) {
    throw new DataError(`${where}, which only a selection with replacement may do.`);
  }
  if (select > 0 && count === 0) throw new DataError(`${where}, so there is nothing to select from.`);
}

/** Returns one copy of each required child and none of the others. */
function requiredCopies(children: readonly ContentNode[]): number[] {
  return children.map((child) => (isRequired(child) ? 1 : 0));
}

/** Returns how often each child is selected when `extra` draws follow the required children, each over all children. */
function copiesWithReplacement(children: readonly ContentNode[], extra: number, random: Random): number[] {
  const copies = requiredCopies(children);
  for (let draw = 0; draw < extra; draw++) {
    const place = drawIndex(random, children.length);
    copies[place] = (copies[place] ?? 0) + 1;
  }
  return copies;
}

/** Returns how often each child is selected when `extra` children that are not required join the required ones. */
function copiesWithoutReplacement(children: readonly ContentNode[], extra: number, random: Random): number[] {
  const copies = requiredCopies(children);
  const optional = children.flatMap((child, place) => (isRequired(child) ? [] : [place]));
  const drawn = extra < optional.length ? shuffle(optional, () => false, random).slice(0, extra) : optional;
  for (const place of drawn) copies[place] = 1;
  return copies;
}

/**
 * Selects the children of a section (INFO §5.129) by the procedure of G8, and returns them in document order, the
 * copies of a child that is selected more than once next to each other: selection never reorders, ordering does.
 *
 * - Without selection: every child.
 * - Without replacement: every required child, and a uniform subset of the others, drawn by shuffling the others with
 *   {@link shuffle} and taking the first places; no draw is taken when the subset is all of them. A section counts as
 *   one child (INFO §4.2.2).
 * - With replacement: every required child once, then `select` minus their number independent draws, each
 *   `drawIndex(random, n)` over all `n` children (INFO §5.129.2).
 *
 * @throws `DataError` when `select` is negative, is below the number of required children, is above the number of
 * children without replacement, or asks for children from a section that has none.
 */
export function selectChildren(section: SectionNode, random: Random): readonly ContentNode[] {
  const { children } = section;
  const { selection } = section.model;
  if (selection === undefined) return children;
  const { select, withReplacement = false } = selection;
  const required = children.filter(isRequired).length;
  checkSelection(section, select, withReplacement, required);
  const extra = select - required;
  const copies = withReplacement
    ? copiesWithReplacement(children, extra, random)
    : copiesWithoutReplacement(children, extra, random);
  return children.flatMap((child, place) => Array.from({ length: copies[place] ?? 0 }, () => child));
}
