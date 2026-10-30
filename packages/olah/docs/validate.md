# validate

`@luthfanwakan/olah/validate` finds what a schema cannot: the rule sets of BIND §5, the constraints of the Information
Model, the static types of processing, the structure of a test, the covers of externally scored outcomes, the files of a
package, and the rules of Results Reporting and personal needs profiles. It reports what would fail or misbehave when
content runs, before it does. It imports every module below it in the layers (`xml`, `values`, `asi`, `results`,
`usage`, `pnp`, `metadata`, `processing`, `interactions`, `pci`, `content`, `cat`, `package`) and runs in any JavaScript
runtime. Validating a document against the official XSD schemas is `validateXmlFiles` of [node](node.md); `olah validate` of the
[command line](cli.md) runs both.

| Export                                          | Purpose                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `validateAsi(document, options?)`               | The issues of an item, test, section, stimulus, response processing or outcome declaration.          |
| `validateTest(test, base, resolvers, options?)` | The issues of a test and of every section, item and stimulus it names: the static gate of an engine. |
| `validatePackage(pkg, options?)`                | The issues of a package: its files, its resources and every document in them.                        |
| `validateResults(result)`                       | The issues of a Results Reporting document.                                                          |
| `validatePnp(profile)`                          | The issues of the sets of a personal needs profile.                                                  |
| `validatePnpNamespace(root)`                    | The elements of a PNP document in a namespace other than the schema's.                               |
| `ValidateOptions`                               | The options of the first three.                                                                      |

Every function returns `readonly Issue[]` and none throws for content that is invalid; the order of the issues is the
order in which the checks found them. A wrong argument, or a model whose shape is not the one the schema gives it, is a
`DataError`. The functions are pure: they read the model and change nothing.

## Example

```ts
import { readAsi } from "@luthfanwakan/olah/asi";
import { validateAsi } from "@luthfanwakan/olah/validate";

const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="capital" title="Capital" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>paris</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="integer"/>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-simple-choice identifier="paris">Paris</qti-simple-choice>
      <qti-simple-choice identifier="rome">Rome</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
  <qti-response-processing>
    <qti-response-condition>
      <qti-response-if>
        <qti-match><qti-variable identifier="RESPONSE"/><qti-correct identifier="ANSWER"/></qti-match>
        <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value>
      </qti-response-if>
    </qti-response-condition>
  </qti-response-processing>
</qti-assessment-item>`);

const issues = validateAsi(document, { path: "capital.xml" });
for (const { severity, code, source } of issues) console.log(severity, code, source);
// warning olah/validate/standard-outcome INFO §2.2.2.3, BPIG §3.5
// error olah/validate/undeclared-variable INFO §2.2.2
// error olah/validate/assignment-type INFO §5.130.2
issues[2]?.message; // 'The variable "SCORE" is a single integer and cannot be set to a single float.'
issues[2]?.location; // { path: "capital.xml", element: "qti-assessment-item/qti-response-processing/…/qti-set-outcome-value" }
```

## Issues

An `Issue` has a `severity`, a `code`, a `message` that says what is wrong and what is expected, a `source` that names
the specification and section of the rule, and a `location` with the `path` of the file and the `element` path.

- An `error` is content that breaks a rule or fails when it runs. A `warning` is content that runs but deviates from a
  recommendation or cannot do what it appears to.
- The `code` of the rule sets of BIND §5.3 is the identifier of the rule set, such as `RULE_SET_INTERACTION_02B`. The
  other codes are `olah/validate/<name>`, and `olah/covers/<name>` for the covers of external scores.
- `validateTest` and `validatePackage` check many documents. Each issue names its own file in `location.path`: a test
  is reported at the path `base`, its sections, items and stimuli at the paths the resolvers give, and the files and
  resources of a package at `imsmanifest.xml`.
- A reference that cannot be resolved, or a document that cannot be read, is one issue: the issues of a `ReadError`, or
  `olah/validate/unresolved-reference` for any other error of olah. What is left unresolved is not checked further.

## Options

| Option            | Default | Effect                                                                                                                                                                                                                                                                 |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`            | none    | The path of the document, named in the location of its issues. Used by `validateAsi` only.                                                                                                                                                                             |
| `customOperators` | none    | A `Map` from the `definition` or `class` of a `qti-custom-operator` to its function. When given, an operator that no entry serves is an error (G7); when absent, custom operators are not checked.                                                                     |
| `resolveTemplate` | none    | Returns the response processing for a template URI other than the six standard ones, called with the `template-location` of the item, else its `template`. When absent, only the standard templates are known. `validatePackage` adds the templates the package holds. |

## Rule sets of BIND §5

Each rule set is checked against the typed model, so `qti-label` (a QTI element) and `label` (HTML) are different
elements, as the schema says. A rule set with the suffix `A` forbids an interaction inside another, `B` checks the
attributes of the interaction and the base type of its response.

| Code                                     | Reported when                                                                                                                                                                                       | Source          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `olah/validate/figure-multiplicity`      | A `figure` has more than one `figcaption`.                                                                                                                                                          | BIND §5.1.1     |
| `olah/validate/ruby-multiplicity`        | A `ruby` has more than one `rp`, `rt` or `rtc`.                                                                                                                                                     | BIND §5.1.2     |
| `RULE_SET_ARIA_ROLES_1`                  | A `source` has a `role`, or an `h1` has a `role` other than `heading`, `tab` or `presentation`.                                                                                                     | BIND §5.3.1     |
| `RULE_SET_GENERAL_1`                     | `qti-outcome-minimum`, `qti-outcome-maximum` or `qti-test-variables` in response processing.                                                                                                        | BIND §5.3.2     |
| `RULE_SET_INTERACTION_01A` to `20A`      | One of the 20 interactions inside another interaction, in the model or in the XML that it keeps (PCI, custom).                                                                                      | BIND §5.3.3–41  |
| `RULE_SET_INTERACTION_01B` to `19B`      | A `max-choices`, `max-associations`, `max-plays` or `upper-bound` below its minimum; equal `string-identifier` and `response-identifier`; a response whose base type the interaction does not bind. | BIND §5.3.4–40  |
| `RULE_SET_INTERACTION_20B`               | A context or template variable that a portable custom interaction passes and the item does not declare.                                                                                             | BIND §5.3.42    |
| `RULE_SET_INTERACTION-RELATED_1` to `_4` | A `match-max` other than 0 below `match-min` on `qti-gap-text`, `qti-gap-img`, `qti-associable-hotspot` or `qti-simple-associable-choice`.                                                          | BIND §5.3.43–46 |
| `RULE_SET_RUBRICBLOCK`                   | A `qti-rubric-block` inside a `qti-rubric-block`.                                                                                                                                                   | BIND §5.3.47    |
| `RULE_SET_SPECIFIC_CLASS_OUTCOMEDEC`     | A `mastery-value` outside `normal-minimum` and `normal-maximum`.                                                                                                                                    | BIND §5.3.48    |
| `RULE_SET_SPECIFIC_CLASS_RESPONSEDEC`    | A cardinality `single` response bound to a `qti-choice-interaction` with a `max-choices` other than 1.                                                                                              | BIND §5.3.49    |
| `olah/validate/extension-attribute`      | An attribute beyond the schema's on an element that allows them, not named `data-` and name characters (V52).                                                                                       | BIND §5.2       |

## Declarations and references

| Code                                        | Reported when                                                                                                                                                     | Source                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `olah/validate/duplicate-identifier`        | A variable, test part, section or item reference identifier is declared twice (L2); two variable mappings of an item reference share a target.                    | INFO §5.34.1, §4.2.1, §5.159.1, §7.48  |
| `olah/validate/reserved-identifier`         | A declaration of a built-in variable: `numAttempts`, `duration`, `completionStatus`, `QTI_CONTEXT` (T24).                                                         | INFO §2.2.2.1–2.2.2.3                  |
| `olah/validate/base-type`                   | A variable with a cardinality other than record and no base type.                                                                                                 | INFO §5.34.3                           |
| `olah/validate/declared-value`              | A default, correct response, map key or lookup table value that is not a value of the base type of its variable.                                                  | The lexical form of the base type      |
| `olah/validate/standard-outcome`            | `SCORE` or `MAXSCORE` that is not a float, or `PASSED` that is not a boolean (T23, G40). Warning.                                                                 | INFO §2.2.2.3, BPIG §3.5               |
| `olah/validate/undeclared-variable`         | An expression, rule, printed variable, feedback or template content, or PCI variable names a variable the item or test does not declare (L1).                     | INFO §2.2.2, §2.7.2, §5.152.1, §7.48.1 |
| `olah/validate/variable-out-of-reach`       | Template processing reads a response or outcome variable.                                                                                                         | INFO §6.50                             |
| `olah/validate/reference-kind`              | An attribute names a variable of a kind it may not name, such as a response variable for `outcome-identifier`.                                                    | INFO §7.30.6                           |
| `olah/validate/reference-type`              | An attribute names a variable of the wrong base type or cardinality, such as the `outcome-identifier` of feedback, which must be a single or multiple identifier. | INFO §2.7.2, §5.93.1                   |
| `olah/validate/duration-not-time-dependent` | `duration` is read in an item that is not `time-dependent` (L8).                                                                                                  | INFO §2.2.2.2                          |
| `olah/validate/unbound-response`            | A response declaration that no interaction binds (L5). Warning.                                                                                                   | INFO §2.2.2.2                          |
| `olah/validate/identifier-syntax`           | An attribute of the type `identifier` that does not start with a letter or `_` and contain only letters, digits, `_`, `-` and `.`.                                | INFO §4.1.1                            |
| `olah/validate/identifier-style`            | An identifier that has a period or more than 32 characters. Warning.                                                                                              | INFO §4.1.1                            |
| `olah/validate/duplicate-id`                | An `id` that two elements of a document share.                                                                                                                    | INFO §5.16                             |
| `olah/validate/unresolved-reference`        | An `idref` that no element of the document has (S6, S10, S11); a reference or a document that cannot be resolved or read.                                         | INFO §5.16, BIND §8                    |
| `olah/validate/unresolved-include`          | An `xi:include` left in the document: resolve includes before validating.                                                                                         | INFO §2.12                             |
| `olah/validate/rubric-interaction`          | An interaction inside a `qti-rubric-block`.                                                                                                                       | INFO §2.8.6                            |
| `olah/validate/unreachable-content`         | Feedback or template content that shows or hides for an identifier its controlling variable can never take (L6). Warning.                                         | INFO §5.93.2                           |

## Static types of processing

A bottom-up inference gives every expression a cardinality and base type from `OPERATOR_SIGNATURES` and the
declarations. A type that is not known statically (a custom operator, a record field, a variable without a base type)
is unknown, and an unknown type passes every check, so a finding is a defect and never a guess.

| Code                                       | Reported when                                                                                                                                                 | Source                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `olah/validate/operand-count`              | An operator has more or fewer operands than its signature allows (L3).                                                                                        | The section of the operator  |
| `olah/validate/operand-type`               | An operand has a base type or cardinality the operator does not take, or operands that must share a base type do not.                                         | The section of the operator  |
| `olah/validate/match-float`                | `qti-match` of floats (G18). Warning.                                                                                                                         | INFO §2.11.3.28              |
| `olah/validate/random-bounds`              | `qti-random-integer` or `qti-random-float` with `min` above `max`: the result is always NULL (G32, G33).                                                      | INFO §7.33, §7.34            |
| `olah/validate/weight-with-integer`        | `qti-test-variables` with a `weight-identifier` and `base-type` integer (G35).                                                                                | INFO §7.39.5                 |
| `olah/validate/weight-undefined`           | A weight that no `qti-weight` of the item reference defines, or one named in an item (L9). Warning: the weight is 1.                                          | INFO §7.47.2                 |
| `olah/validate/missing-mapping`            | `qti-map-response` of a variable without `qti-mapping`, or `qti-map-response-point` of one without `qti-area-mapping` or of a base type other than point.     | INFO §2.11.1.5, §2.11.1.6    |
| `olah/validate/pattern`                    | A `qti-pattern-match` pattern or a `pattern-mask` that `compileXsdRegex` rejects.                                                                             | INFO §5.104.1, §5.162.5      |
| `olah/validate/outcome-only-expression`    | An expression that reads the item sessions of a test, such as `qti-number-correct`, outside outcome processing (B87).                                         | INFO §2.11.2                 |
| `olah/validate/custom-operator`            | A `qti-custom-operator` that none of `customOperators` serves; only when the option is given.                                                                 | INFO §2.11.3.2               |
| `olah/validate/unknown-expression`         | A model with an expression kind that QTI 3.0 does not define.                                                                                                 | INFO §2.11                   |
| `olah/validate/assignment-target`          | A rule sets a variable of a kind the rule may not set.                                                                                                        | The section of the rule      |
| `olah/validate/assignment-type`            | A value that does not fit the variable it is set to, or the template default an item reference gives; an integer fits a float or duration variable (D5) (L4). | INFO §5.130.2, §5.152.2      |
| `olah/validate/condition-type`             | The expression of a condition, pre-condition, branch rule or template constraint is not a single boolean.                                                     | INFO §5.86, §5.23, §5.150, … |
| `olah/validate/completion-status`          | `completionStatus` set to a constant other than `not_attempted`, `unknown`, `incomplete` or `completed`.                                                      | INFO §2.2.2.3                |
| `olah/validate/lookup-table`               | A lookup rule for an outcome that is not a single outcome with a lookup table (L4).                                                                           | INFO §5.87                   |
| `olah/validate/lookup-source`              | The source of a lookup rule has a type the table of the outcome does not take (a match table needs integers).                                                 | INFO §5.87.2                 |
| `olah/validate/template-constraint`        | A `qti-template-constraint` inside a condition.                                                                                                               | INFO §5.150                  |
| `olah/validate/constraint-without-default` | A template variable that a constraint reads has no default (L10). Warning.                                                                                    | INFO §5.150                  |
| `olah/validate/external-score-assigned`    | Outcome processing sets an externally scored outcome, replacing the score supplied to it (G24). Warning.                                                      | INFO §2.9                    |
| `olah/validate/unknown-template`           | A response processing template that is not standard and that `resolveTemplate` does not resolve, in an item without rules (L11, G17).                         | INFO §4.6.1                  |
| `olah/validate/legacy-template`            | A QTI 2.x template address (G43). Warning: the standard template of the same algorithm applies.                                                               | BPIG §2.5.1                  |

## Test structure and covers

| Code                                  | Reported when                                                                                                                                                                                                         | Source                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `olah/validate/identifier-mismatch`   | A section reference whose identifier differs from its section's (error); an item reference whose identifier differs from its item's (warning).                                                                        | INFO §7.5, §4.1.1                   |
| `olah/validate/selection`             | A selection without replacement of more children than the section has, or fewer than it requires (B21).                                                                                                               | INFO §5.129.1, §4.2.2               |
| `olah/validate/adaptive-section`      | An adaptive section with a sub-section, or one that is not directly in a test part (B66).                                                                                                                             | CAT §2.3                            |
| `olah/validate/adaptive-simultaneous` | An adaptive item in a test part that submits simultaneously (B27).                                                                                                                                                    | INFO §5.159.5                       |
| `olah/validate/branch-target`         | A branch rule whose target is unknown, behind its source, or of a level the rule may not name (L7).                                                                                                                   | INFO §2.8.3.2, §5.23                |
| `olah/validate/branch-to-repeated`    | A branch rule that targets an item that selection with replacement can repeat (B97).                                                                                                                                  | INFO §5.98                          |
| `olah/validate/ignored-rule`          | A branch rule or pre-condition that is ignored: in a nonlinear part, on an item of an adaptive section, or targeting one. Warning.                                                                                    | INFO §2.8.3, CAT §2.1               |
| `olah/validate/unreachable`           | A test part or item that no path reaches because a branch rule that is always true jumps over it (L7). Warning.                                                                                                       | INFO §2.8.3.2                       |
| `olah/covers/undeclared-outcome`      | A covers block for an outcome the test does not declare (O6).                                                                                                                                                         | olah convention §4.16               |
| `olah/covers/not-external`            | A covers block for an outcome that is not `external-scored` (O7).                                                                                                                                                     | INFO §4.5.10                        |
| `olah/covers/unknown-item-ref`        | A cover that names an item reference the test does not have (O8).                                                                                                                                                     | olah convention §4.16               |
| `olah/covers/unknown-response`        | A cover that names a response the item does not declare (O9).                                                                                                                                                         | olah convention §4.16               |
| `olah/covers/duplicate`               | The same cover twice in a block, or two blocks for one outcome (O10).                                                                                                                                                 | olah convention §4.16               |
| `olah/covers/malformed`               | A block whose `view` lacks `scorer` or has `candidate`, or without `data-outcome-identifier`; an entry without both attributes (O11). A block below the test with the class token is a warning: it is not recognized. | INFO §4.4.11, olah convention §4.16 |

Branch rules and pre-conditions are evaluated with the structure the test builds when its section references are
resolved (`validateTest`), so their targets can be checked across documents. `validateAsi` of a test checks the
document alone.

## Packages, results and profiles

| Code                                                               | Reported when                                                                                                                                               | Source                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `olah/validate/missing-file`                                       | A listed file, or a file that an adaptive section or a portable custom interaction names with a package-relative address (B92, J9), that the package lacks. | BIND §8.1, CAT §2.6, BPIG §3.7.12.2 |
| `olah/validate/unlisted-file`                                      | A file of the package, or one that a document names, that the manifest does not list (K7).                                                                  | BIND §8.1, CAT §2.6                 |
| `olah/validate/outside-package`                                    | A listed `href` that leaves the package.                                                                                                                    | BIND §8.1                           |
| `olah/validate/resource-type`                                      | A resource whose file holds another kind of document than its type says.                                                                                    | BIND §8.1                           |
| `olah/validate/metadata-identifier`                                | An item whose identifier differs from the one in the LOM metadata of its resource (K6).                                                                     | INFO §4.1.1                         |
| `olah/validate/pnp-in-package`, `olah/validate/results-in-package` | A personal needs profile, or a results report, in a package (K29).                                                                                          | BIND §7                             |
| `olah/validate/module-resolution`                                  | A module of a portable custom interaction that no present package-relative location serves (J9).                                                            | BPIG §3.7.12.2                      |
| `olah/validate/sequence-index`                                     | An item result of a test result without `sequenceIndex`, or two item instances with one.                                                                    | RR §2.4.5                           |
| `olah/validate/normal-maximum`                                     | An outcome with a `normal-maximum` of 0 or below.                                                                                                           | RR §2.4.7                           |
| `olah/validate/support-value`                                      | A prohibited support that reports a value.                                                                                                                  | RR §2.6.4                           |
| `olah/validate/pnp-prohibited`                                     | A prohibited support that is also in an activate set (error), or also assigned (warning).                                                                   | BPIG §5.3.3                         |
| `olah/validate/pnp-sets`                                           | A support in both activate sets. Warning.                                                                                                                   | BPIG §5.3                           |
| `olah/validate/pnp-namespace`                                      | An element of a PNP document in one of the two alternate namespaces (L15, D6).                                                                              | BPIG §5, BIND §7                    |

`validatePackage` reads each resource through `package.document`, so the includes of a document are resolved, an item
is checked with the response processing templates the package holds, and a test is checked as `validateTest` checks it
with `packageResolvers`. Each document is checked once, however many tests name it.

## Decisions

Where the specifications are silent or ambiguous, the validator reads them like this:

| Gap      | Decision                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L3       | A type that cannot be known statically passes: custom operators, record fields and variables without a base type are never reported.                     |
| G40, T23 | A standard outcome of another base type is a warning, as content varies and still runs.                                                                  |
| G24      | A rule that sets an externally scored outcome is a warning: it replaces the supplied score on every run.                                                 |
| G43, G17 | A QTI 2.x template address is a warning; a template that is neither standard nor resolved is an error only for an item with no rules.                    |
| L9       | A weight with no definition is a warning, because the weight 1 applies.                                                                                  |
| L6       | Content is reported as never shown or hidden only when every assignment to its controlling variable is a constant.                                       |
| B21, B66 | The checks of selection, adaptive sections and simultaneous submission are the errors those parts of the specifications name.                            |
| V52      | `qti-custom-interaction` is constrained to `data-` attributes although its schema allows any: BIND §5.2 lists it.                                        |
| V44      | An interaction inside the XML that the model keeps (portable custom interactions) counts as nested.                                                      |
| V51      | The first rule of `RULE_SET_SPECIFIC_CLASS_RESPONSEDEC` is about a `max-choices` of `qti-inline-choice-interaction`, which has none, so it cannot apply. |
| J9       | A module is served when one package-relative location of it is in the package; each location that is present is listed.                                  |
| K6       | The identifiers of the LOM metadata and the item are compared after the white space around them is removed.                                              |
| item ref | An item reference whose identifier differs from its item's is a warning, since INFO §4.2.1 says it should be the same.                                   |
| Results  | Item results of one instance, such as attempts, share a `sequenceIndex`; two different items must not.                                                   |
