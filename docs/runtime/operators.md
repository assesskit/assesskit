# Scoring operators

<!-- cspell:ignore Jakrta -->

`operators` holds the custom operators that score what QTI's own expressions cannot: a mathematical expression typed as
LaTeX, a number with units, significant figures or credit tiers, a text by its normalization, edit distance and length, points
matched to areas, and whether a response reads at all. It also holds the calling convention that writes an operator into
response processing, the reader and comparator of the LaTeX subset that the operators read, the checks of worked steps, and the
length of a text. It imports `values`, `asi` and `processing`, and runs in any JavaScript runtime and in a page, so that a
device's local session scores alike.

```mermaid
flowchart LR
  key["A key: expression, number,<br/>text or areas"] -- "buildOperatorCall" --> call["qti-custom-operator<br/>class, definition, options"]
  call --> rp["Response processing<br/>of an item"]
  ops["createScoringOperators"] -- "customOperators" --> run["runResponseProcessing,<br/>an engine, validateAsi"]
  rp --> run
  run --> score["A share of the points,<br/>or NULL"]
  steps["Worked steps"] -- "compareMathSteps" --> checks["One check a line"]
```

| Function or constant                         | Does                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `createScoringOperators(options?)`           | The five operators by their definitions, for `customOperators`.                                            |
| `buildOperatorCall(call, response)`          | The `qti-custom-operator` that scores a response by a key, by the calling convention.                      |
| `OPERATOR_DEFINITIONS`, `OPERATOR_NAMESPACE` | The `urn:uuid:` definition of each operator, and the namespace of the attribute that carries its options.  |
| `compareMathSteps(steps, options?)`          | Whether each line of worked steps follows from the nearest earlier line that reads.                        |
| `countLength(text, unit)`                    | The length of a text in words, characters, characters without spaces or the squares of a manuscript sheet. |
| `DEFAULT_OPERATOR_LIMITS`, `OperatorLimits`  | The limits of what an operator reads from a response.                                                      |

The keys that the operators read, `expression`, `number`, `text` and `areas`, are the model of [keys](keys.md), with its limits;
`compileScoring` of [scoring](scoring.md) writes the calls of an item's keys.

## Quick start

```ts
import { buildOperatorCall, createScoringOperators, OPERATOR_DEFINITIONS } from "@assesskit/runtime/operators";

const call = buildOperatorCall(
  { operator: "expression-equivalent", key: { kind: "expression", expression: "2(x+1)" } },
  "RESPONSE",
);
call.class; // => "expression-equivalent"
call.definition; // => "urn:uuid:bca67099-ac73-46d0-acb0-2b025e61b552"
call.extensions[0].value;
// => '{"followThrough":null,"key":{"decimalSeparator":".","expression":"2(x+1)","form":"expression","kind":"expression","variables":{}}}'
const operators = createScoringOperators();
const score = operators.get(OPERATOR_DEFINITIONS["expression-equivalent"]);
score([{ cardinality: "single", baseType: "string", value: "2x+2" }], call); // => { cardinality: "single", baseType: "float", value: 1 }
score([{ cardinality: "single", baseType: "string", value: "\\frac{4x+4}{2}" }], call); // => { cardinality: "single", baseType: "float", value: 1 }
score([{ cardinality: "single", baseType: "string", value: "2x+1" }], call); // => { cardinality: "single", baseType: "float", value: 0 }
score([{ cardinality: "single", baseType: "string", value: "\\placeholder{}" }], call); // => null
```

An item calls an operator as any expression, and an engine, `runResponseProcessing` and `validateAsi` take the map as their
`customOperators`. A writer of the item gives the attribute the prefix `operator`, which `writeAsi` declares:

```ts
import { createRandom } from "@assesskit/runtime";
import { readAsi } from "@assesskit/runtime/asi";
import { buildOperatorCall, createScoringOperators } from "@assesskit/runtime/operators";
import { createItemVariables, runResponseProcessing } from "@assesskit/runtime/processing";
import { buildSingle } from "@assesskit/runtime/values";

const call = buildOperatorCall(
  { operator: "number-equivalent", key: { kind: "number", value: 0.25, fractions: true } },
  "RESPONSE",
);
const { item } = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    xmlns:operator="${call.extensions[0].namespace}" identifier="quarter" title="Quarter" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-response-processing>
    <qti-set-outcome-value identifier="SCORE">
      <qti-custom-operator class="${call.class}" definition="${call.definition}"
          operator:options='${call.extensions[0].value}'><qti-variable identifier="RESPONSE"/></qti-custom-operator>
    </qti-set-outcome-value>
  </qti-response-processing>
</qti-assessment-item>`);
const variables = createItemVariables(item);
const answered = {
  ...variables,
  responses: new Map(variables.responses).set("RESPONSE", buildSingle("string", "1/4")),
};
const context = { random: createRandom(1), customOperators: createScoringOperators() };
runResponseProcessing(item, answered, context).outcomes.get("SCORE"); // => { cardinality: "single", baseType: "float", value: 1 }
```

## The calling convention

Every item that calls an operator fixes the convention, so it never changes for a published item; `buildOperatorCall`
writes it and nothing else should.

| Part     | Rule                                                                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Element  | `qti-custom-operator` with the operator's name as `class` and its `urn:uuid:` as `definition`, which names no brand. `createScoringOperators` registers the definitions, which processing looks up first                                                                                  |
| Operands | The first is the response, a `qti-variable`; the second, with a follow-through alone, the earlier response. The key is never an operand: QTI has no value for an area, an answer's points and patterns, or an expression's sample ranges                                                  |
| Options  | One attribute, `options`, in `OPERATOR_NAMESPACE`, read by namespace whatever its prefix: the call's `key` and `followThrough` (`expression` and `variable`) as RFC 8785 canonical JSON, with every default resolved, so that a later change of a default never changes a published score |
| Result   | A share of the response's points, a float from 0 to 1, or NULL for a blank, unreadable or undecided response, which processing scores 0; `readable` returns a boolean                                                                                                                     |
| Throws   | Only for the item: options that do not parse, that the operator refuses, or past a limit of a key. A candidate's input never makes an operator throw                                                                                                                                      |
| Versions | A definition names its operator's semantics: a change that alters any verdict takes a new definition, and the earlier ones stay registered                                                                                                                                                |
| Blank    | A NULL operand, an empty container, or strings of white space and the spacing commands `\,`, `\;`, `\:`, `\!`, `\quad`, `\qquad` and `~`                                                                                                                                                  |

| Operator                | Response                                                                                                             | Options                                             | Result                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| `expression-equivalent` | single `string`                                                                                                      | `{ key, followThrough }`, an `expression` key       | 1 or 0                                     |
| `number-equivalent`     | single `string`, or `integer` or `float` read through its shortest decimal form; `ordered` `string` for `components` | `{ key, followThrough }`, a `number` key            | The share                                  |
| `text-equivalent`       | single `string`, or a container of strings                                                                           | `{ key }`, a `text` key                             | The share                                  |
| `hotspot-matching`      | `single`, `multiple` or `ordered` `point`; more points than areas is unreadable                                      | `{ key }`, an `areas` key of the scheme `keyed`     | Areas matched over `select`, at most 1     |
| `readable`              | single `string`, or a container of strings                                                                           | `{ key }`, the `expression`, `number` or `text` key | Whether every string reads as its key does |

A follow-through credits an answer that is right for an earlier response: the earlier response, read as an expression of the
subset, replaces `variable` (default `r`) in `followThrough.expression`, and the response earns the credit when it matches
the key or that value. A blank or unreadable earlier response leaves the key alone.

```ts
import { buildOperatorCall, createScoringOperators, OPERATOR_DEFINITIONS } from "@assesskit/runtime/operators";

const call = buildOperatorCall(
  {
    operator: "number-equivalent",
    key: { kind: "number", value: 7 },
    followThrough: { from: "PART_A", expression: "2r+1" },
  },
  "PART_B",
);
call.operands; // => [{ kind: "variable", identifier: "PART_B" }, { kind: "variable", identifier: "PART_A" }]
const score = createScoringOperators().get(OPERATOR_DEFINITIONS["number-equivalent"]);
const earlier = { cardinality: "single", baseType: "string", value: "4" };
score([{ cardinality: "single", baseType: "string", value: "9" }, earlier], call); // => { cardinality: "single", baseType: "float", value: 1 }
score([{ cardinality: "single", baseType: "string", value: "7" }, earlier], call); // => { cardinality: "single", baseType: "float", value: 1 }
score([{ cardinality: "single", baseType: "string", value: "8" }, earlier], call); // => { cardinality: "single", baseType: "float", value: 0 }
```

## Expressions

`expression-equivalent`, `readable` for an expression and `compareMathSteps` read one LaTeX subset: what MathLive writes from its
keyboard, and what an author types. The reader makes one pass over the text and a recursive descent no deeper than
`maxExpressionDepth`, so its cost is linear in the text. TeX's rules decide what a token is: `x^23` is x²·3 and `x_12` is x₁·2.

| Construct           | Read as                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numbers             | Digits with at most one decimal mark: `.`, or with `decimalSeparator` `,` a comma between digits and MathLive's `{,}`; `\,` between digits groups them. No exponent letter: `1.5e3` is 1.5 × e × 3; a power of ten is `\times10^{3}`. Two numbers side by side are unreadable                                                                                                                                                                                                                                                                                                                                                       |
| Variables           | A Latin letter but `e`, or a Greek letter's command but `\pi`; with a subscript of at most 8 letters or digits, a variable of its own, named `x_1`, `x_12` for `x_{12}`, `alpha_1`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Constants           | `\pi`, `e`, `\mathrm{e}`, `\exponentialE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Operators           | `+`, `-`, `\cdot`, `\times`, `*`, `/`, `\div`; juxtaposition is a product, so `2\frac{1}{2}` is 1; `^` with a group, one character or one command without arguments, once a base; `\%` divides by 100; `\degree` and `^\circ` multiply by π/180; `\pm` in a solution set only                                                                                                                                                                                                                                                                                                                                                       |
| Groups              | `{}`, `()`, `[]` and `\lbrack \rbrack`, each also with `\left` and `\right`; `\|…\|`, `\lvert…\rvert`, `\left\|…\right\|` and `\mathrm{abs}` are the absolute value                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Fractions and roots | `\frac`, `\dfrac`, `\tfrac`, `\cfrac` and `\sqrt`, each with groups or single tokens (`\frac12`, `\frac34x`, `\sqrt2`); `\sqrt[n]{}`, the principal root                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Functions           | `\sin \cos \tan \sec \csc \cot \arcsin \arccos \arctan \sinh \cosh \tanh \exp \ln`, `\log` and `\lg` (base 10), `\log_{b}`, `\operatorname{lb}` (base 2); each also under `\operatorname{}` or `\mathrm{}`, and in plain text before a bracket (`sin(x)`, `sqrt(x)`, `abs(x)`). A power after the name powers the value (`\sin^2x`), but `^{-1}` on `\sin`, `\cos` and `\tan` is the inverse. Without a bracket the argument is the run of numbers, variables, constants, fractions and roots that follows, with their powers and degree signs: `\sin 2x` is sin(2x), `\sin\frac{\pi}{6}` is sin(π/6), and `\sin x\cos x` a product |
| Relations           | One at most: `=`, `<`, `>`, `\le`, `\ge`, `\ne` and their aliases `\lt`, `\gt`, `\leq`, `\geq`, `\leqslant`, `\geqslant`, `\neq`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Lists               | In a solution set only: values or `v = value` joined by `,` (`;` when the decimal separator is `,`) or `\lor`, or inside `\{…\}` or `\left\lbrace…\right\rbrace`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Unicode and spacing | `−`, `×`, `·`, `÷`, `π`, `≤`, `≥`, `≠` and `°` as their commands; white space, `\,`, `\;`, `\:`, `\!`, `\quad`, `\qquad` and `~` skipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Unreadable          | Anything else, such as `\placeholder{}`, `\text{}`, `\imaginaryI`, `!` and `\infty`; a double superscript; a second relation; more than `maxInputLength` characters or `maxExpressionDepth` levels                                                                                                                                                                                                                                                                                                                                                                                                                                  |

The comparator evaluates both sides at 24 points, in complex arithmetic with SymPy's principal branches and the side of each
cut that SymPy takes, so that its verdicts equal SymPy's on real symbols: `\sqrt{x}\sqrt{x}` equals `x`, while `\ln(x^2)`
differs from `2\ln x` and `\sqrt{x^2}` from `x`, unless the key's range of x lies above 0.

| Rule           | Value                                                                                                                                                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Points         | 24. A variable's values are draws of `createRandom`, seeded with the FNV-1a 32-bit hash of `"expression-equivalent:"` and its name, uniform in its range (the key's `variables`, else -10 to 10), so a verdict depends on no call order and no other variable                       |
| A point used   | Both sides finite; a pole or an overflow skips the point. Fewer than 12 points used: undecided, NULL                                                                                                                                                                                |
| Agreement      | \|a − b\| at most 1e-12, or at most 1e-9 times the larger magnitude of the two sides: a sum's magnitude is the sum of its terms' magnitudes, a product's the product of its factors' over the size of its divisors, so `\cosh^2x-\sinh^2x` agrees with 1 where its terms reach 10^8 |
| `expression`   | Equivalent when the sides agree at every point used; a response with a relation is not equivalent, and reads                                                                                                                                                                        |
| `equation`     | Equivalent when the response's residual, left side minus right, is one non-zero constant times the key's at every point used: the same equation rearranged or scaled. A key whose residual is 0 everywhere is refused                                                               |
| `solution-set` | The key lists the solutions. Values that agree are one value; equivalent when each response value agrees with exactly one key value and every key value is met. When both name their variable, it is the same. More than `maxSolutions` values after `\pm` is unreadable            |

```ts
import { buildOperatorCall, createScoringOperators, OPERATOR_DEFINITIONS } from "@assesskit/runtime/operators";

const score = createScoringOperators().get(OPERATOR_DEFINITIONS["expression-equivalent"]);
const of = (text) => [{ cardinality: "single", baseType: "string", value: text }];
const equation = buildOperatorCall(
  { operator: "expression-equivalent", key: { kind: "expression", expression: "2x+3=7", form: "equation" } },
  "R",
);
score(of("4=2x+3-3+2"), equation).value; // => 0
score(of("x=2"), equation).value; // => 1
const roots = buildOperatorCall(
  {
    operator: "expression-equivalent",
    key: { kind: "expression", expression: "x=3 \\lor x=-3", form: "solution-set" },
  },
  "R",
);
score(of("x=\\pm3"), roots).value; // => 1
score(of("\\{3\\}"), roots).value; // => 0
const positive = buildOperatorCall(
  {
    operator: "expression-equivalent",
    key: { kind: "expression", expression: "2\\ln x", variables: { x: { min: 0.5, max: 10 } } },
  },
  "R",
);
score(of("\\ln\\left(x^2\\right)"), positive).value; // => 1
```

## Numbers

`number-equivalent` computes in exact rationals, so that its verdicts equal Python's `fractions` and `decimal`. The key's `value`
is read from `String(value)`, so 1.1 is 11/10.

| Rule                | Meaning                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading             | A sign `+`, `-` or `−`; digits with at most one decimal mark of `decimalSeparator`, which a leading mark may open (`.5`) but not end (`5.`); with `fractions`, `a/b` and a mixed `a b/c`; a power of ten as `e` or `E` and `n`, `\times10^{n}` or `×10^n`, \|n\| at most 400. A group separator is unreadable |
| Units               | The text after the number, its white space collapsed, names a unit of `units`, whose factor converts the value; a bare number is in the key's unit; a unit that `units` does not name is wrong, not unreadable                                                                                                |
| Tolerance           | Within when \|r − v\| is at most `absolute`, or at most `relative` × \|v\|; either holds when both are given; neither given is exact                                                                                                                                                                          |
| Significant figures | The response shows exactly `significantFigures` significant digits (zeros after the mark count, a whole number's trailing zeros do not) and is within the tolerance of `value` rounded to as many, half away from zero; a fraction shows none                                                                 |
| Credit              | Not right, the share of the first tier, highest share first, whose tolerance of `value` holds                                                                                                                                                                                                                 |
| Intervals           | 1 inside any interval, a `null` bound open; `value` is not read                                                                                                                                                                                                                                               |
| Components          | Each string against the component in its position, the share the right ones over all; a string that does not read is wrong, and the response is unreadable when none reads or it has more strings than components                                                                                             |
| Follow-through      | The larger of the shares against `value` and against the follow-through's value, a finite real; not with intervals or components                                                                                                                                                                              |

```ts
import { buildOperatorCall, createScoringOperators, OPERATOR_DEFINITIONS } from "@assesskit/runtime/operators";

const score = createScoringOperators().get(OPERATOR_DEFINITIONS["number-equivalent"]);
const of = (text) => [{ cardinality: "single", baseType: "string", value: text }];
const length = buildOperatorCall(
  {
    operator: "number-equivalent",
    key: {
      kind: "number",
      value: 2.5,
      units: { m: 1, cm: 0.01 },
      credit: [{ tolerance: { absolute: 0.1 }, share: 0.5 }],
    },
  },
  "R",
);
score(of("250 cm"), length).value; // => 1
score(of("2.45"), length).value; // => 0.5
score(of("2,5"), length); // => null
const figures = buildOperatorCall(
  { operator: "number-equivalent", key: { kind: "number", value: 3.14159, significantFigures: 3 } },
  "R",
);
score(of("3.14"), figures).value; // => 1
score(of("3.142"), figures).value; // => 0
```

## Texts

`text-equivalent` normalizes the response and each answer alike, in this order: `form` (default NFKC); `foldWidth`, the
Halfwidth and Fullwidth Forms block by NFKC (default on); `ignoreMarks`, nonspacing marks removed after NFD and the text
normalized back to `form` (default off); lower case by `toLowerCase` unless `caseSensitive` (default off); `collapseWhitespace`,
each run of Unicode White_Space one space and the ends trimmed (default on). A string matches an answer when it equals one of
its `texts` or fully matches one of its `patterns`, XSD regular expressions compiled by `compileXsdRegex`, or, with
`numericEquivalence`, reads as the value of one of its texts. With the scheme `words`, the response's words, split at white
space, are its strings.

Each answer and each string counts once: answers are taken in descending `points`, each kept when an augmenting path finds it a
string, the greedy rule of a transversal matroid, which keeps the most points, up to `count` answers; the share is the points
kept over the sum of the `count` highest. With `credit`, each string that the matching left, in order, takes the answer not yet
kept for which a tier earns the most: the first tier, highest share first, whose edit distance to one of the answer's texts
holds, in code points after normalization, at most `absolute` edits or `relative` × the text's length, measured within
`maxEditBand`. With `length`, the response's length, counted by `countLength` in the rule's unit, applies each effect whose
bound it passes, in order: `below` when under `share` × `min`, `above` when over `share` × `max`; `zero` sets the share to 0,
`deduct` takes its share off, floored at 0.

```ts
import { buildOperatorCall, createScoringOperators, OPERATOR_DEFINITIONS } from "@assesskit/runtime/operators";

const score = createScoringOperators().get(OPERATOR_DEFINITIONS["text-equivalent"]);
const of = (text) => [{ cardinality: "single", baseType: "string", value: text }];
const capital = buildOperatorCall(
  {
    operator: "text-equivalent",
    key: { kind: "text", answers: [{ texts: ["Jakarta"] }], credit: [{ tolerance: { absolute: 1 }, share: 0.5 }] },
  },
  "R",
);
score(of("  JAKARTA "), capital).value; // => 1
score(of("Jakrta"), capital).value; // => 0.5
score(of("Bandung"), capital).value; // => 0
```

With `numericEquivalence`, a string and an answer's text that both read as a number with nothing after it match when their
values are equal, in exact rationals: a sign, digits with the decimal mark `.`, `a/b` and a mixed `a b/c`, and a power of ten,
as `number-equivalent` reads them. So `.5`, `0.50`, `5e-1`, `1/2` and `2/4` are one value, as the numeric entries of the GRE and
the SAT accept equivalent forms of a number, and a text that is not a number still matches as written. `spelling` takes
`"exact"` alone: the sources list each accepted spelling, which an answer's `texts` hold, and none defines a rule that finds
variants by itself, so `"variants"` is refused.

```ts
import { buildOperatorCall, createScoringOperators, OPERATOR_DEFINITIONS } from "@assesskit/runtime/operators";

const score = createScoringOperators().get(OPERATOR_DEFINITIONS["text-equivalent"]);
const of = (text) => [{ cardinality: "single", baseType: "string", value: text }];
const half = buildOperatorCall(
  { operator: "text-equivalent", key: { kind: "text", answers: [{ texts: ["0.5"] }], numericEquivalence: true } },
  "R",
);
[".5", "0.50", "5e-1", "1/2", "2/4", "0.6", "0.5 kg"].map((text) => score(of(text), half).value);
// => [1, 1, 1, 1, 1, 0, 0]
```

## Hotspots and reading

`hotspot-matching` tests each point against each keyed area with `isInsideShape` of `processing`, edges inside, and takes a
maximum matching of points to the areas they hit (Hopcroft and Karp), so a point counts for one area at most; the share is the
areas matched over `select`, which defaults to the count of areas, at most 1. `readable` is true when every string of the
response is not blank and reads as the operator of its key reads it, within the limits: a flag that response processing sets
beside the score, to tell an unreadable answer from a wrong one.

```ts
import { buildOperatorCall, createScoringOperators, OPERATOR_DEFINITIONS } from "@assesskit/runtime/operators";

const operators = createScoringOperators();
const areas = buildOperatorCall(
  {
    operator: "hotspot-matching",
    key: {
      kind: "areas",
      scheme: "keyed",
      areas: [
        { id: "A", shape: "rect", coords: [0, 0, 10, 10] },
        { id: "B", shape: "circle", coords: [50, 50, 5] },
      ],
    },
  },
  "R",
);
const points = {
  cardinality: "multiple",
  baseType: "point",
  values: [
    [5, 5],
    [52, 51],
  ],
};
operators.get(OPERATOR_DEFINITIONS["hotspot-matching"])([points], areas).value; // => 1
const reads = buildOperatorCall({ operator: "readable", key: { kind: "expression", expression: "x" } }, "R");
operators.get(OPERATOR_DEFINITIONS.readable)(
  [{ cardinality: "single", baseType: "string", value: "\\frac{x}{" }],
  reads,
).value; // => false
```

## Worked steps and length

`compareMathSteps` checks each line of worked steps against the nearest earlier line that reads. A step is equivalent when it
and that line are expressions that agree, or equations that agree as an `equation` key does, or when the step is a solution set
or `v = c` of constant values, each of which makes that line's residual, or an expression line's value, agree with 0. It is
false otherwise, and null when it cannot be read, holds an inequality, which the comparator does not check, or has no earlier
line that reads; a line that is null anchors no later line. A root left out is no failed check: the rubric judges what the
checks leave.

`countLength` counts `words` as the runs between Unicode White_Space, `characters` as extended grapheme clusters by the rules of
UAX #29 on the runtime's own Unicode 17.0.0 data, `characters-without-spaces` as the clusters that are not White_Space, and
`manuscript-squares` as one square for each cluster but the line breaks, punctuation and spaces included.

```ts
import { compareMathSteps, countLength } from "@assesskit/runtime/operators";

compareMathSteps(["2x+3=7", "2x=4", "x=2", "x=3"]).map((check) => check.equivalent); // => [null, true, true, false]
compareMathSteps(["x^2=9", "x=\\pm3"])[1]; // => { step: 1, equivalent: true, from: 0 }
countLength("Saya suka  matematika.", "words"); // => 3
countLength(String.fromCodePoint(0x1f1ee, 0x1f1e9, 0x63, 0x61, 0x66, 0x65, 0x301), "characters"); // => 5
```

## Options

| Option of `createScoringOperators` | Does                                                                                               | Default                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------- |
| `limits`                           | The limits below, each a positive integer up to its cap; set them alike wherever an item is scored | `DEFAULT_OPERATOR_LIMITS` |

| Option of `compareMathSteps` | Does                                                               | Default                   |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------- |
| `decimalSeparator`           | The decimal mark of the steps                                      | `"."`                     |
| `variables`                  | The sample range of each variable, as an `expression` key gives it | none: -10 to 10           |
| `limits`                     | The limits of a line, as `createScoringOperators` takes them       | `DEFAULT_OPERATOR_LIMITS` |
| `maxSteps`                   | The most lines                                                     | 200                       |

A key's fields have the defaults of the [key model](keys.md#kinds); `buildOperatorCall` writes each one resolved: a default that means none is
`null` (`significantFigures`, `intervals`, `components`, `length`, a tolerance's bounds, `followThrough`), and one where empty
means absent is the empty list or object (`units`, `credit`, `variables`, `patterns`, a rule's `effects`).

## Limits

| What                                                                                     | Bound                                           | Default | Cap    | When exceeded                                                                         |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------- | ------- | ------ | ------------------------------------------------------------------------------------- |
| Characters of a response, all its strings together                                       | `maxInputLength`, in UTF-16 code units          | 2,000   | 20,000 | Unreadable: NULL, `readable` false, a null check; a key's expression: `SecurityError` |
| Levels of an expression                                                                  | `maxExpressionDepth`                            | 64      | 128    | As above                                                                              |
| Values of a solution set after `\pm`                                                     | `maxSolutions`                                  | 16      | 64     | As above                                                                              |
| Edit distance that a credit tier measures                                                | `maxEditBand`, in edits                         | 64      | 256    | A wider tier measures this far                                                        |
| Entries of a key: answers, texts and patterns, units, tiers, areas, coordinates in fours | `DEFAULT_KEY_LIMITS.entries` of [keys](keys.md) | 1,000   | fixed  | `SecurityError` with `limit` `entries`                                                |
| Characters of a pattern                                                                  | `DEFAULT_KEY_LIMITS.patternLength`              | 1,000   | fixed  | `SecurityError` with `limit` `patternLength`                                          |
| Lines of worked steps                                                                    | `maxSteps` of `compareMathSteps`                | 200     | none   | `SecurityError` with `limit` `maxSteps`                                               |
| Points of a hotspot response                                                             | the count of the key's areas                    | none    | none   | Unreadable: NULL                                                                      |

The reader is linear in the text, and the comparator evaluates 24 points; the worst expression of 2,000 characters reads and
compares in a few milliseconds (2.4 ms for a sum of 1,000 terms on a laptop). A text credit tier measures a banded edit distance, at most 2,000 × 129 cells an accepted
text; a hotspot response tests at most 1,000 points against areas of 4,000 coordinates, then matches them by Hopcroft and Karp.

## Differences from the references

| Case                                                                                                                | Resolution                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sides that differ by less than about 1e-9 of their size                                                             | Agree: the comparator evaluates in doubles. SymPy's exact verdict differs; the reference pairs leave out the sides closer than 1e-6 and count them     |
| A side that overflows a double at most points                                                                       | Undecided: NULL. SymPy decides; the reference pairs leave out expressions past 1e250 and count them                                                    |
| A pair that SymPy cannot simplify, as `\arcsin x+\arccos x`                                                         | The comparator decides from its points; the reference pairs leave such pairs out and count them                                                        |
| Normalization and case of a code point that the JavaScript engine's ICU and Python's `unicodedata` give differently | The engine's: `String.prototype.normalize` and `toLowerCase`. The reference texts use blocks where both agree                                          |
| A word of a text written without spaces, as Japanese or Thai                                                        | One word for each run between spaces, where `Intl.Segmenter` would split by a dictionary, which the browser baseline lacks: count `characters` instead |

## Errors

| Situation                                                                                                                                                                                                                    | Result                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A response that is blank, unreadable or past a limit                                                                                                                                                                         | No error: NULL, `readable` false, a null check                                                               |
| Options of an operator that do not parse, or a key that it refuses                                                                                                                                                           | `DataError` that names the path under `options`, which processing reports as a `ProcessingError` of the item |
| A key past a limit of a key                                                                                                                                                                                                  | `SecurityError` with `limit` and `maximum`                                                                   |
| A key that `buildOperatorCall` refuses: an expression that does not read under its form, an equation that holds everywhere, a key finite at fewer than 12 points, a pattern that does not compile, a count above the answers | `DataError` that names the path and says why                                                                 |
| A response operand of a type the operator does not read, or a missing operand                                                                                                                                                | `DataError`, a defect of the item                                                                            |
| `limits` that are not positive integers, or past their caps; another option                                                                                                                                                  | `DataError`                                                                                                  |
| More lines of steps than `maxSteps`                                                                                                                                                                                          | `SecurityError` with `limit` `maxSteps`                                                                      |

## Not included

| Not included                                                     | Why                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A symbolic algebra system: simplification, solving, derivatives  | Equivalence by sample points needs none and is linear in the text; a solution set lists its solutions, which an author's tool solves |
| Inequalities, integrals, sums, limits, matrices, complex numbers | Outside the subset that a math entry writes; a step with an inequality has a null check                                              |
| A spelling rule that finds variants by itself                    | No source defines which variants count; an answer lists each accepted spelling among its `texts`                                     |
| A decimal comma in the numeric equivalence of a text             | `1,500` is a thousand and a half where the sources write numbers; a `number` key reads the comma with `decimalSeparator`             |
| A compiler of keys into response processing                      | `compileScoring` of [scoring](scoring.md), which writes these calls                                                                  |
| Word segmentation by dictionary                                  | `Intl.Segmenter`, which the browser baseline lacks; `characters` counts any script                                                   |

## Build or adopt

The trusted libraries for two generic parts of these operators, each measured in place of the code it would replace, at its best
setting: `leven` with `maxDistance`, and `decimal.js` at 20 digits and at 900. Times are the fastest samples on a laptop with
Node.js 22, on 2026-11-04; sizes are esbuild's for the browser baseline, after gzip. Both parts stay built.

| The edit distance of a credit tier                                      | `leven` 4.1.0 (MIT) | Built: a band, in code points |
| ----------------------------------------------------------------------- | ------------------- | ----------------------------- |
| Alone                                                                   | 360 B               | 391 B                         |
| The subpath `operators`                                                 | 34,374 B            | 34,321 B                      |
| The text benchmark: 200 words against 50 answers, a tier of 2 edits     | 0.37 ms             | 0.53 ms                       |
| A response and a text of 2,000 characters, 50 edits apart, a tier of 64 | 12.2 ms             | 0.93 ms                       |
| The same text, a response past the tier                                 | 0.83 ms             | 0.11 ms                       |
| The 1,440 cases of the reference                                        | All agree           | All agree                     |
| Key `𠮷野`, response `吉野`, a tier of 1 edit                           | 0: two edits        | 0.5: one edit                 |

`leven` is faster on short words and weighs the same, but it counts UTF-16 code units where the rule counts code points, and
`maxDistance` stops it only once a whole row passes the cap: it computes each row whole, so two long texts near each other cost
the whole table, 13 times the band, which holds each accepted text to 2,000 × 129 cells. Mapping each code point above U+FFFF to
one unit would mend the count, not the time.

| The exact numbers of `number-equivalent`                                          | `decimal.js` 10.6.0 (MIT)                    | Built: BigInt rationals |
| --------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------- |
| Alone                                                                             | 13,027 B                                     | 558 B                   |
| The subpath `operators`                                                           | 47,769 B, over its budget of 43,000          | 34,321 B                |
| The number benchmark: `1 1/4 km` against a key with units, a tolerance and a tier | 5.0 µs at 20 digits, 5.3 µs at 900           | 3.3 µs                  |
| The 3,158 cases of the reference                                                  | All agree, at both                           | All agree               |
| Key 4 with the unit `yd` of factor 3, response `4/3 yd`                           | 0: 1.33… × 3 falls short of 4, at any digits | 1                       |

A decimal holds no third, so a fraction under a unit's factor can miss a value that it equals, and its 13 kB hold no reading of
units, fractions or `\times10^{n}`, which would stay built. No case of the reference tells the two apart, so these samples hold
what does:

```ts
import { buildOperatorCall, createScoringOperators, OPERATOR_DEFINITIONS } from "@assesskit/runtime/operators";

const operators = createScoringOperators();
const of = (text) => [{ cardinality: "single", baseType: "string", value: text }];
const name = buildOperatorCall(
  {
    operator: "text-equivalent",
    key: {
      kind: "text",
      answers: [{ texts: ["\u{20BB7}\u91CE"] }],
      credit: [{ tolerance: { absolute: 1 }, share: 0.5 }],
    },
  },
  "R",
);
operators.get(OPERATOR_DEFINITIONS["text-equivalent"])(of("\u5409\u91CE"), name).value; // => 0.5
const length = buildOperatorCall(
  {
    operator: "number-equivalent",
    key: { kind: "number", value: 4, units: { ft: 1, yd: 3 }, fractions: true },
  },
  "R",
);
operators.get(OPERATOR_DEFINITIONS["number-equivalent"])(of("4/3 yd"), length).value; // => 1
```

## Files

| File                                                                                                                       | Concept                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `create-scoring-operators.ts`, `build-operator-call.ts`, `definitions.ts`, `options.ts`, `schemas.ts`, `canonical-json.ts` | The operators, their calling convention and their options   |
| `expression-equivalent.ts`, `number-equivalent.ts`, `text-equivalent.ts`, `hotspot-matching.ts`, `readable.ts`             | One operator in each file                                   |
| `tokens.ts`, `read.ts`, `tree.ts`, `complex.ts`, `evaluate.ts`, `sample.ts`, `compare.ts`                                  | The reader of the subset, its arithmetic and the comparator |
| `rational.ts`, `number-text.ts`                                                                                            | Exact rationals and the reading of a number                 |
| `edit-distance.ts`, `matching.ts`, `count-length.ts`, `unicode-graphemes.ts`, `white-space.ts`, `operands.ts`              | Distances, matchings, lengths, and the operands             |
| `math-steps.ts`                                                                                                            | The checks of worked steps                                  |
| `limits.ts`                                                                                                                | The limits of what an operator reads                        |

## References

| Topic                                 | Reference                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Custom operators                      | QTI 3.0 ASI Information Model, `qti-custom-operator`                                                       |
| Canonical JSON of the options         | RFC 8785, JSON Canonicalization Scheme                                                                     |
| Expressions, equations, solution sets | SymPy 1.14.0 on real symbols; `validation/operators/expressions.py`                                        |
| Numbers                               | Python's `fractions` and `decimal`; `validation/operators/numbers.py`                                      |
| Texts                                 | Python's `unicodedata` 16.0.0 and an edit distance by dynamic programming; `validation/operators/texts.py` |
| Numeric equivalence of texts          | The numeric entries of the GRE and the SAT, which accept equivalent forms of a number                      |
| Grapheme clusters                     | Unicode Standard Annex #29 and `GraphemeBreakTest.txt` of Unicode 17.0.0                                   |
| Matching                              | Edmonds (1971) for the greedy rule of a matroid; Hopcroft and Karp (1973)                                  |
| Edit distance                         | Ukkonen (1985), the band of a Levenshtein distance                                                         |
