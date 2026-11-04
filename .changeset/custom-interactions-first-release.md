---
"@assesskit/custom-interactions": major
---

`@assesskit/custom-interactions`: portable custom interactions that any QTI 3.0 item may use, each an AMD module that the
item's package carries, so that it loads entirely from the package in the frame of `@assesskit/player`, which reaches no
network. `math-entry` (`urn:uuid:d8feb3d2-0816-4d3b-a66a-9e4461e2c156`) is a MathLive 0.111.1 field whose LaTeX is the
response, single or one line a step for worked steps, with a virtual keyboard and inline shortcuts that write only what the
expression reader of `@assesskit/runtime/operators` reads, and the item's decimal mark. `stroke-writing`
(`urn:uuid:36366dbf-22d7-4942-85e7-f334a950edfc`) is Hanzi Writer 3.7.3's quiz of a character, which checks each stroke's
shape, direction and order, with the record `{ strokes, mistakes }` as the response that response processing scores;
`writeCharacterModule` writes the module of a character's reference strokes, which the item's package carries.
`INTERACTION_TYPES` gives the type identifiers, and `readModuleFiles` of `/node` the files of a module, MathLive's fonts and
their license with it, by their paths in the package.
