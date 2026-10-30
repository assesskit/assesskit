# Values

`values` holds the values of QTI variables: base types, cardinalities, NULL, lexical forms, equality and promotion, two
JSON forms, and the regular expressions of XML Schema. It imports no other module and runs in any JavaScript runtime.

```ts
import { container, matchValues, single } from "@luthfanwakan/olah/values";

const a = container("multiple", "identifier", ["A", "B", "B"]);
const b = container("multiple", "identifier", ["B", "A", "B"]);
if (a !== null && b !== null) matchValues(a, b); // true
single("string", ""); // null: the empty string is NULL
```

## Model

A value is a `SingleValue`, a `ContainerValue` (cardinality `multiple` or `ordered`) or a `RecordValue`. NULL, the absence
of a value, is `null` (INFO §2.2.2). Build values with `single`, `container` and `record`: they check their arguments,
copy them and return `null` for what is NULL, so a `Value` is never empty.

| Base type              | JavaScript                           | Notes                                                                     |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `boolean`              | `boolean`                            |                                                                           |
| `integer`              | `number`                             | A safe integer; `-0` becomes `0`                                          |
| `float`                | `number`                             | Any double, including `NaN`, infinities and `-0`                          |
| `duration`             | `number`                             | Seconds, any double                                                       |
| `string`               | `string`                             | The empty string is NULL                                                  |
| `identifier`           | `string`                             | Checked by `isIdentifier`; compared case-sensitively                      |
| `uri`                  | `string`                             | Any string                                                                |
| `point`                | `[x, y]`                             | Two safe integers                                                         |
| `pair`, `directedPair` | `[first, second]`                    | Two identifiers; a pair is unordered when matched, a directed pair is not |
| `file`                 | `{ reference, mimeType, fileName? }` | A reference to bytes in host storage, never the bytes                     |

| Cardinality | Value                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| `single`    | One value of a base type                                                                                    |
| `multiple`  | A multiset: order does not matter, repeated values count                                                    |
| `ordered`   | A sequence                                                                                                  |
| `record`    | A `Map` from field identifier to a single value, each field with its own base type; insertion order is kept |

A container holds at least one value and no empty string; a record holds at least one field. `normalizeValue(value)` checks
an untrusted value deeply and returns a copy of it. `BASE_TYPES` and
`CARDINALITIES` list the terms of `BaseTypeEnum` and `CardinalityEnum`, and `isBaseType` and `isCardinality` test a string
against them.

Identifier-keyed data lives in `Map`s, so a field named `__proto__` is data.

## Lexical forms

`parsePrimitive(text, baseType)` reads the text of a value as a document writes it, and `formatPrimitive(value, baseType)`
writes it. Except for `string`, white space around the text is dropped and runs of white space count as one space.

| Base type              | Lexical form                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `boolean`              | `true`, `false`, `1`, `0`                                                                            |
| `integer`              | `xs:integer` within the safe integers; a larger integer is a `DataError` (G2)                        |
| `float`, `duration`    | `xs:double`, with `INF`, `-INF` and `NaN`; a duration is in seconds (ISO 8601 only in JSON)          |
| `string`, `uri`        | The text                                                                                             |
| `identifier`           | An identifier                                                                                        |
| `point`                | `x y`, as in `118 184`                                                                               |
| `pair`, `directedPair` | `first second`, as in `W G1`                                                                         |
| `file`                 | The reference alone; the content type reads as `application/octet-stream` and the name is lost (G10) |

```ts
import { formatPrimitive, parsePrimitive } from "@luthfanwakan/olah/values";

parsePrimitive("118 184", "point"); // [118, 184]
parsePrimitive(" 12 ", "integer"); // 12
formatPrimitive([118, 184], "point"); // "118 184"
```

`parsePrimitive` returns the type of the base type you give it when that is a literal: a `number` for `"integer"`, `"float"`
and `"duration"`, a `boolean` for `"boolean"`, a `string` for `"string"`, `"identifier"` and `"uri"`, and so on.

### Dates and durations in documents

Documents write dates and durations in forms of XML Schema and ISO 8601 that are not base types of QTI.

| Function                 | Form                                                                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isXsdDateTime(text)`    | `YYYY-MM-DDThh:mm:ss` with an optional fraction and time zone, a four-digit year from `0001`, a real day of that month, and `24:00:00` for the end of a day: the `xs:dateTime` of RR's `datestamp`. |
| `isXsdDate(text)`        | `YYYY-MM-DD` with a four-digit year from `0001`, a real day of that month and no time zone: the `DateDType` of UD's `lastUpdated`.                                                                  |
| `parseIsoDuration(text)` | An ISO 8601 duration in seconds. Weeks, days, hours, minutes and seconds only; years and months are a `DataError` (G14).                                                                            |

```ts
import { isXsdDate, isXsdDateTime, parseIsoDuration } from "@luthfanwakan/olah/values";

isXsdDateTime("2020-08-25T18:19:20"); // true
isXsdDateTime("2020-08-25"); // false
isXsdDate("2004-07-04"); // true
isXsdDate("2004-7-4"); // false
parseIsoDuration("PT2M0.049722S"); // 120.049722
```

## Identifiers and lists

`isIdentifier` accepts the identifiers of INFO §4.1.1: an `NCName` of XML Namespaces with the characters of XML 1.0, fifth
edition. Its 32-character recommendation and the reservation of the period for prefixes are style rules that it does not
check.

`parseIdentifierList` and `formatIdentifierList` read and write an `IdentifierList` (INFO §9.1.1), and `parseIntegerList`
and `formatIntegerList` an `IntegerList` (INFO §9.1.2) whose items are `xs:int`, from -2147483648 to 2147483647. Items are
separated by white space; an empty text is an empty list.

## Matching and promotion

`matchValues(a, b)` is the meaning of `qti-match` once neither value is NULL (INFO §2.11.3.28). Values of another
cardinality or base type never match. Floats compare as `SameValueZero`: `NaN` matches `NaN` and `0` matches `-0`.

`promote(value, "float")` turns a value of base type `integer` into `float`, and `promote(value, "duration")` into
`duration`, keeping the numbers and the cardinality. It is the type promotion of weighted outcomes (INFO §2.11.1.2) and
of assigning an integer to a `float` or `duration` variable. A value that already has the target base type is returned
as it is; any other conversion is a `DataError`.

```ts
import { promote, single } from "@luthfanwakan/olah/values";

promote(single("integer", 3), "float"); // { cardinality: "single", baseType: "float", value: 3 }
```

## JSON

Both forms need the cardinality and base type of the variable to write a NULL; they come from its declaration, a
`ValueDeclaration` `{ cardinality, baseType }` with no base type for a record.

| Function                       | Form                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `toJsonValue`, `fromJsonValue` | The binding of BPIG Appendix C, which PCIs use: `{ "base": ... }`, `{ "list": ... }`, `{ "record": ... }`             |
| `toWireValue`, `fromWireValue` | olah's own form for state, views and actions: the same JSON in a `WireValue` that names its cardinality and base type |

The binding follows Appendix C.1 to C.3 with these differences:

| Case                       | olah                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`                     | `{ "reference", "mime", "name" }`; inline `data` is a `DataError`, because the host stores the bytes                                                                                                                                                                                                                   |
| `duration`                 | Written as `PT<seconds>S` with the shortest decimal. Read as an ISO 8601 duration of weeks, days, hours, minutes and seconds, and only the seconds may have a fraction. Years or months are a `DataError`, because they have no fixed length; that includes the appendix's own example `P10Y3M20DT4H30M25S` (G14, G39) |
| `NaN`, `INF`, `-INF`, `-0` | JSON cannot carry them; a `float` or `duration` with one is the string `"NaN"`, `"INF"`, `"-INF"` or `"-0"`                                                                                                                                                                                                            |
| NULL fields of a record    | Left out when read: a record holds no NULL (G37)                                                                                                                                                                                                                                                                       |
| `intOrIdentifier`          | Read as the declared `integer` or `identifier`; in a record, by JSON type: a number is an integer, a string an identifier (G38). Never written                                                                                                                                                                         |
| Empty list, empty string   | Read as NULL                                                                                                                                                                                                                                                                                                           |

A `WireValue` is `{ cardinality, baseType?, value }`, where `value` is the Appendix C JSON, or `null` for NULL. It decodes
without a declaration and loses nothing through `JSON.stringify` and `JSON.parse`: it keeps `multiple` apart from
`ordered`, gives a NULL its type, and keeps `NaN`, infinities and `-0`. A record has no `baseType`.

```ts
import { fromJsonValue, single, toJsonValue, toWireValue } from "@luthfanwakan/olah/values";

const declaration = { cardinality: "single", baseType: "duration" } as const;
const json = toJsonValue(single("duration", 90.5), declaration); // { base: { duration: "PT90.5S" } }
fromJsonValue(json, declaration); // { cardinality: "single", baseType: "duration", value: 90.5 }

toWireValue(null, { cardinality: "ordered", baseType: "point" });
// { cardinality: "ordered", baseType: "point", value: null }
```

## Regular expressions

`compileXsdRegex(pattern, options?)` compiles a pattern of XML Schema's regular expressions (Part 2, Appendix F), the
dialect of `qti-pattern-match` and `pattern-mask` (INFO §5.104.1, §5.48.4, §5.162.5). It returns an `XsdPattern` whose
`matches(text)` tells whether the whole text matches.

```ts
import { compileXsdRegex } from "@luthfanwakan/olah/values";

const pattern = compileXsdRegex("\\d{3}-\\p{Lu}+");
pattern.matches("123-ABC"); // true
pattern.matches("123-ABCd"); // false
```

| Feature                 | Rule                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match                   | The whole text; `^` and `$` are ordinary characters; `.` is any character but line feed and carriage return                                                                                   |
| Quantifiers             | `?`, `*`, `+`, `{n}`, `{n,}`, `{n,m}`                                                                                                                                                         |
| Classes                 | `[a-z]`, `[^a-z]`, subtraction `[a-z-[aeiou]]`; a `-` stands for itself only at the start or the end of a group                                                                               |
| Escapes                 | `\n \r \t` and `\` before `\ \| . - ^ ? * + { } ( ) [ ]`                                                                                                                                      |
| Multi-character escapes | `\s \S \d \D \w \W` and, for XML names, `\i \I \c \C` with the characters of XML 1.0, fifth edition                                                                                           |
| Categories              | `\p{L}` and the other six major classes, their 29 subcategories such as `\p{Lu}`, and `\P{...}`; there is no `Cs`; `\d` is `\p{Nd}`, `\w` is every character but `\p{P}`, `\p{Z}` and `\p{C}` |
| Blocks                  | `\p{IsBasicLatin}` and the other blocks of Unicode 3.1 under the names of XML Schema (`IsGreek`, not `IsGreekandCoptic`); an unknown block is a `DataError`                                   |

Categories are those of Unicode 17.0.0 (`UNICODE_VERSION`), held in tables of the package, so a pattern matches the
same text in every runtime whatever Unicode version the runtime has. The major class `\p{C}` also holds lone surrogates,
which a JavaScript string can contain. A surrogate pair is one character.

### Limits

No pattern can make a text expensive: the pattern becomes a Thompson automaton over code points, and `matches` runs a
deterministic automaton that it builds as the text needs it, in time linear in the text. Only the size of the pattern is
limited, at compile time, with `options.limits`; a limit left out keeps its default.

| Limit       | Default | Unit   | Meaning                                                                                                        |
| ----------- | ------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `maxStates` | 100,000 | states | The most states of the automaton once counted repeats are expanded: `a{100000}` is allowed, `a{100001}` is not |
| `maxDepth`  | 100     | levels | The most levels that groups and class subtractions may be nested; it bounds the recursion of the parser        |

`DEFAULT_XSD_REGEX_LIMITS` holds the defaults. A limit that is not a positive integer is a `DataError` whose message begins
`The limit maxStates`, and so on for each name. A pattern that is not in the dialect, or is above a limit, is a `DataError`
that names the problem and its position in characters. A repeat of a node that has no state, such as `(){500000000}`,
compiles at once, whatever its count. The test suite runs the regular expression tests of the
W3C XML Schema test suite and ReDoS fixtures such as `(a+)+$` on 100,000 characters.

## Unicode tables

`unicode-blocks.ts` and `unicode-categories.ts` are generated by `pnpm unicode` from `Blocks-4.txt` of Unicode 3.1 and
`UnicodeData.txt` of Unicode 17.0.0, each pinned by its SHA-256 in `scripts/unicode.ts`. The generator fails when a
download differs from its pin. [NOTICE](../NOTICE) states the license of the data.

## Errors

Every function throws `DataError` for an argument of the wrong type or a value outside its type, with a sentence that says
what is expected. None throws for NULL: `null` is a value of the model.
