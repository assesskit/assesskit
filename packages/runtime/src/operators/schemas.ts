import * as v from "valibot";
import { finiteSchema, mapSchema, positiveIntegerSchema, recordSchema, strictRecord } from "../checks.js";
import { nonNegativeSchema } from "../checks-internal.js";
import { SecurityError } from "../errors.js";
import { DEFAULT_KEY_LIMITS } from "../keys/index.js";

// The schemas of the keys that the operators score. A field that a key may leave out has its default here, and both a call
// and an item read a key through them; `buildOperatorCall` writes every field, so that an item's key holds its defaults
// and a later change of a default takes a new definition URI rather than changing a published score.

/** A share of points, from 0 to 1. */
const shareSchema = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1));
const separatorSchema = v.optional(v.picklist([".", ","]), ".");
const toleranceSchema = v.optional(
  strictRecord({
    absolute: v.optional(v.nullable(nonNegativeSchema), null),
    relative: v.optional(v.nullable(nonNegativeSchema), null),
  }),
  {},
);
const creditSchema = v.optional(v.array(strictRecord({ tolerance: toleranceSchema, share: shareSchema })), []);

const rangeSchema = v.pipe(
  strictRecord({ min: finiteSchema, max: finiteSchema }),
  v.check(({ min, max }) => min < max, "a range has its min below its max"),
);

const expressionKeyObject = v.strictObject({
  kind: v.literal("expression"),
  expression: v.string(),
  form: v.optional(v.picklist(["expression", "equation", "solution-set"]), "expression"),
  variables: v.optional(mapSchema(rangeSchema), {}),
  decimalSeparator: separatorSchema,
});

const intervalSchema = v.pipe(
  strictRecord({
    min: v.nullable(finiteSchema),
    max: v.nullable(finiteSchema),
    minIncluded: v.optional(v.boolean(), true),
    maxIncluded: v.optional(v.boolean(), true),
  }),
  v.check(({ min, max }) => min === null || max === null || min <= max, "an interval has its min at most its max"),
);

const numberKeyObject = v.strictObject({
  kind: v.literal("number"),
  value: finiteSchema,
  tolerance: toleranceSchema,
  decimalSeparator: separatorSchema,
  units: v.optional(mapSchema(v.pipe(v.number(), v.finite(), v.gtValue(0, "a unit's factor is above 0"))), {}),
  fractions: v.optional(v.boolean(), false),
  significantFigures: v.optional(v.nullable(positiveIntegerSchema), null),
  credit: creditSchema,
  intervals: v.optional(v.nullable(v.pipe(v.array(intervalSchema), v.minLength(1))), null),
  components: v.optional(v.nullable(v.pipe(v.array(finiteSchema), v.minLength(1))), null),
});

const lengthEffectSchema = strictRecord({
  when: v.picklist(["below", "above"]),
  share: v.optional(nonNegativeSchema, 1),
  effect: v.union([v.literal("zero"), strictRecord({ deduct: shareSchema })]),
});

const textKeyObject = v.strictObject({
  kind: v.literal("text"),
  answers: v.pipe(
    v.array(
      strictRecord({
        texts: v.array(v.string()),
        points: v.optional(nonNegativeSchema, 1),
        patterns: v.optional(v.array(v.string()), []),
      }),
    ),
    v.minLength(1),
  ),
  count: v.optional(positiveIntegerSchema, 1),
  scheme: v.optional(v.picklist(["forms", "words"]), "forms"),
  normalization: v.optional(
    strictRecord({
      form: v.optional(v.picklist(["NFC", "NFD", "NFKC", "NFKD"]), "NFKC"),
      foldWidth: v.optional(v.boolean(), true),
      ignoreMarks: v.optional(v.boolean(), false),
      caseSensitive: v.optional(v.boolean(), false),
      collapseWhitespace: v.optional(v.boolean(), true),
    }),
    {},
  ),
  spelling: v.optional(v.picklist(["exact", "variants"]), "exact"),
  numericEquivalence: v.optional(v.boolean(), false),
  credit: creditSchema,
  length: v.optional(
    v.nullable(
      strictRecord({
        unit: v.picklist(["words", "characters", "characters-without-spaces", "manuscript-squares"]),
        min: v.optional(v.nullable(nonNegativeSchema), null),
        max: v.optional(v.nullable(nonNegativeSchema), null),
        effects: v.optional(v.array(lengthEffectSchema), []),
      }),
    ),
    null,
  ),
});

/** An area of a key, its points resolved. */
export const areaSchema = strictRecord({
  id: v.pipe(v.string(), v.nonEmpty()),
  shape: v.picklist(["rect", "circle", "poly"]),
  coords: v.array(nonNegativeSchema),
  points: v.optional(nonNegativeSchema, 1),
});

/** An `areas` key, whose `select` is by default the number of its areas. */
const areasKeyObject = v.pipe(
  v.strictObject({
    kind: v.literal("areas"),
    areas: v.pipe(v.array(areaSchema), v.minLength(1)),
    scheme: v.literal("keyed", 'expected the scheme "keyed", which hotspot-matching scores'),
    select: v.optional(positiveIntegerSchema),
  }),
  v.transform(({ select, ...key }) => ({ ...key, select: select ?? key.areas.length })),
);

export const expressionKeySchema = v.pipe(recordSchema, expressionKeyObject);
export const numberKeySchema = v.pipe(recordSchema, numberKeyObject);
export const textKeySchema = v.pipe(recordSchema, textKeyObject);
export const areasKeySchema = v.pipe(recordSchema, areasKeyObject);
/** The key of `readable`: an `expression`, `number` or `text` key. */
export const readableKeySchema = v.pipe(
  recordSchema,
  v.variant("kind", [expressionKeyObject, numberKeyObject, textKeyObject]),
);

/** An `expression` key with every field present. */
export type ExpressionKeyData = v.InferOutput<typeof expressionKeySchema>;
/** A `number` key with every field present. */
export type NumberKeyData = v.InferOutput<typeof numberKeySchema>;
/** A `text` key with every field present. */
export type TextKeyData = v.InferOutput<typeof textKeySchema>;
/** An `areas` key with every field present. */
export type AreasKeyData = v.InferOutput<typeof areasKeySchema>;

/** The most coordinates of a key's areas together: four for each area that the limit `entries` allows. */
const COORDINATES_PER_ENTRY = 4;

/** Throws when a count passes the limit `entries`. */
function checkEntries(count: number, what: string, path: string): void {
  const { entries } = DEFAULT_KEY_LIMITS;
  if (count > entries)
    throw new SecurityError(
      `The key at ${path} holds ${count} ${what}, over the limit entries of ${entries}.`,
      "entries",
      entries,
    );
}

/**
 * Checks a key against the limits of a key: the entries of each list, the texts and patterns of every answer together, the
 * coordinates of every area together, four times the entries, and the characters of each pattern.
 *
 * @throws `SecurityError` naming the limit.
 */
export function checkKeyLimits(
  key: ExpressionKeyData | NumberKeyData | TextKeyData | AreasKeyData,
  path: string,
): void {
  switch (key.kind) {
    case "expression":
      checkEntries(key.variables.size, "variables", path);
      return;
    case "number":
      checkEntries(
        key.units.size + key.credit.length + (key.intervals?.length ?? 0),
        "units, tiers and intervals",
        path,
      );
      checkEntries(key.components?.length ?? 0, "components", path);
      return;
    case "text":
      checkTextLimits(key, path);
      return;
    case "areas":
      checkEntries(key.areas.length, "areas", path);
      checkEntries(
        key.areas.reduce((total, area) => total + area.coords.length, 0) / COORDINATES_PER_ENTRY,
        "coordinates in fours",
        path,
      );
      return;
  }
}

function checkTextLimits(key: TextKeyData, path: string): void {
  checkEntries(key.answers.length, "answers", path);
  const entries = key.answers.reduce((total, answer) => total + answer.texts.length + answer.patterns.length, 0);
  checkEntries(entries, "texts and patterns", path);
  checkEntries(key.credit.length + (key.length?.effects.length ?? 0), "tiers and effects", path);
  const { patternLength } = DEFAULT_KEY_LIMITS;
  for (const answer of key.answers) {
    for (const pattern of answer.patterns) {
      if (pattern.length > patternLength)
        throw new SecurityError(
          `A pattern of the key at ${path} has ${pattern.length} characters, over the limit patternLength of ${patternLength}.`,
          "patternLength",
          patternLength,
        );
    }
  }
}
