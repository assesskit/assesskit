---
"@assesskit/runtime": major
---

`@assesskit/runtime/operators`: custom operators that score what QTI's own expressions cannot, for the `customOperators` of
processing, an engine and validation. `createScoringOperators` gives five, by `urn:uuid:` definitions that name no brand:
`expression-equivalent` (a mathematical expression, an equation or a solution set, typed as LaTeX, against its key, by a
seeded comparator in complex arithmetic whose verdicts equal SymPy's), `number-equivalent` (units, fractions, significant
figures, credit tiers, intervals and components, in exact rationals), `text-equivalent` (normalization, patterns, the `words`
scheme, credit tiers by edit distance and length rules), `hotspot-matching` (a maximum matching of points to keyed areas) and
`readable`. `buildOperatorCall` writes the `qti-custom-operator` of a key, its options as RFC 8785 canonical JSON with every
default resolved. `compareMathSteps` checks worked steps line by line, and `countLength` counts words, grapheme clusters and the
squares of a manuscript sheet. `pnpm unicode` also writes the grapheme break table of Unicode 17.0.0.
