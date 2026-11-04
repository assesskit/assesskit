import type { AssessmentItem } from "../asi/index.js";
import { isShown } from "../content/internal.js";
import { ProcessingError } from "../errors.js";
import {
  type CustomOperator,
  createItemVariables,
  type ItemVariables,
  runResponseProcessing,
} from "../processing/index.js";
import { createRandom } from "../random.js";
import type { Value } from "../values/index.js";
import type { XmlElement } from "../xml/index.js";

// A writer learns an item's scoring and feedback by running its response processing on the responses that matter, as a
// delivery engine would, rather than by reading the shape of its rules: any rule the runtime runs converts the same way.

/** Feedback of an item that an outcome shows: modal feedback, or feedback in its body. */
export interface FeedbackElement {
  readonly element: XmlElement;
  readonly outcome: string;
  readonly identifier: string;
  readonly showHide: "show" | "hide" | undefined;
}

/** What response processing gives for one response. */
export interface ProbeResult {
  /** `SCORE`, or `null` when it is NULL or the item has none. */
  readonly score: number | null;
  /** The positions of the feedback that the outcomes show, in the order of the item's feedback. */
  readonly shown: readonly number[];
}

/** Runs an item's response processing on single responses of one variable. */
export interface Probe {
  /** Returns the score and the feedback shown for a response, the other responses being NULL. */
  run(response: Value | null): ProbeResult;
}

/** Returns a number that a value holds, or `null`. */
function numberOf(value: Value | null | undefined): number | null {
  if (value === null || value === undefined || value.cardinality !== "single") return null;
  return typeof value.value === "number" ? value.value : null;
}

/**
 * Creates a probe of the response processing of an item.
 *
 * @param item - The item.
 * @param response - The identifier of the response that the probe sets.
 * @param feedback - The feedback elements of the item.
 * @param customOperators - The custom operators that its processing calls.
 */
export function createProbe(
  item: AssessmentItem,
  response: string,
  feedback: readonly FeedbackElement[],
  customOperators: ReadonlyMap<string, CustomOperator>,
): Probe {
  const variables: ItemVariables = createItemVariables(item);
  return {
    run(value) {
      const responses = new Map(variables.responses).set(response, value);
      const after = runResponseProcessing(
        item,
        { ...variables, responses },
        { random: createRandom(0), customOperators },
      );
      const shown: number[] = [];
      for (const [index, { outcome, identifier, showHide }] of feedback.entries()) {
        if (isShown(showHide, identifier, after.outcomes.get(outcome) ?? null)) shown.push(index);
      }
      return { score: numberOf(after.outcomes.get("SCORE")), shown };
    },
  };
}

/** Whether an error is one that response processing raises on an item, as opposed to a defect of the caller. */
export function isProcessingFailure(error: unknown): error is ProcessingError {
  return error instanceof ProcessingError;
}
