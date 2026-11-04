import fc from "fast-check";
import {
  BASE_TYPES,
  type BaseType,
  buildContainer,
  buildRecord,
  buildSingle,
  type Primitive,
  type SingleValue,
  type Value,
} from "../../src/values/index.js";

const NAME_START = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_";
const NAME_REST = `${NAME_START}0123456789.-`;

/** An identifier (an `NCName`) of one to twelve characters. */
export const identifier: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...NAME_START), fc.array(fc.constantFrom(...NAME_REST), { maxLength: 11 }))
  .map(([first, rest]) => first + rest.join(""));

/** Characters that XML 1.0 allows and that need escaping, white space that a parser keeps, and non-ASCII characters. */
const TEXT_CHARACTERS = [..."ab 1&<>\"'\t\n\ré€日\u{1F600}"];

/** Text that a document can carry as it is. */
export const text: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...TEXT_CHARACTERS), { maxLength: 10 })
  .map((characters) => characters.join(""));

/** Text that is not empty. */
export const nonEmptyText: fc.Arbitrary<string> = text.filter((value) => value !== "");

/** A string without white space, such as a file reference. */
const token: fc.Arbitrary<string> = fc.stringMatching(/^[A-Za-z0-9._/-]{1,12}$/);

/** A URI that `xs:anyURI` accepts. */
export const uri: fc.Arbitrary<string> = fc.stringMatching(/^[a-z]{1,6}:\/\/[a-z0-9.]{1,10}\/[A-Za-z0-9._-]{0,8}$/);

/** An integer in the safe range, never `-0`. */
export const safeInteger: fc.Arbitrary<number> = fc.maxSafeInteger();

/** An `xs:double`: any number, `NaN`, the infinities and `-0` included. */
export const double: fc.Arbitrary<number> = fc.double();

/**
 * A `file` that survives its XML form: the reference alone is written, and a read file has the content type of unknown
 * bytes (D7, G10).
 */
const file: fc.Arbitrary<Primitive> = token.map((reference) => ({ reference, mimeType: "application/octet-stream" }));

/** The primitives of each base type that read back exactly from their lexical forms. */
export const primitives: Readonly<Record<BaseType, fc.Arbitrary<Primitive>>> = {
  boolean: fc.boolean(),
  directedPair: fc.tuple(identifier, identifier),
  duration: double,
  file,
  float: double,
  identifier,
  integer: safeInteger,
  pair: fc.tuple(identifier, identifier),
  point: fc.tuple(safeInteger, safeInteger),
  string: nonEmptyText,
  uri,
};

/** A base type. */
export const baseType: fc.Arbitrary<BaseType> = fc.constantFrom(...BASE_TYPES);

function nonNull<T>(value: T | null): T {
  if (value === null) throw new Error("The generator built a NULL where it meant a value.");
  return value;
}

/** A single value of the given base type. */
const singleOf = (type: BaseType): fc.Arbitrary<SingleValue> =>
  primitives[type].map((primitive) => nonNull(buildSingle(type, primitive)));

/** A value of the given cardinality and base type, or NULL (`null`) sometimes. */
export function valueArbitrary(
  cardinality: "single" | "multiple" | "ordered",
  type: BaseType,
): fc.Arbitrary<Value | null> {
  if (cardinality === "single")
    return fc.oneof({ weight: 5, arbitrary: singleOf(type) }, { weight: 1, arbitrary: fc.constant(null) });
  return fc.oneof(
    {
      weight: 5,
      arbitrary: fc
        .array(primitives[type], { minLength: 1, maxLength: 5 })
        .map((values) => buildContainer(cardinality, type, values)),
    },
    { weight: 1, arbitrary: fc.constant(null) },
  );
}

/** A record of one to four fields with base types of their own, or NULL sometimes. */
export const recordValue: fc.Arbitrary<Value | null> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc
      .uniqueArray(fc.tuple(identifier, baseType.chain(singleOf)), {
        minLength: 1,
        maxLength: 4,
        selector: ([name]) => name,
      })
      .map((fields) => buildRecord(fields)),
  },
  { weight: 1, arbitrary: fc.constant(null) },
);

/** An arbitrary that is `undefined` sometimes, for an optional field. */
export const optional = <T>(arbitrary: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> =>
  fc.option(arbitrary, { nil: undefined });

/** Drops the fields that are `undefined`, because a model that a reader builds has no such fields. */
export function defined<T extends object>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as T;
}
