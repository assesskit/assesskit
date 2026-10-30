# Usage data

`usage` reads and writes usage data and item statistics (UD): statistics about items, such as p-values and IRT parameters,
that always relate to a context in which they hold. It imports `xml` and `values` and runs in any JavaScript runtime. olah
carries the statistics as data; computing them is the work of a psychometrics library.

| Export                                                                                         | Purpose                                                                   |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `readUsageData(input)`                                                                         | Reads text, bytes or a parsed element into `UsageData`.                   |
| `writeUsageData(data)`                                                                         | Writes `UsageData` as a document that the UD schema accepts.              |
| `USAGE_NAMESPACE`                                                                              | The namespace of the UD schema.                                           |
| `ITEM_STATISTICS`, `DISTRACTOR_STATISTICS`                                                     | The terms of the two external vocabularies for the `name` of a statistic. |
| `UsageData`, `ItemStatistic`, `OrdinaryStatistic`, `CategorizedStatistic`, `ItemStatisticBase` | The statistics.                                                           |
| `TargetObject`, `StatisticValue`, `StatisticMapping`, `StatisticMapEntry`, `ObjectType`        | The parts of a statistic.                                                 |

## Example

```ts
import { readUsageData, writeUsageData } from "@luthfanwakan/olah/usage";

const data = readUsageData(`<usageData xmlns="http://www.imsglobal.org/xsd/imsqti_usagedata_v3p0">
  <ordinaryStatistic name="P-value" context="http://example.com/sample" caseCount="689325" lastUpdated="2004-07-04">
    <targetObject identifier="Item_VB123456"/>
    <value>0.647</value>
  </ordinaryStatistic>
</usageData>`);

data.statistics[0];
// {
//   kind: "ordinary", name: "P-value", context: "http://example.com/sample", caseCount: 689325,
//   lastUpdated: "2004-07-04", targetObjects: [{ identifier: "Item_VB123456" }], value: { value: 0.647 }
// }

writeUsageData(data);
// <?xml version="1.0" encoding="UTF-8"?>
// <usageData xsi:schemaLocation="..." xmlns="http://www.imsglobal.org/xsd/imsqti_usagedata_v3p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><ordinaryStatistic name="P-value" context="http://example.com/sample" caseCount="689325" lastUpdated="2004-07-04"><targetObject identifier="Item_VB123456"/><value>0.647</value></ordinaryStatistic></usageData>
```

## Model

| Type                   | Fields                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `UsageData`            | `glossary?`, `statistics`: the two kinds in the order of the document                                       |
| `OrdinaryStatistic`    | `kind: "ordinary"`, the fields of `ItemStatisticBase`, `value`                                              |
| `CategorizedStatistic` | `kind: "categorized"`, the fields of `ItemStatisticBase`, `mapping`                                         |
| `ItemStatisticBase`    | `name`, `glossary?`, `context`, `caseCount?`, `stdError?`, `stdDeviation?`, `lastUpdated?`, `targetObjects` |
| `TargetObject`         | `identifier`, `partIdentifier?`, `objectType?`                                                              |
| `StatisticValue`       | `value`, `baseType?`, `fieldIdentifier?`                                                                    |
| `StatisticMapping`     | `lowerBound?`, `upperBound?`, `defaultValue?`, `entries`: `{ mapKey, mappedValue, caseSensitive? }[]`       |

## Rules

| Rule                                                                                                                                                                              | Source                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| A statistic has at least one target object; a mapping has at least one entry. A categorized statistic has a `mapping`, an ordinary one a `value`.                                 | UD §2.4               |
| A `value` without a base type is a `float`, because an ordinary statistic is a numeric value. Any other value needs its `baseType`, and is read in the lexical form of that type. | UD §2.4.3, INFO §8.13 |
| `lastUpdated` is `YYYY-MM-DD` with a four-digit year, a month and a day of that month, and no time zone: the pattern of `DateDType`.                                              | UD XSD                |
| `name` is an identifier. The two vocabularies list common names; any other name is read and written, and its `glossary` defines it.                                               | UD §2.8               |
| `defaultValue` is absent when the document gives none; the schema's default is `0`.                                                                                               | UD XSD                |
| The namespace is strict. The usage data of the packages of the 1EdTech examples are in the namespace of QTI 2.2, so `readUsageData` refuses them.                                 | D6                    |
| The reader refuses an attribute, element or text that the schema does not define at that place.                                                                                   | UD XSD                |

`ObjectType` has the seven terms of `ObjectTypeEnum` (UD §2.7.2), which `STATISTIC_OBJECT_TYPES` lists: `test`, `testpart`, `section`, `item`, `outcome`,
`interaction`, `choice`. `ITEM_STATISTICS` has the sixteen terms of UD §2.8.2 and `DISTRACTOR_STATISTICS` the four of §2.8.1.

## Errors

`readUsageData` throws `ReadError` with one issue; `writeUsageData` throws `DataError` for a model that is not usage data.
The codes are those of [results](results.md#errors) with the module `usage`: `olah/usage/not-usage-data` for another root,
`missing-attribute`, `invalid-attribute`, `unexpected-attribute`, `missing-element`, `unexpected-element`,
`unexpected-text` and `invalid-value`.
