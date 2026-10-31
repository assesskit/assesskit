import { DataError } from "../errors.js";
import { BASE_TYPES, isXsdDate, parsePrimitive } from "../values/index.js";
import { ElementReader, type ReaderRules, type XmlElement } from "../xml/index.js";
import type {
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
import { USAGE_NAMESPACE } from "./namespace.js";
import { STATISTIC_OBJECT_TYPES } from "./vocabularies.js";

const RULES: ReaderRules = { module: "usage", namespaces: [USAGE_NAMESPACE] };

const STATISTIC_ELEMENTS = ["ordinaryStatistic", "categorizedStatistic"];

const toIdentifier = (text: string): string => parsePrimitive(text, "identifier");
const toInteger = (text: string): number => parsePrimitive(text, "integer");
const toDouble = (text: string): number => parsePrimitive(text, "float");
const toBoolean = (text: string): boolean => parsePrimitive(text, "boolean");

/** Reads the `DateDType` of the UD schema: `YYYY-MM-DD`, with white space collapsed. */
function toDate(text: string): string {
  const collapsed = text.trim();
  if (!isXsdDate(collapsed)) {
    throw new DataError(`The text ${JSON.stringify(text)} is not a date such as 2004-07-04.`);
  }
  return collapsed;
}

function readTargetObject(reader: ElementReader): TargetObject {
  const identifier = reader.required("identifier");
  const partIdentifier = reader.attribute("partIdentifier", toIdentifier);
  const objectType = reader.term("objectType", STATISTIC_OBJECT_TYPES);
  reader.done();
  return {
    identifier,
    ...(partIdentifier !== undefined && { partIdentifier }),
    ...(objectType !== undefined && { objectType }),
  };
}

/** Reads the value of an ordinary statistic; without a base type it is a float (UD §2.4.3). */
function readStatisticValue(reader: ElementReader): StatisticValue {
  const fieldIdentifier = reader.attribute("fieldIdentifier", toIdentifier);
  const baseType = reader.term("baseType", BASE_TYPES);
  const text = reader.text();
  reader.done();
  const lead = baseType === undefined ? "The value of an ordinary statistic without a baseType is a float. " : "";
  const value = reader.attempt("invalid-value", () => parsePrimitive(text, baseType ?? "float"), lead);
  return {
    value,
    ...(baseType !== undefined && { baseType }),
    ...(fieldIdentifier !== undefined && { fieldIdentifier }),
  };
}

function readMapEntry(reader: ElementReader): StatisticMapEntry {
  const mapKey = reader.required("mapKey");
  const mappedValue = reader.required("mappedValue", toDouble);
  const caseSensitive = reader.attribute("caseSensitive", toBoolean);
  reader.done();
  return { mapKey, mappedValue, ...(caseSensitive !== undefined && { caseSensitive }) };
}

function readMapping(reader: ElementReader): StatisticMapping {
  const lowerBound = reader.attribute("lowerBound", toDouble);
  const upperBound = reader.attribute("upperBound", toDouble);
  const defaultValue = reader.attribute("defaultValue", toDouble);
  const entries = reader.takeAll("mapEntry").map(readMapEntry);
  if (entries.length === 0) throw reader.fail("missing-element", "The element mapping needs a mapEntry.");
  reader.done();
  return {
    ...(lowerBound !== undefined && { lowerBound }),
    ...(upperBound !== undefined && { upperBound }),
    ...(defaultValue !== undefined && { defaultValue }),
    entries,
  };
}

/** Reads what the two kinds of statistic share: their attributes and their target objects. */
function readBase(reader: ElementReader): ItemStatisticBase {
  const name = reader.required("name", toIdentifier);
  const glossary = reader.attribute("glossary");
  const context = reader.required("context");
  const caseCount = reader.attribute("caseCount", toInteger);
  const stdError = reader.attribute("stdError", toDouble);
  const stdDeviation = reader.attribute("stdDeviation", toDouble);
  const lastUpdated = reader.attribute("lastUpdated", toDate);
  const targetObjects = reader.takeAll("targetObject").map(readTargetObject);
  if (targetObjects.length === 0) {
    throw reader.fail("missing-element", `The element ${reader.name} needs a targetObject.`);
  }
  return {
    name,
    ...(glossary !== undefined && { glossary }),
    context,
    ...(caseCount !== undefined && { caseCount }),
    ...(stdError !== undefined && { stdError }),
    ...(stdDeviation !== undefined && { stdDeviation }),
    ...(lastUpdated !== undefined && { lastUpdated }),
    targetObjects,
  };
}

function readOrdinaryStatistic(reader: ElementReader): OrdinaryStatistic {
  const base = readBase(reader);
  const value = readStatisticValue(reader.require("value"));
  reader.done();
  return { kind: "ordinary", ...base, value };
}

function readCategorizedStatistic(reader: ElementReader): CategorizedStatistic {
  const base = readBase(reader);
  const mapping = readMapping(reader.require("mapping"));
  reader.done();
  return { kind: "categorized", ...base, mapping };
}

function readStatistic(reader: ElementReader): ItemStatistic {
  return reader.name === "ordinaryStatistic" ? readOrdinaryStatistic(reader) : readCategorizedStatistic(reader);
}

/**
 * Reads a usage data document (UD §2.3.1) into a model. An `xs:date` in `lastUpdated` must have the form `YYYY-MM-DD`, as
 * the schema's pattern says.
 *
 * @param input - The document as text or bytes, or the root element of a parsed document.
 * @returns The usage data; every optional field the document leaves out is absent.
 * @throws `DataError` when `input` is none of these.
 * @throws `ReadError` when the document is not well-formed, the root is not `usageData` of the UD namespace, or the
 * document cannot be mapped to the model: a missing, unknown or misplaced element or attribute, a statistic without a
 * target object, a value that is not of its base type, or a date that is not `YYYY-MM-DD`.
 * @throws `SecurityError` when the text or bytes break a limit of `parseXml`.
 */
export function readUsageData(input: string | Uint8Array | XmlElement): UsageData {
  const reader = ElementReader.open(input, RULES, "The usage data");
  if (reader.foreign || reader.name !== "usageData") {
    const message = `The root element must be usageData in the namespace ${USAGE_NAMESPACE}, found ${reader.qualifiedName}.`;
    throw reader.fail("not-usage-data", message);
  }
  const glossary = reader.attribute("glossary");
  const statistics: ItemStatistic[] = [];
  for (
    let child = reader.takeAny(STATISTIC_ELEMENTS);
    child !== undefined;
    child = reader.takeAny(STATISTIC_ELEMENTS)
  ) {
    statistics.push(readStatistic(child));
  }
  reader.done();
  return { ...(glossary !== undefined && { glossary }), statistics };
}
