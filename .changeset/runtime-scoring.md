---
"@assesskit/runtime": major
---

`@assesskit/runtime/scoring`: `compileScoring` compiles the keys of an item's responses into its response declarations, with
their correct responses and mappings, the outcomes `SCORE`, `MAXSCORE`, `SCORE_<identifier>` and `FEEDBACK`, and the response
processing that sets them. It writes QTI's own expressions where they score a key exactly (`qti-match`, `qti-map-response`,
`qti-map-response-point`, `qti-index`, `qti-contains`, `qti-equal`) and the operators of `@assesskit/runtime/operators` where
they cannot, scales each response to `maxPoints` and `weight`, and takes `allParts`, a `floor`, the portable form in which a
host scores what an operator would, and the limits of keys. `interactions` gives the attributes that each interaction needs.

`@assesskit/runtime/keys` holds the key model: `Key` of nine kinds (`choice`, `choice-mapping`, `choice-marking`, `pairs`,
`order`, `areas`, `text`, `number`, `expression`), `ScoredResponse`, `FollowThrough` and the parts of a key, with
`DEFAULT_KEY_LIMITS`; `@assesskit/runtime/operators` no longer exports them. `text-equivalent` takes `numericEquivalence`: a
string and an answer's text that read as the same number match in any notation, so `.5`, `0.50`, `5e-1` and `1/2` are one
value; `spelling` takes `"exact"` alone, since the sources list each accepted spelling among an answer's texts.
