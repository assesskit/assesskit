import type { ItemSessionControl } from "../asi/index.js";
import { checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { ancestry, type ItemRefNode, type StructureNode } from "./structure.js";

/**
 * The item session control that applies to one item reference: the attributes of `qti-item-session-control` with the
 * values that inheritance and the defaults leave (INFO §5.6.10, §5.159.9, §4.2.11).
 */
export interface EffectiveSessionControl {
  /**
   * The most attempts; 0 is unlimited. Absent when no level sets it: the item decides, 1 for a non-adaptive item and
   * unlimited for an adaptive one (INFO §7.19.1).
   */
  readonly maxAttempts?: number;
  /** Whether the candidate sees integrated feedback after the last attempt (INFO §7.19.2). */
  readonly showFeedback: boolean;
  /** Whether the candidate may review the item after its session closed (INFO §7.19.3). */
  readonly allowReview: boolean;
  /** Whether the candidate may see the solution (INFO §7.19.4). */
  readonly showSolution: boolean;
  /** Whether the candidate may comment on the item (INFO §7.19.5). */
  readonly allowComment: boolean;
  /** Whether the candidate may skip the item (INFO §7.19.6). */
  readonly allowSkipping: boolean;
  /** Whether a submission needs valid responses (INFO §7.19.7). */
  readonly validateResponses: boolean;
}

/** The values of the attributes of `qti-item-session-control` that no level sets (INFO §7.19). */
const DEFAULT_SESSION_CONTROL: EffectiveSessionControl = {
  showFeedback: false,
  allowReview: true,
  showSolution: false,
  allowComment: false,
  allowSkipping: true,
  validateResponses: false,
};

/** Returns the control with the attributes that `control` sets in place of its own. */
function override(effective: EffectiveSessionControl, control: ItemSessionControl): EffectiveSessionControl {
  const maxAttempts = control.maxAttempts ?? effective.maxAttempts;
  return {
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    showFeedback: control.showFeedback ?? effective.showFeedback,
    allowReview: control.allowReview ?? effective.allowReview,
    showSolution: control.showSolution ?? effective.showSolution,
    allowComment: control.allowComment ?? effective.allowComment,
    allowSkipping: control.allowSkipping ?? effective.allowSkipping,
    validateResponses: control.validateResponses ?? effective.validateResponses,
  };
}

/** Returns the `qti-item-session-control` that a node carries, `undefined` when it has none: the test carries none. */
function controlOf(node: StructureNode): ItemSessionControl | undefined {
  return node.kind === "test" ? undefined : node.model.itemSessionControl;
}

/**
 * Returns the item session control of an item reference. The test part sets it first, then each section from the
 * outermost, then the reference itself; each level overrides the attributes it sets and leaves the others (INFO
 * §5.159.9, §4.2.11, §5.6.10). A section that ordering mixes into its parent still passes its control on to its items.
 * An attribute that no level sets has its default: `show-feedback`, `show-solution`, `allow-comment` and
 * `validate-responses` are false, `allow-review` and `allow-skipping` true.
 *
 * @param item - An item reference of a structure.
 * @throws `DataError` when `item` is not an item reference of `resolveStructure`.
 */
export function sessionControl(item: ItemRefNode): EffectiveSessionControl {
  checkRecord(item, "The item reference must be an object from resolveStructure");
  if (item.kind !== "item-ref") {
    throw new DataError(`The item reference must be a node of kind "item-ref", found the kind ${describe(item.kind)}.`);
  }
  return [...ancestry(item), item]
    .map(controlOf)
    .reduce<EffectiveSessionControl>(
      (effective, control) => (control === undefined ? effective : override(effective, control)),
      DEFAULT_SESSION_CONTROL,
    );
}
