import type { AssessmentItem, AssessmentItemRef } from "../asi/index.js";
import type { Value } from "../values/index.js";
import type { ItemVariables } from "./variables.js";

/**
 * The item sessions that an expression of outcome processing reads, by the attributes `section-identifier`,
 * `include-category` and `exclude-category` (INFO §7.27).
 */
export interface ItemSessionFilter {
  /** Only the item sessions in the section with this identifier, its sub-sections included. Default: every section. */
  readonly sectionIdentifier?: string;
  /** Only the item sessions whose item ref has one of these categories. Default: any category. */
  readonly includeCategories?: readonly string[];
  /** Only the item sessions whose item ref has none of these categories. Default: none excluded. */
  readonly excludeCategories?: readonly string[];
}

/** An item session as test-level expressions read it. */
export interface ItemSessionView {
  /** The item ref, whose weights and variable mappings apply to what is read through it (INFO §7.47.2, §7.48). */
  readonly ref: AssessmentItemRef;
  /** The item, whose declarations the expressions read. */
  readonly item: AssessmentItem;
  /** The variables of the session, with the last submitted responses (INFO §2.11.1.2). */
  readonly variables: ItemVariables;
}

/**
 * What expressions of a test read besides the test's outcomes: the item sessions and the variables of the test that are
 * not outcomes. The delivery engine implements it.
 */
export interface TestScope {
  /**
   * Returns the sessions of the selected item instances that the filter keeps, in test order: one per instance, so
   * that selection with replacement gives an item ref several (INFO §2.11.2).
   */
  itemSessions(filter: ItemSessionFilter): Iterable<ItemSessionView>;
  /**
   * Returns the session that a prefix names: `ITEM` in `ITEM.VAR`, with `instance` 2 for `ITEM.2.VAR`, the second
   * instance of an item ref selected with replacement (INFO §2.11.1.2); `undefined` when there is none.
   */
  itemSession(identifier: string, instance: number | undefined): ItemSessionView | undefined;
  /**
   * Returns the value of a variable of the test that is not an outcome: a context variable, `QTI_CONTEXT`, the
   * built-in `duration` of the test, or of a test part or section as `PART.duration` (INFO §2.2.2.1, §2.8.5), or NULL
   * for a variable of an item ref that has no session, such as one not selected; `undefined` when there is no such
   * variable.
   */
  variable(identifier: string): Value | null | undefined;
}
