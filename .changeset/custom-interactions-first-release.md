---
"@assesskit/custom-interactions": major
---

`@assesskit/custom-interactions`: portable custom interactions that any QTI 3.0 item may use, each an AMD module that the
item's package carries, so that it loads entirely from the package in the frame of `@assesskit/player`, which reaches no
network. `math-entry` (`urn:fdc:assesskit.wakan.dev:2026:math-entry`) is a MathLive 0.111.4 field whose LaTeX is the
response, single or one line a step for worked steps, with a virtual keyboard and inline shortcuts that write only what the
expression reader of `@assesskit/runtime/operators` reads, and the item's decimal mark. `stroke-writing`
(`urn:fdc:assesskit.wakan.dev:2026:stroke-writing`) is Hanzi Writer 3.7.3's quiz of a character, which checks each stroke's
shape, direction and order, with the record `{ strokes, mistakes }` as the response that response processing scores;
`writeCharacterModule` writes the module of a character's reference strokes, which the item's package carries.
`PCI_TYPE_IDENTIFIERS` gives the type identifier of each interaction by its name. `readModuleFiles(name, { signal })` of
`/node` gives the files of a module, MathLive's fonts and their license with it, keyed by their paths under `modules/`, the
folder of the guides; a tool that keeps the modules elsewhere renames the keys of the `Map`. An option that a function does
not take is refused, whatever its type.
