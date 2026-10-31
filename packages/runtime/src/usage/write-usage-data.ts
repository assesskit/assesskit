import { checkArray, checkBoolean, checkChoice, checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { BASE_TYPES, type BaseType, formatPrimitive, isXsdDate, type Primitive } from "../values/index.js";
import { buildElement, serializeXml, type XmlElement } from "../xml/index.js";
import type {
  ItemStatistic,
  ItemStatisticBase,
  StatisticMapEntry,
  StatisticMapping,
  StatisticValue,
  TargetObject,
  UsageData,
} from "./model.js";
import { USAGE_NAMESPACE, USAGE_SCHEMA_LOCATION } from "./namespace.js";
import { STATISTIC_OBJECT_TYPES } from "./vocabularies.js";

type Attributes = Readonly<Record<string, string | undefined>>;

const element = (
  name: string,
  attributes: Attributes = {},
  children: readonly (XmlElement | string)[] = [],
): XmlElement => buildElement(USAGE_NAMESPACE, name, attributes, children);

/** Writes a field of a base type, which `formatPrimitive` checks; a field that is absent is `undefined`. */
const optionalText = (value: Primitive | undefined, baseType: BaseType): string | undefined =>
  value === undefined ? undefined : formatPrimitive(value, baseType);

/** Applies a check to an optional field; `undefined` is absent and every other value, `null` included, is checked. */
function optional<T>(value: T | undefined, check: (value: T) => void): T | undefined {
  if (value !== undefined) check(value);
  return value;
}

function arrayOf<T>(value: readonly T[], label: string, minimum: number): readonly T[] {
  checkArray(value, `${label} must be an array`);
  if (value.length < minimum) {
    throw new DataError(`${label} needs at least ${minimum === 1 ? "one entry" : `${minimum} entries`}.`);
  }
  return value;
}

function writeTargetObject(target: TargetObject): XmlElement {
  checkRecord(target, "A target object must be an object");
  optional(target.objectType, (term) => checkChoice(term, "The objectType of a target object", STATISTIC_OBJECT_TYPES));
  return element("targetObject", {
    identifier: formatPrimitive(target.identifier, "string"),
    partIdentifier: optionalText(target.partIdentifier, "identifier"),
    objectType: target.objectType,
  });
}

function writeStatisticValue(statistic: StatisticValue): XmlElement {
  checkRecord(statistic, "The value of a statistic must be an object");
  const { value, baseType, fieldIdentifier } = statistic;
  optional(baseType, (term) => checkChoice(term, "The baseType of the value of a statistic", BASE_TYPES));
  const text = formatPrimitive(value, baseType ?? "float");
  return element("value", { fieldIdentifier: optionalText(fieldIdentifier, "identifier"), baseType }, [text]);
}

function writeMapEntry(entry: StatisticMapEntry): XmlElement {
  checkRecord(entry, "A map entry must be an object");
  const { caseSensitive } = entry;
  optional(caseSensitive, (flag) => checkBoolean(flag, "The caseSensitive of a map entry"));
  return element("mapEntry", {
    mapKey: formatPrimitive(entry.mapKey, "string"),
    mappedValue: formatPrimitive(entry.mappedValue, "float"),
    caseSensitive: caseSensitive === undefined ? undefined : String(caseSensitive),
  });
}

function writeMapping(mapping: StatisticMapping): XmlElement {
  checkRecord(mapping, "The mapping of a statistic must be an object");
  const entries = arrayOf(mapping.entries, "The entries of a mapping", 1).map(writeMapEntry);
  const attributes = {
    lowerBound: optionalText(mapping.lowerBound, "float"),
    upperBound: optionalText(mapping.upperBound, "float"),
    defaultValue: optionalText(mapping.defaultValue, "float"),
  };
  return element("mapping", attributes, entries);
}

/** Returns the attributes and the target objects that the two kinds of statistic share. */
function writeBase(statistic: ItemStatisticBase): { readonly attributes: Attributes; readonly targets: XmlElement[] } {
  const label = `the statistic ${describe(statistic.name)}`;
  const { lastUpdated } = statistic;
  optional(lastUpdated, (date) => {
    checkString(date, `The lastUpdated of ${label}`);
    if (!isXsdDate(date)) {
      throw new DataError(`The lastUpdated of ${label} must be a date such as 2004-07-04, found ${describe(date)}.`);
    }
  });
  return {
    attributes: {
      name: formatPrimitive(statistic.name, "identifier"),
      glossary: optionalText(statistic.glossary, "uri"),
      context: formatPrimitive(statistic.context, "uri"),
      caseCount: optionalText(statistic.caseCount, "integer"),
      stdError: optionalText(statistic.stdError, "float"),
      stdDeviation: optionalText(statistic.stdDeviation, "float"),
      lastUpdated,
    },
    targets: arrayOf(statistic.targetObjects, `The targetObjects of ${label}`, 1).map(writeTargetObject),
  };
}

function writeStatistic(statistic: ItemStatistic): XmlElement {
  checkRecord(statistic, "A statistic must be an object");
  const { attributes, targets } = writeBase(statistic);
  switch (statistic.kind) {
    case "ordinary":
      return element("ordinaryStatistic", attributes, [...targets, writeStatisticValue(statistic.value)]);
    case "categorized":
      return element("categorizedStatistic", attributes, [...targets, writeMapping(statistic.mapping)]);
    default:
      throw new DataError(
        `The kind of a statistic must be "ordinary" or "categorized", found ${describe(Reflect.get(statistic, "kind"))}.`,
      );
  }
}

/**
 * Writes a usage data document (UD §2.3.1) in UTF-8, valid against the UD schema, which names it in `xsi:schemaLocation`.
 * An ordinary statistic whose value has no base type is written without the attribute, as a float.
 *
 * @param data - The usage data to write; it is checked deeply.
 * @returns The document.
 * @throws `DataError` when the model is not usage data: a field of the wrong type, a name that is not an identifier, a
 * date that is not `YYYY-MM-DD`, a statistic without a target object or a mapping without an entry, a value that is not
 * of its base type, or text with a character that XML 1.0 does not allow.
 */
export function writeUsageData(data: UsageData): string {
  checkRecord(data, "The usage data must be an object");
  const statistics = arrayOf(data.statistics, "The statistics of the usage data", 0).map(writeStatistic);
  const attributes = {
    "xsi:schemaLocation": `${USAGE_NAMESPACE} ${USAGE_SCHEMA_LOCATION}`,
    glossary: optionalText(data.glossary, "uri"),
  };
  return serializeXml(element("usageData", attributes, statistics));
}
