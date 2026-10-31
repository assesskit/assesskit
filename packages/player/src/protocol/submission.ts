import { type BodyNode, checkScoringRubric, type ScoringRubric } from "@assesskit/runtime/asi";
import {
  describe,
  finiteSchema,
  nonEmptyStringSchema,
  parseWith,
  positiveIntegerSchema,
  recordSchema,
  transformWith,
} from "@assesskit/runtime/checks";
import type { ItemKey, Scorer, ScoringDeclaration } from "@assesskit/runtime/delivery";
import type { WireValue } from "@assesskit/runtime/values";
import * as v from "valibot";
import { SCORERS } from "./scorers.js";
import { declarationSchema } from "./scoring-declaration.js";

/** A value in a submission: the runtime's {@link WireValue}, which decodes without a declaration, or `null` for NULL. */
export type SubmissionValue = WireValue | null;

/** A variable of an item with its value, as an entry of a list so that an identifier such as `__proto__` stays data. */
export interface SubmissionVariable {
  /** The identifier of the variable. */
  readonly identifier: string;
  /** Its value. */
  readonly value: SubmissionValue;
}

/** One response that the outcome rates: a cover of the scoring request with what the candidate submitted. */
export interface SubmissionPart {
  /** The item instance the response belongs to; it names one of the `items` of the submission. */
  readonly item: ItemKey;
  /** The identifier of the response variable. */
  readonly responseIdentifier: string;
  /** The label of the cover in the test; absent when it has none. */
  readonly label?: string;
  /** Whether the candidate was presented the item; if not, `value` is NULL. */
  readonly presented: boolean;
  /** The kind of the interaction that binds the response, such as `extended-text-interaction`; absent when none does. */
  readonly interaction?: string;
  /** The last submitted response, exact. */
  readonly value: SubmissionValue;
}

/** An item instance that the outcome covers, as the candidate saw it and with what only a scorer sees. */
export interface SubmissionItem {
  /** The item instance. */
  readonly key: ItemKey;
  /** The title of the item. */
  readonly title: string;
  /** Whether the candidate was presented the item; if not, the body and the lists are empty. */
  readonly presented: boolean;
  /** The body after template processing, followed by the item's rubric blocks for the scorer. */
  readonly body: readonly BodyNode[];
  /** The template variables of the instance. */
  readonly templateValues: readonly SubmissionVariable[];
  /** The correct responses, one entry for each response variable of the item. */
  readonly correctResponses: readonly SubmissionVariable[];
}

/** A score that a scorer supplied earlier. */
export interface SubmissionSupplied {
  /** The value of the outcome, or NULL. */
  readonly value: SubmissionValue;
  /** When it was supplied, in epoch milliseconds. */
  readonly at: number;
  /** Who supplied it. */
  readonly scorer: Scorer;
}

/**
 * What a scorer needs to rate one externally scored outcome, in a form that is JSON text as it is: the request, its
 * declaration, the rubric and the scoring rubric, the responses that the outcome rates and the items they belong to.
 *
 * @remarks
 * It holds the correct responses of the items, so it goes only to authorized raters.
 */
export interface Submission {
  /** The identifier of the scoring request, which `toSupplyScores` answers. */
  readonly request: string;
  /** The identifier of the outcome. */
  readonly outcome: string;
  /** Who is to score it. */
  readonly mode: Scorer;
  /** The `variable-identifier-ref` of the outcome's declaration; absent when it has none. */
  readonly variableIdentifierRef?: string;
  /** `true` when the item is a link to a tool; absent otherwise. */
  readonly lti?: true;
  /** The declaration of the outcome. */
  readonly declaration: ScoringDeclaration;
  /** When the request was made, in epoch milliseconds. */
  readonly requestedAt: number;
  /** The score supplied earlier; absent while the request is pending. */
  readonly supplied?: SubmissionSupplied;
  /** The rubric of the scorer view. */
  readonly rubric: readonly BodyNode[];
  /** The scoring rubric of the outcome, which a rating form shows; absent when the outcome has none. */
  readonly scoringRubric?: ScoringRubric;
  /** The responses the outcome rates, in the order of the covers. */
  readonly parts: readonly SubmissionPart[];
  /** The item instances the outcome covers, each once, in the order of the covers. */
  readonly items: readonly SubmissionItem[];
}

/**
 * The first and the last time that a submission may carry: `0001-01-01T00:00:00.000Z` and `9999-12-31T23:59:59.999Z` in
 * epoch milliseconds, the range of the runtime's times, so that every time has a four-digit year in a datestamp.
 */
const FIRST_INSTANT = -62_135_596_800_000;
const LAST_INSTANT = 253_402_300_799_999;

/** A time of a submission: epoch milliseconds that a datestamp with a four-digit year can show. */
const instantSchema = v.pipe(finiteSchema, v.minValue(FIRST_INSTANT), v.maxValue(LAST_INSTANT));

const optionalString = v.optional(v.string());

/** A value: NULL or an object, which `fromWireValue` of the runtime reads when the value is shown. */
const valueSchema = v.nullable(recordSchema);

/** A scoring rubric: an object that `checkScoringRubric` of the runtime accepts. */
const scoringRubricSchema = v.pipe(
  recordSchema,
  transformWith((value) => {
    checkScoringRubric(value);
    return value;
  }),
);

/** The nodes of content: an array of objects that each have a `kind`. */
const nodesSchema = v.array(v.looseObject({ kind: v.string() }));

const itemKeySchema = v.strictObject({ ref: nonEmptyStringSchema, instance: positiveIntegerSchema });

/** A list of variables, as entries so that an identifier such as `__proto__` stays data. */
const variablesSchema = v.array(v.strictObject({ identifier: v.string(), value: valueSchema }));

const partSchema = v.strictObject({
  item: itemKeySchema,
  responseIdentifier: v.string(),
  label: optionalString,
  presented: v.boolean(),
  interaction: optionalString,
  value: valueSchema,
});

const itemSchema = v.strictObject({
  key: itemKeySchema,
  title: v.string(),
  presented: v.boolean(),
  body: nodesSchema,
  templateValues: variablesSchema,
  correctResponses: variablesSchema,
});

/** Whether two keys name the same item instance. */
const sameKey = (a: ItemKey, b: ItemKey): boolean => a.ref === b.ref && a.instance === b.instance;

const submissionShape = v.strictObject({
  request: nonEmptyStringSchema,
  outcome: nonEmptyStringSchema,
  mode: v.picklist(SCORERS),
  variableIdentifierRef: optionalString,
  lti: v.optional(v.literal(true)),
  declaration: declarationSchema,
  requestedAt: instantSchema,
  supplied: v.optional(v.strictObject({ value: valueSchema, at: instantSchema, scorer: v.picklist(SCORERS) })),
  rubric: nodesSchema,
  scoringRubric: v.optional(scoringRubricSchema),
  parts: v.array(partSchema),
  items: v.array(itemSchema),
});

const submissionSchema = v.pipe(
  submissionShape,
  v.rawCheck<v.InferOutput<typeof submissionShape>>(({ dataset, addIssue }) => {
    if (!dataset.typed) return;
    const { items, parts } = dataset.value;
    items.forEach(({ key }, index) => {
      if (items.slice(0, index).some((other) => sameKey(other.key, key))) {
        addIssue({ message: `has the item ${describe(key.ref)} instance ${key.instance} twice` });
      }
    });
    for (const { item } of parts) {
      if (!items.some(({ key }) => sameKey(key, item))) {
        addIssue({
          message: `A part names the item ${describe(item.ref)} instance ${item.instance}, which the submission lacks`,
        });
      }
    }
  }),
);

/**
 * Checks a submission that arrived as JSON: every property of its form and no other, the type of every field, the content
 * as nodes, the scoring rubric as the runtime's `checkScoringRubric` does, and that each part names an item the submission
 * has, which it has once.
 *
 * @remarks
 * A value is read when it is shown, not here.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` when it is not a submission.
 */
export function checkSubmission(value: unknown): asserts value is Submission {
  parseWith(submissionSchema, value, "A submission");
}
