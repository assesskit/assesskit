import * as v from "valibot";
import { finiteSchema, isRecord, mapSchema, positiveIntegerSchema, recordSchema, strictRecord } from "../checks.js";
import { nonNegativeSchema } from "../checks-internal.js";
import { SecurityError } from "../errors.js";
import { DEFAULT_KEY_LIMITS } from "./key-limits.js";

// The schemas of the keys that the operators score, with every field present: a key that an item carries has its defaults
// resolved, so that a later change of a default never changes a published score.

/** A share of points, from 0 to 1. */
const shareSchema = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1));
const separatorSchema = v.picklist([".", ","]);
const toleranceSchema = strictRecord({
  absolute: v.nullable(nonNegativeSchema),
  relative: v.nullable(nonNegativeSchema),
});

const rangeSchema = v.pipe(
  strictRecord({ min: finiteSchema, max: finiteSchema }),
  v.check(({ min, max }) => min < max, "a range has its min below its max"),
);

const expressionKeyObject = v.strictObject({
  kind: v.literal("expression"),
  expression: v.string(),
  form: v.picklist(["expression", "equation", "solution-set"]),
  variables: mapSchema(rangeSchema),
  decimalSeparator: separatorSchema,
});

const intervalSchema = v.pipe(
  strictRecord({
    min: v.nullable(finiteSchema),
    max: v.nullable(finiteSchema),
    minIncluded: v.boolean(),
    maxIncluded: v.boolean(),
  }),
  v.check(({ min, max }) => min === null || max === null || min <= max, "an interval has its min at most its max"),
);

const numberKeyObject = v.strictObject({
  kind: v.literal("number"),
  value: finiteSchema,
  tolerance: toleranceSchema,
  decimalSeparator: separatorSchema,
  units: mapSchema(v.pipe(v.number(), v.finite(), v.gtValue(0, "a unit's factor is above 0"))),
  fractions: v.boolean(),
  significantFigures: v.nullable(positiveIntegerSchema),
  credit: v.array(strictRecord({ tolerance: toleranceSchema, share: shareSchema })),
  intervals: v.nullable(v.pipe(v.array(intervalSchema), v.minLength(1))),
  components: v.nullable(v.pipe(v.array(finiteSchema), v.minLength(1))),
});

const lengthEffectSchema = strictRecord({
  when: v.picklist(["below", "above"]),
  share: nonNegativeSchema,
  effect: v.union([v.literal("zero"), strictRecord({ deduct: shareSchema })]),
});

const textKeyObject = v.strictObject({
  kind: v.literal("text"),
  answers: v.pipe(
    v.array(strictRecord({ texts: v.array(v.string()), points: nonNegativeSchema, patterns: v.array(v.string()) })),
    v.minLength(1),
  ),
  count: positiveIntegerSchema,
  scheme: v.picklist(["forms", "words"]),
  normalization: strictRecord({
    form: v.picklist(["NFC", "NFD", "NFKC", "NFKD"]),
    foldWidth: v.boolean(),
    ignoreMarks: v.boolean(),
    caseSensitive: v.boolean(),
    collapseWhitespace: v.boolean(),
  }),
  spelling: v.picklist(["exact", "variants"]),
  numericEquivalence: v.boolean(),
  credit: v.array(strictRecord({ tolerance: toleranceSchema, share: shareSchema })),
  length: v.nullable(
    strictRecord({
      unit: v.picklist(["words", "characters", "characters-without-spaces", "manuscript-squares"]),
      min: v.nullable(nonNegativeSchema),
      max: v.nullable(nonNegativeSchema),
      effects: v.array(lengthEffectSchema),
    }),
  ),
});

const areasKeyObject = v.strictObject({
  kind: v.literal("areas"),
  areas: v.pipe(
    v.array(
      strictRecord({
        id: v.pipe(v.string(), v.nonEmpty()),
        shape: v.picklist(["rect", "circle", "poly"]),
        coords: v.array(nonNegativeSchema),
        points: nonNegativeSchema,
      }),
    ),
    v.minLength(1),
  ),
  scheme: v.literal("keyed", 'expected the scheme "keyed", which hotspot-matching scores'),
  select: positiveIntegerSchema,
});

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

/** The value, or its default when it is absent. */
function orDefault(value: unknown, fallback: unknown): unknown {
  return value === undefined ? fallback : value;
}

/** A copy of an object with each absent field filled from its default; anything else is the schema's to judge. */
function withDefaults(value: unknown, defaults: Readonly<Record<string, unknown>>): unknown {
  if (!isRecord(value)) return value;
  const filled: Record<string, unknown> = { ...value };
  for (const [name, fallback] of Object.entries(defaults)) if (filled[name] === undefined) filled[name] = fallback;
  return filled;
}

/** Each element of an array with its defaults filled; anything that is not an array is left for the schema. */
function eachWithDefaults(value: unknown, defaults: (item: unknown) => unknown): unknown {
  return Array.isArray(value) ? value.map(defaults) : value;
}

function toleranceDefaults(value: unknown): unknown {
  return withDefaults(orDefault(value, {}), { absolute: null, relative: null });
}

function tiersDefaults(value: unknown): unknown {
  return eachWithDefaults(orDefault(value, []), (tier) =>
    isRecord(tier) ? { ...tier, tolerance: toleranceDefaults(tier.tolerance) } : tier,
  );
}

/**
 * Fills the defaults of a key that an operator scores, as `buildOperatorCall` writes it: the default of a field that means
 * "none" is `null`, and that of a field where empty means the same as absent, the empty list or object.
 */
export function resolveKeyDefaults(key: unknown): unknown {
  if (!isRecord(key)) return key;
  switch (key.kind) {
    case "expression":
      return withDefaults(key, { form: "expression", variables: {}, decimalSeparator: "." });
    case "number":
      return withDefaults(
        {
          ...key,
          tolerance: toleranceDefaults(key.tolerance),
          credit: tiersDefaults(key.credit),
          intervals: eachWithDefaults(key.intervals, (interval) =>
            withDefaults(interval, { minIncluded: true, maxIncluded: true }),
          ),
        },
        {
          decimalSeparator: ".",
          units: {},
          fractions: false,
          significantFigures: null,
          intervals: null,
          components: null,
        },
      );
    case "text":
      return resolveTextDefaults(key);
    case "areas": {
      const areas = eachWithDefaults(key.areas, (area) => withDefaults(area, { points: 1 }));
      return withDefaults({ ...key, areas }, { select: Array.isArray(areas) ? areas.length : undefined });
    }
    default:
      return key;
  }
}

function resolveTextDefaults(key: Readonly<Record<string, unknown>>): unknown {
  const length = isRecord(key.length)
    ? withDefaults(
        {
          ...key.length,
          effects: eachWithDefaults(orDefault(key.length.effects, []), (effect) => withDefaults(effect, { share: 1 })),
        },
        { min: null, max: null },
      )
    : orDefault(key.length, null);
  return withDefaults(
    {
      ...key,
      answers: eachWithDefaults(key.answers, (answer) => withDefaults(answer, { points: 1, patterns: [] })),
      normalization: withDefaults(orDefault(key.normalization, {}), {
        form: "NFKC",
        foldWidth: true,
        ignoreMarks: false,
        caseSensitive: false,
        collapseWhitespace: true,
      }),
      credit: tiersDefaults(key.credit),
      length,
    },
    { count: 1, scheme: "forms", spelling: "exact", numericEquivalence: false },
  );
}
