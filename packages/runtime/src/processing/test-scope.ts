import type { AssessmentItem, AssessmentItemRef } from "../asi/index.js";
import type { Value } from "../values/index.js";
import type { ItemVariables } from "./variables.js";

/**
 * The item sessions that an expression of outcome processing reads, by the attributes `section-identifier`,
 * `include-category` and `exclude-category`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export interface ItemSessionFilter {
  /**
   * Only the item sessions in the section with this identifier, its sub-sections included.
   *
   * @defaultValue every section
   */
  readonly sectionIdentifier?: string;
  /**
   * Only the item sessions whose item ref has one of these categories.
   *
   * @defaultValue any category
   */
  readonly includeCategories?: readonly string[];
  /**
   * Only the item sessions whose item ref has none of these categories.
   *
   * @defaultValue none excluded
   */
  readonly excludeCategories?: readonly string[];
}

/** An item session as test-level expressions read it. */
export interface ItemSessionView {
  /** The item ref, whose weights and variable mappings apply to what is read through it. */
  readonly ref: AssessmentItemRef;
  /** The item, whose declarations the expressions read. */
  readonly item: AssessmentItem;
  /** The variables of the session, with the last submitted responses. */
  readonly variables: ItemVariables;
}

/**
 * What expressions of a test read besides the test's outcomes: the item sessions and the variables of the test that are
 * not outcomes.
 *
 * @remarks
 * The delivery engine implements it.
 */
export interface TestScope {
  /**
   * Returns the sessions of the selected item instances that the filter keeps, in test order: one per instance, so that
   * selection with replacement gives an item ref several.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  itemSessions(filter: ItemSessionFilter): Iterable<ItemSessionView>;
  /**
   * Returns the session that a prefix names: `ITEM` in `ITEM.VAR`, with `instance` 2 for `ITEM.2.VAR`, the second
   * instance of an item ref selected with replacement; `undefined` when there is none.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  itemSession(identifier: string, instance: number | undefined): ItemSessionView | undefined;
  /**
   * Returns the value of a variable of the test that is not an outcome: a context variable, `QTI_CONTEXT`, the built-in
   * `duration` of the test, or of a test part or section as `PART.duration`, or NULL for a variable of an item ref that
   * has no session, such as one not selected; `undefined` when there is no such variable.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  variable(identifier: string): Value | null | undefined;
}
