import { DataError } from "../errors.js";
import {
  BASE_TYPES,
  type BaseType,
  type Cardinality,
  container,
  formatPrimitive,
  normalizeValue,
  type Primitive,
  parseIsoDuration,
  parsePrimitive,
  record,
  type SingleValue,
  single,
  type Value,
} from "../values/index.js";
import { buildElement, type ElementReader, type XmlElement } from "../xml/index.js";
import { RESULTS_NAMESPACE } from "./namespace.js";

/** The type of the values of a variable: a record has fields that bring their own base types. */
export type VariableType =
  | { readonly cardinality: "record"; readonly baseType?: BaseType }
  | { readonly cardinality: Exclude<Cardinality, "record">; readonly baseType: BaseType };

/**
 * Returns the type of a variable from its cardinality and base type, or `undefined` when the base type is missing:
 * only a record may leave it out (RR §2.4.3).
 */
export function variableType(cardinality: Cardinality, baseType: BaseType | undefined): VariableType | undefined {
  if (cardinality === "record") return baseType === undefined ? { cardinality } : { cardinality, baseType };
  return baseType === undefined ? undefined : { cardinality, baseType };
}

/** An ISO 8601 duration starts with `P`, after an optional sign. */
const ISO_DURATION_START = /^-?P/;

/** One `value` element, read. */
interface ValueItem {
  readonly reader: ElementReader;
  readonly text: string;
  readonly fieldIdentifier?: string;
  readonly baseType?: BaseType;
}

const toIdentifier = (text: string): string => parsePrimitive(text, "identifier");

/**
 * Reads the text of a value. A duration is a number of seconds (INFO §8.13); a text that starts with `P` is read as the
 * ISO 8601 duration that 1EdTech's own example of a result writes, as long as it has no years or months (G14).
 */
function readPrimitive(text: string, baseType: BaseType): Primitive {
  const token = text.trim();
  if (baseType === "duration" && ISO_DURATION_START.test(token)) return parseIsoDuration(token);
  return parsePrimitive(text, baseType);
}

function readItem(reader: ElementReader): ValueItem {
  const fieldIdentifier = reader.attribute("fieldIdentifier", toIdentifier);
  const baseType = reader.term("baseType", BASE_TYPES);
  const text = reader.text();
  reader.done();
  return {
    reader,
    text,
    ...(fieldIdentifier !== undefined && { fieldIdentifier }),
    ...(baseType !== undefined && { baseType }),
  };
}

function primitiveOf({ reader, text }: ValueItem, baseType: BaseType): Primitive {
  return reader.attempt("invalid-value", () => readPrimitive(text, baseType));
}

/** Reads a value of a variable that is not a record, which has neither a field identifier nor a base type of its own. */
function plainPrimitive(item: ValueItem, baseType: BaseType): Primitive {
  const stray =
    item.fieldIdentifier === undefined ? (item.baseType === undefined ? undefined : "baseType") : "fieldIdentifier";
  if (stray !== undefined) {
    const message = `A value of a variable that is not a record has no ${stray}: only the fields of a record have.`;
    throw item.reader.fail("unexpected-attribute", message);
  }
  return primitiveOf(item, baseType);
}

/** Reads a field of a record, which names itself and its type; a NULL field is left out. */
function readField(item: ValueItem): readonly [string, SingleValue][] {
  const { reader, fieldIdentifier, baseType } = item;
  if (fieldIdentifier === undefined || baseType === undefined) {
    const message = "A value of a variable of cardinality record needs the attributes fieldIdentifier and baseType.";
    throw reader.fail("missing-attribute", message);
  }
  const field = single(baseType, primitiveOf(item, baseType));
  return field === null ? [] : [[fieldIdentifier, field]];
}

/**
 * Builds the value of a variable from its `value` elements, or NULL when there are none (RR §2.6.6).
 *
 * @param owner - The element of the variable, which reports the problems of the whole value.
 * @param elements - The `value` elements, in order.
 * @param type - The type of the variable.
 * @throws `ReadError` when a value is not of the type, a single variable has several values, or a record repeats a field.
 */
export function readValue(owner: ElementReader, elements: readonly ElementReader[], type: VariableType): Value | null {
  const items = elements.map(readItem);
  if (type.cardinality === "record") {
    const fields = items.flatMap(readField);
    return owner.attempt("invalid-value", () => record(fields));
  }
  const { cardinality, baseType } = type;
  if (cardinality === "single") {
    const [first, second] = items;
    if (second !== undefined) {
      throw second.reader.fail("repeated-element", "A variable of cardinality single has at most one value.");
    }
    return first === undefined ? null : single(baseType, plainPrimitive(first, baseType));
  }
  const primitives = items.map((item) => plainPrimitive(item, baseType));
  return owner.attempt("invalid-value", () => container(cardinality, baseType, primitives));
}

const valueElement = (text: string, attributes: Readonly<Record<string, string>> = {}): XmlElement =>
  buildElement(RESULTS_NAMESPACE, "value", attributes, [text]);

/** Describes a type for a message. */
const describeType = ({
  cardinality,
  baseType,
}: {
  readonly cardinality: Cardinality;
  readonly baseType?: BaseType;
}): string => (cardinality === "record" || baseType === undefined ? cardinality : `${cardinality} ${baseType}`);

/**
 * Builds the `value` elements of a value, none for NULL.
 *
 * @param value - The value, or `null`.
 * @param type - The type the variable declares; the value must have it.
 * @param label - Names the variable in messages, such as `The candidate response of RESPONSE`.
 * @throws `DataError` when `value` is not a value of the type.
 */
export function valueElements(value: unknown, type: VariableType, label: string): XmlElement[] {
  if (value === null) return [];
  const checked = normalizeValue(value);
  const differs =
    checked.cardinality !== type.cardinality ||
    (checked.cardinality !== "record" && checked.baseType !== type.baseType);
  if (differs) {
    throw new DataError(`${label} is ${describeType(checked)}, but the variable declares ${describeType(type)}.`);
  }
  switch (checked.cardinality) {
    case "single":
      return [valueElement(formatPrimitive(checked.value, checked.baseType))];
    case "record":
      return [...checked.fields].map(([fieldIdentifier, field]) =>
        valueElement(formatPrimitive(field.value, field.baseType), { fieldIdentifier, baseType: field.baseType }),
      );
    default:
      return checked.values.map((primitive) => valueElement(formatPrimitive(primitive, checked.baseType)));
  }
}
