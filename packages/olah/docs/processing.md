# processing

`@luthfanwakan/olah/processing` runs the template, response and outcome processing of QTI 3.0: a tree interpreter for
every expression and rule, the variables of an item session, the six standard response processing templates, custom
operators, and the signatures of the operators for static checks. It imports `values` and `asi` and runs in any
JavaScript runtime. The delivery engine decides when each processing runs; these functions run it.

| Export                                                  | Purpose                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `createItemVariables(item, options?)`                   | The variables of a new item session, before template processing.                                |
| `runTemplateProcessing(item, variables, context)`       | Template processing, with the constraint loop.                                                  |
| `runResponseProcessing(item, variables, context)`       | Response processing, from the item's rules or its template.                                     |
| `runOutcomeProcessing(test, outcomes, scope, context)`  | Outcome processing of a test.                                                                   |
| `evaluate(expression, variables, item, context)`        | The value of an expression in an item.                                                          |
| `evaluateTestExpression(expression, test, outcomes, …)` | The value of an expression of a test: a pre-condition, branch rule or template default.         |
| `ItemVariables`, `CreateItemVariablesOptions`           | The six maps of an item session's variables, and the context values of a new session.           |
| `ProcessingContext`, `CustomOperator`, …                | The random source, custom operators, template resolver and limits that every run takes.         |
| `TestScope`, `ItemSessionView`, `ItemSessionFilter`     | What outcome processing reads from the delivery engine: item sessions and the test's variables. |
| `STANDARD_TEMPLATES`, `standardTemplateUri(uri)`        | The six standard templates as models, and the normalization of their URIs.                      |
| `OPERATOR_SIGNATURES`                                   | The operand and result types of the 64 expressions.                                             |
| `DEFAULT_PROCESSING_LIMITS`, `ProcessingLimits`         | The limit on the size of containers that expressions build.                                     |

## Example

```ts
import { createRandom } from "@luthfanwakan/olah";
import { readAsi } from "@luthfanwakan/olah/asi";
import { createItemVariables, runResponseProcessing, runTemplateProcessing } from "@luthfanwakan/olah/processing";
import { single } from "@luthfanwakan/olah/values";

const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="sum" title="Sum" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="integer"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-template-declaration identifier="A" cardinality="single" base-type="integer"/>
  <qti-template-declaration identifier="B" cardinality="single" base-type="integer"/>
  <qti-template-processing>
    <qti-set-template-value identifier="A"><qti-random-integer min="1" max="9"/></qti-set-template-value>
    <qti-set-template-value identifier="B"><qti-random-integer min="1" max="9"/></qti-set-template-value>
    <qti-template-constraint>
      <qti-not><qti-match><qti-variable identifier="A"/><qti-variable identifier="B"/></qti-match></qti-not>
    </qti-template-constraint>
    <qti-set-correct-response identifier="RESPONSE">
      <qti-sum><qti-variable identifier="A"/><qti-variable identifier="B"/></qti-sum>
    </qti-set-correct-response>
  </qti-template-processing>
  <qti-item-body><p>What is <qti-printed-variable identifier="A"/> + <qti-printed-variable identifier="B"/>?</p></qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>
</qti-assessment-item>`);

if (document.kind === "item") {
  const { item } = document;
  const context = { random: createRandom(42) };
  const instance = runTemplateProcessing(item, createItemVariables(item), context);
  instance.templates.get("A"); // { cardinality: "single", baseType: "integer", value: 6 }
  instance.correctResponses.get("RESPONSE"); // { cardinality: "single", baseType: "integer", value: 8 }

  const submitted = { ...instance, responses: new Map(instance.responses).set("RESPONSE", single("integer", 8)) };
  runResponseProcessing(item, submitted, context).outcomes.get("SCORE"); // { cardinality: "single", baseType: "float", value: 1 }
}
```

## Variables

`ItemVariables` holds six `Map`s from identifier to value, NULL as `null`. The processing functions never change the
variables they are given; they return new ones.

| Map                | Holds                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `contexts`         | Context variables and the built-in `QTI_CONTEXT`.                                              |
| `responses`        | Response variables, the last submitted values, and the built-ins `numAttempts` and `duration`. |
| `outcomes`         | Outcomes and the built-in `completionStatus`.                                                  |
| `templates`        | Template variables.                                                                            |
| `correctResponses` | The correct response of each response variable, as declared or set by template processing.     |
| `defaults`         | The default value of each declared variable, as declared or set by template processing.        |

`createItemVariables` starts a session (INFO §2.2.2):

| Variable           | Start                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Response           | NULL; the engine applies the default value at the start of the first attempt.                                                                |
| Outcome            | Its default value, else 0 for a single integer or float, else NULL.                                                                          |
| Template           | Its default value, else NULL.                                                                                                                |
| Context            | The value of the option `context`, else its default value, else NULL.                                                                        |
| `numAttempts`      | 0, a single integer.                                                                                                                         |
| `duration`         | 0, a single duration in seconds: the base type the duration operators and Results Reporting use.                                             |
| `completionStatus` | `not_attempted`, a single identifier.                                                                                                        |
| `QTI_CONTEXT`      | NULL unless the option `context` gives a record; its fields `testIdentifier`, `candidateIdentifier` and `environmentIdentifier` are strings. |

## Processing

| Function                | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runTemplateProcessing` | Template variables start from `variables.defaults`, so a test's template defaults apply when the caller puts them there. A false or NULL `qti-template-constraint` starts again from the start, at most 100 runs in all; after the last, the template variables keep their defaults and processing goes on after the constraint (INFO §5.150). An outcome whose default is set takes it as its value. Rules read only template and context variables (INFO §6.50). |
| `runResponseProcessing` | Runs the item's own rules, which win over a template; else the standard template its `template` names; else the rules that `resolveTemplate` returns for its `template-location`, or its `template`. An empty `template` names none. Outcomes start as given: the engine resets them for non-adaptive items (INFO §2.5).                                                                                                                                           |
| `runOutcomeProcessing`  | Outcomes start from the values given, and the others from their defaults, else 0 or NULL; INFO §2.9 resets test outcomes before each run, so the engine gives only the values a reset keeps, such as supplied external scores.                                                                                                                                                                                                                                     |

A condition runs the rules of its first true branch: a NULL or false expression skips its branch. A fragment runs its
rules, and an exit rule ends the run. An assignment checks the cardinality and base type of the value against the
variable, and promotes an integer to a float or duration (D5).

## Expressions

`evaluate` checks the operands of each operator against `OPERATOR_SIGNATURES`, NULL operands excepted, and raises a
`ProcessingError` for an operand of the wrong type. NULL, empty strings and empty containers are `null`.

| Topic                                                   | Rule                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NULL                                                    | An operator with a NULL operand gives NULL, except `qti-is-null` (true), `qti-container-size` (0), `qti-multiple`, `qti-ordered` and `qti-repeat` (left out), and `qti-and`, `qti-or`, `qti-any-n` (three-valued logic).                                                                                         |
| Integers                                                | Safe integers, computed exactly; a result outside them is NULL (D3). `qti-sum`, `qti-product`, `qti-subtract`, `qti-min` and `qti-max` give an integer only when every operand is one.                                                                                                                           |
| Floats                                                  | `qti-divide` and `qti-power` give NULL for a zero divisor and a result that is not finite (INFO §2.11.3.19, §2.11.3.30).                                                                                                                                                                                         |
| `qti-round`, `qti-truncate`                             | n for x in [n − 0.5, n + 0.5), and toward zero; NULL for NaN and ±INF (D4).                                                                                                                                                                                                                                      |
| `qti-round-to`, `qti-equal-rounded`                     | By the deciding digit of the shortest decimal of the number, half away from zero: 2.675 rounds to 2.68. `qti-equal-rounded` compares the rounded decimals.                                                                                                                                                       |
| `qti-math-operator`                                     | Every function of Table 8.21. NULL outside a function's domain, for NaN, for `ln` and `log` of 0, and for a reciprocal function of 0; a finite argument whose result overflows is NULL, an infinite argument keeps the infinite results of the table. `signum`, `floor` and `ceil` give integers, NULL for ±INF. |
| `qti-stats-operator`                                    | Mean, and sample and population variance and standard deviation; NULL for NaN, and for a variance or deviation of one value.                                                                                                                                                                                     |
| `qti-equal`                                             | Exact, absolute or relative, the bounds included unless excluded; a relative range for a negative x lies between its two ends.                                                                                                                                                                                   |
| `qti-match`, `qti-member`, `qti-delete`, `qti-contains` | Equality of `matchValues`: a pair is unordered. Durations are refused. An ordered container contains another as a contiguous run.                                                                                                                                                                                |
| `qti-map-response`                                      | The distinct values of a container are each mapped once, by the first entry with an equal key, else `default-value`; `lower-bound` and `upper-bound` apply to containers. String keys compare case-insensitively unless the entry is `case-sensitive`.                                                           |
| `qti-map-response-point`                                | Each point counts for the first area that holds it; each area counts once; a point in no area adds `default-value`.                                                                                                                                                                                              |
| `qti-inside`, areas                                     | `rect`, `circle`, `ellipse`, `poly` and `default`, edges included. A percentage coordinate is a `ProcessingError`: it needs the size of the image.                                                                                                                                                               |
| `qti-pattern-match`                                     | XML Schema regular expressions on the linear-time automaton of `values`, matching the whole string.                                                                                                                                                                                                              |
| `qti-string-match`, `qti-substring`                     | Case-insensitive comparison folds case with `toLowerCase`, independent of locale.                                                                                                                                                                                                                                |
| Random operators                                        | An index in [0, n) is `floor(uniform() × n)`; `qti-random-integer` draws an index over its admissible values, and `qti-random-float` is `min + uniform() × (max − min)`, in [min, max).                                                                                                                          |
| Outcome processing only                                 | `qti-number-*`, `qti-outcome-minimum`, `qti-outcome-maximum` and `qti-test-variables` raise a `ProcessingError` in an item.                                                                                                                                                                                      |

An attribute that names a variable (INFO §2.7.2) reads a template variable, or an outcome outside template processing:
integer and float attributes and `tolerance` items take the bare identifier, and `pattern` takes `{identifier}`, which
is the pattern itself when there is no such variable. A NULL variable makes the operator NULL.

## Standard templates

`STANDARD_TEMPLATES` holds `match_correct`, `map_response`, `map_response_point`, `CC2_match`, `CC2_match_basic` and
`CC2_map_response` as the models of the published files, keyed by `https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/<name>.xml`.
`standardTemplateUri` gives that key for `http` or `https`, `purl.imsglobal.org/spec/qti/v3p0/rptemplates/` or
`www.imsglobal.org/question/qti_v3p0/rptemplates/`, with `.xml` or without; a QTI 2.0, 2.1 or 2.2 URI names the template
of the same algorithm.

```ts
import { standardTemplateUri } from "@luthfanwakan/olah/processing";

standardTemplateUri("http://www.imsglobal.org/question/qti_v2p1/rptemplates/map_response");
// "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/map_response.xml"
```

## Context

| Field             | Meaning                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `random`          | The source of draws, such as `createRandom(seed)`: equal seeds give equal template values.                                                                                                                   |
| `customOperators` | Functions by the `definition` of a `qti-custom-operator`, else by its `class`. Default: none. An operator that is not registered is a `ProcessingError`; what an operator returns is checked like any input. |
| `resolveTemplate` | Returns the response processing of a template that is not standard. Default: none.                                                                                                                           |
| `limits`          | `maxContainerSize`: the most values a container that an expression builds may hold. Default: `10000`. A larger container is a `SecurityError`.                                                               |

## Test scope

Outcome processing reads the item sessions of a test through a `TestScope`, which the delivery engine implements.

| Method                              | Returns                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `itemSessions(filter)`              | The sessions of the selected item instances in a section and its sub-sections, with or without categories.                                               |
| `itemSession(identifier, instance)` | The session of `ITEM` or `ITEM.n` in `ITEM.VAR` and `ITEM.n.VAR`.                                                                                        |
| `variable(identifier)`              | A variable of the test that is not an outcome: a context variable, `duration`, `PART.duration`, or NULL for a variable of an item ref without a session. |

An `ItemSessionView` gives the item ref, the item and its variables. Item variables read through it take the names of
the ref's variable mappings, and its weights scale integer and float values into floats, 1 when the weight is missing.

| Expression                        | Counts or collects                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `qti-number-selected`             | Every session.                                                                                                                                                     |
| `qti-number-presented`            | Sessions with at least one attempt.                                                                                                                                |
| `qti-number-responded`            | Sessions with an attempt and a response other than its declared default.                                                                                           |
| `qti-number-correct`              | Sessions whose responses all match their correct responses.                                                                                                        |
| `qti-number-incorrect`            | Sessions with an attempt and a response that does not match.                                                                                                       |
| `qti-outcome-minimum`, `-maximum` | The weighted `normal-minimum` or `normal-maximum` of a single outcome; items without a minimum are left out, and an item without a maximum makes the maximum NULL. |
| `qti-test-variables`              | The single values of a variable, NULL left out, as a multiple container.                                                                                           |

Correct and incorrect counts leave out items without response variables and items with one that has no correct response.

## Decisions

Where the specifications are silent or contradict themselves:

| Gap      | Decision                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------- |
| G1, G29  | `qti-round`, `qti-truncate`, `floor` and `ceil` of ±INF are NULL (D4).                                  |
| G3       | An integer is promoted to a float or duration variable; any other mismatch is a `ProcessingError` (D5). |
| G4       | A relative tolerance with a negative x uses the range between its two ends.                             |
| G5       | `qti-map-response` of NULL is NULL; the bounds apply to containers only.                                |
| G6       | Case-insensitive comparison uses `toLowerCase`, independent of locale.                                  |
| G7       | A custom operator that is not registered is a `ProcessingError`.                                        |
| G13      | A population variance or standard deviation of one value is NULL.                                       |
| G15      | `qti-random-float` draws from [min, max), a deviation of measure zero.                                  |
| G17      | A template that is neither standard nor resolved is a `ProcessingError`.                                |
| G28      | `ln` and `log` of 0 are NULL: the operator text wins over Table 8.21.                                   |
| G30      | An ordered `qti-contains` looks for a contiguous run.                                                   |
| G31      | `qti-index` with n ≤ 0 is NULL.                                                                         |
| G32, G33 | `qti-random-integer` with min > max or step ≤ 0, and `qti-random-float` with min > max, are NULL.       |
| G34      | `tolerance` items that are not numbers name variables.                                                  |
| G35      | `qti-test-variables` ignores a weight with `base-type="integer"`.                                       |
| G43      | QTI 2.x template URIs name the template of the same algorithm.                                          |

Further readings, each tested: an attribute out of its range at run time (`figures`, a negative tolerance) makes the
operator NULL, as G31 does for `qti-index`; "not a numerical value" for `qti-min`, `qti-max` and `qti-stats-operator`
is NaN; `qti-any-n` with min > max is false; a result of `qti-round-to` beyond the floats is NULL; and `qti-test-variables`
and the outcome bounds leave out items without the variable.
