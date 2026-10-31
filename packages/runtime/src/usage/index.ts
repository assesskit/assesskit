/**
 * Usage data and item statistics (UD): the model of statistics about items, and a reader and writer for its XML binding.
 *
 * @module @assesskit/runtime/usage
 */
export type {
  CategorizedStatistic,
  ItemStatistic,
  ItemStatisticBase,
  OrdinaryStatistic,
  StatisticMapEntry,
  StatisticMapping,
  StatisticValue,
  TargetObject,
  UsageData,
} from "./model.js";
export { USAGE_NAMESPACE } from "./namespace.js";
export { readUsageData } from "./read-usage-data.js";
export { DISTRACTOR_STATISTICS, ITEM_STATISTICS, type ObjectType, STATISTIC_OBJECT_TYPES } from "./vocabularies.js";
export { writeUsageData } from "./write-usage-data.js";
