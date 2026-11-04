import fc from "fast-check";
import type {
  CategorizedStatistic,
  OrdinaryStatistic,
  StatisticMapEntry,
  StatisticMapping,
  StatisticValue,
  TargetObject,
  UsageData,
} from "../../src/usage/index.js";
import {
  baseType,
  defined,
  double,
  identifier,
  nonEmptyText,
  optional,
  primitives,
  safeInteger,
  text,
  uri,
} from "./values.js";

const OBJECT_TYPES = ["test", "testpart", "section", "item", "outcome", "interaction", "choice"] as const;

const pad = (value: number, length: number): string => String(value).padStart(length, "0");

/** A `YYYY-MM-DD` date that the UD schema accepts. */
const date: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 1, max: 9999 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) => `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`);

const targetObject: fc.Arbitrary<TargetObject> = fc
  .record({
    identifier: nonEmptyText,
    partIdentifier: optional(identifier),
    objectType: optional(fc.constantFrom(...OBJECT_TYPES)),
  })
  .map((fields) => defined<TargetObject>(fields));

/** A value of a statistic: a float without a base type, or a value of any base type that names it. */
const statisticValue: fc.Arbitrary<StatisticValue> = fc.oneof(
  fc.record({ value: double }),
  baseType.chain((type) =>
    fc
      .record({ value: primitives[type], baseType: fc.constant(type), fieldIdentifier: optional(identifier) })
      .map((fields) => defined<StatisticValue>(fields)),
  ),
);

const mapEntry: fc.Arbitrary<StatisticMapEntry> = fc
  .record({ mapKey: text, mappedValue: double, caseSensitive: optional(fc.boolean()) })
  .map((fields) => defined<StatisticMapEntry>(fields));

const mapping: fc.Arbitrary<StatisticMapping> = fc
  .record({
    lowerBound: optional(double),
    upperBound: optional(double),
    defaultValue: optional(double),
    entries: fc.array(mapEntry, { minLength: 1, maxLength: 4 }),
  })
  .map((fields) => defined<StatisticMapping>(fields));

const base = fc.record({
  name: identifier,
  glossary: optional(uri),
  context: uri,
  caseCount: optional(safeInteger),
  stdError: optional(double),
  stdDeviation: optional(double),
  lastUpdated: optional(date),
  targetObjects: fc.array(targetObject, { minLength: 1, maxLength: 3 }),
});

const ordinary: fc.Arbitrary<OrdinaryStatistic> = fc
  .tuple(base, statisticValue)
  .map(([fields, value]) => defined<OrdinaryStatistic>({ kind: "ordinary", ...fields, value }));

const categorized: fc.Arbitrary<CategorizedStatistic> = fc
  .tuple(base, mapping)
  .map(([fields, categories]) =>
    defined<CategorizedStatistic>({ kind: "categorized", ...fields, mapping: categories }),
  );

/** Arbitrary usage data. */
export const usageData: fc.Arbitrary<UsageData> = fc
  .record({
    glossary: optional(uri),
    statistics: fc.array(fc.oneof(ordinary, categorized), { maxLength: 4 }),
  })
  .map((fields) => defined<UsageData>(fields));
