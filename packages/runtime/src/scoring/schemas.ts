import * as v from "valibot";
import { fitsCoordinateCount } from "../asi/index.js";
import {
  finiteSchema,
  isRecord,
  mapSchema,
  positiveIntegerSchema,
  positiveSchema,
  recordSchema,
  strictRecord,
} from "../checks.js";
import { nonNegativeSchema } from "../checks-internal.js";
import { areaSchema } from "../operators/internal.js";
import { isIdentifier } from "../values/index.js";

// The schemas of what compileScoring reads: the options, a scored response, and the keys that QTI's own expressions score.
// The keys that an operator scores are read by the operator's own schema, through buildOperatorCall.

const identifierSchema = v.pipe(
  v.string(),
  v.check<string, (issue: v.CheckIssue<string>) => string>(
    (text) => isIdentifier(text),
    (issue) => `expected a QTI identifier, found ${issue.received}`,
  ),
);

/** A list of identifiers, at least one, each once. */
const identifiersSchema = v.pipe(
  v.array(identifierSchema),
  v.minLength(1),
  v.check((list) => new Set(list).size === list.length, "expected each identifier once"),
);

export const compileScoringOptionsSchema = v.optional(
  strictRecord({
    portable: v.optional(v.boolean(), false),
    floor: v.optional(finiteSchema),
    allParts: v.optional(v.boolean(), false),
  }),
  {},
);

export const scoredResponseSchema = strictRecord({
  identifier: identifierSchema,
  key: v.pipe(
    recordSchema,
    v.looseObject({
      kind: v.picklist([
        "choice",
        "choice-mapping",
        "choice-marking",
        "pairs",
        "order",
        "areas",
        "text",
        "number",
        "expression",
      ]),
    }),
  ),
  maxPoints: v.optional(positiveSchema),
  weight: v.optional(positiveSchema, 1),
  followThrough: v.optional(recordSchema),
});

const maxChoicesSchema = v.optional(positiveIntegerSchema);

export const choiceKeySchema = strictRecord({
  kind: v.literal("choice"),
  keys: identifiersSchema,
  scheme: v.optional(v.picklist(["all-or-nothing", "partial", "per-key"]), "all-or-nothing"),
  maxChoices: maxChoicesSchema,
});

export const choiceMappingKeySchema = strictRecord({
  kind: v.literal("choice-mapping"),
  points: v.pipe(
    mapSchema(finiteSchema),
    v.check(
      (points) => points.size > 0 && [...points.keys()].every(isIdentifier),
      "expected the points of at least one option, each by a QTI identifier",
    ),
  ),
  maxChoices: v.optional(positiveIntegerSchema, 1),
});

export const choiceMarkingKeySchema = strictRecord({
  kind: v.literal("choice-marking"),
  keys: identifiersSchema,
  correct: positiveSchema,
  wrong: finiteSchema,
  blank: v.optional(finiteSchema, 0),
  maxChoices: maxChoicesSchema,
});

export const pairsKeySchema = strictRecord({
  kind: v.literal("pairs"),
  pairs: v.pipe(v.array(v.strictTuple([identifierSchema, identifierSchema])), v.minLength(1)),
  directed: v.optional(v.boolean(), true),
  scheme: v.optional(v.picklist(["all-or-nothing", "per-pair", "mapping"]), "all-or-nothing"),
  points: v.optional(v.array(finiteSchema)),
  maxPairs: v.optional(positiveIntegerSchema),
  maxPerSource: v.optional(positiveIntegerSchema),
  maxPerTarget: v.optional(positiveIntegerSchema),
  reuse: v.optional(v.boolean(), false),
  surplus: v.optional(nonNegativeSchema, 0),
  none: v.optional(identifierSchema),
});

export const orderKeySchema = strictRecord({
  kind: v.literal("order"),
  order: identifiersSchema,
  scheme: v.optional(v.picklist(["all-or-nothing", "per-position", "adjacent-pairs"]), "all-or-nothing"),
});

/** An area of a `mapping` key, with the points of 1 that it gives by default. */
const mappedAreaSchema = v.pipe(
  v.unknown(),
  v.transform((area): unknown => (isRecord(area) && area.points === undefined ? { ...area, points: 1 } : area)),
  areaSchema,
  v.check(
    ({ shape, coords }) => fitsCoordinateCount(shape, coords.length),
    (issue) => `expected coordinates that fit the shape, found ${issue.received}`,
  ),
);

export const mappedAreasKeySchema = strictRecord({
  kind: v.literal("areas"),
  areas: v.pipe(
    v.array(mappedAreaSchema),
    v.minLength(1),
    v.check((areas) => new Set(areas.map(({ id }) => id)).size === areas.length, "expected each area id once"),
  ),
  scheme: v.literal("mapping"),
  select: v.optional(positiveIntegerSchema),
});

/** The options of `compileScoring`, every default resolved. */
export type CompileOptionsData = v.InferOutput<typeof compileScoringOptionsSchema>;
/** A scored response, its key read for its kind alone. */
export type ScoredResponseData = v.InferOutput<typeof scoredResponseSchema>;
export type ChoiceKeyData = v.InferOutput<typeof choiceKeySchema>;
export type ChoiceMappingKeyData = v.InferOutput<typeof choiceMappingKeySchema>;
export type ChoiceMarkingKeyData = v.InferOutput<typeof choiceMarkingKeySchema>;
export type PairsKeyData = v.InferOutput<typeof pairsKeySchema>;
export type OrderKeyData = v.InferOutput<typeof orderKeySchema>;
export type MappedAreasKeyData = v.InferOutput<typeof mappedAreasKeySchema>;
