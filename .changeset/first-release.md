---
"@luthfanwakan/olah": major
---

The error classes, the `Issue` type, and a seeded random number generator whose state can be saved and restored, with
the same sequence as takar's. The `values` module: base types, cardinalities, values and NULL, lexical forms, matching and
promotion, the JSON codec of BPIG Appendix C with olah's wire value, and regular expressions of XML Schema that run in
linear time.

A secure XML reader and writer (`xml`): an immutable tree with namespaces, the encoding rules of XML 1.0, limits on size,
depth, attributes and nodes, rejection of every DOCTYPE, and XInclude resolution through a resolver the caller passes. For
Node.js (`node`): the pinned list of the official XSD schemas, `loadSchemaSet`, which compiles each schema once, and
`validateXmlFiles`.

The typed model of the assessment documents (`asi`): items, stimuli, tests, sections, outcome declarations and response
and outcome processing, with their declarations, test structure, rules and all 64 expressions, read by `readAsi` and
written by `writeAsi`. The model, the reader, the writer and the generators of the tests all read one element table
that `pnpm asi-table` generates from the official ASI schema. `readScoreCovers` and `scoreCoversBlock` read and build the
rubric block that names the responses an externally scored outcome of a test covers.

Readers and writers for the companion specifications: Results Reporting (`results`), usage data and item statistics
(`usage`) and the QTI profile of Personal Needs and Preferences 3.0 (`pnp`), with `resolveSupports` for what a profile
asks for. Everything written validates against the official schemas. `xml` has `ElementReader`, which maps a document to a model
and reports what the model leaves unread, and `buildElement`; `values` has the lexical forms of `xs:date`, `xs:dateTime`
and ISO 8601 durations.
