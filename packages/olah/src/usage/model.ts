import type { BaseType, Primitive } from "../values/index.js";
import type { ObjectType } from "./vocabularies.js";

/** The object a statistic is about (UD §2.6.4). */
export interface TargetObject {
  /** The identifier of the item or of another object, such as a test. */
  readonly identifier: string;
  /** The part of the object, such as an outcome or a choice; absent when the statistic is about the whole object. */
  readonly partIdentifier?: string;
  /** The kind of the object. */
  readonly objectType?: ObjectType;
}

/** The value of an ordinary statistic (UD §2.6.5). */
export interface StatisticValue {
  /** The value, of the base type. */
  readonly value: Primitive;
  /** The base type of the value. Default: `float`, because an ordinary statistic is a numeric value (UD §2.4.3). */
  readonly baseType?: BaseType;
  /** The field of a record that the value is part of. */
  readonly fieldIdentifier?: string;
}

/** One entry of a mapping (UD §2.6.3). */
export interface StatisticMapEntry {
  /** The source value. */
  readonly mapKey: string;
  /** The mapped value. */
  readonly mappedValue: number;
  /** Whether the key is matched case-sensitively. */
  readonly caseSensitive?: boolean;
}

/** A mapping from source values to numbers (UD §2.4.2). */
export interface StatisticMapping {
  /** The least result of the mapping. */
  readonly lowerBound?: number;
  /** The greatest result of the mapping. */
  readonly upperBound?: number;
  /** The result for a source value that has no entry. Default: `0`. */
  readonly defaultValue?: number;
  /** The entries, at least one. */
  readonly entries: readonly StatisticMapEntry[];
}

/** What every statistic says about itself (UD §2.4.1, §2.4.3). */
export interface ItemStatisticBase {
  /** The name of the statistic, an identifier; the vocabularies `ITEM_STATISTICS` and `DISTRACTOR_STATISTICS` list common ones. */
  readonly name: string;
  /** A URI of the glossary that defines the name; it overrides the glossary of the usage data. */
  readonly glossary?: string;
  /** A URI that points to the sample and the computation that created the statistic. */
  readonly context: string;
  /** The number of cases in the sample. */
  readonly caseCount?: number;
  /** The standard error of the statistic. */
  readonly stdError?: number;
  /** The standard deviation of the statistic. */
  readonly stdDeviation?: number;
  /** The day the statistic was last updated, as `YYYY-MM-DD`. */
  readonly lastUpdated?: string;
  /** The objects the statistic is about, at least one. */
  readonly targetObjects: readonly TargetObject[];
}

/** A statistic that is one number, such as a p-value (UD §2.4.3). */
export interface OrdinaryStatistic extends ItemStatisticBase {
  /** Tells the two kinds of statistic apart. */
  readonly kind: "ordinary";
  /** The value. */
  readonly value: StatisticValue;
}

/** A statistic that is several numbers, such as the dispersion parameters of IRT (UD §2.4.1). */
export interface CategorizedStatistic extends ItemStatisticBase {
  /** Tells the two kinds of statistic apart. */
  readonly kind: "categorized";
  /** The values, by category. */
  readonly mapping: StatisticMapping;
}

/** A statistic about items or other objects. */
export type ItemStatistic = OrdinaryStatistic | CategorizedStatistic;

/** A usage data document (UD §2.3.1). */
export interface UsageData {
  /** A URI of the glossary that defines the names of the statistics. */
  readonly glossary?: string;
  /** The statistics, in document order. */
  readonly statistics: readonly ItemStatistic[];
}
