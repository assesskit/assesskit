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
and outcome processing, with their declarations, test structure, rules and all 64 expressions, and the content of items,
stimuli and feedback (text, the 76 HTML elements, the 22 interactions with their choices and prompts, portable custom
interactions, feedback, templates, rubric blocks, catalogs and companion materials, with MathML, SSML and `xi:include` kept
as XML), read by `readAsi` and written by `writeAsi`. The model, the reader, the writer and the generators of the tests
all read one element table that `pnpm asi-table` generates from the official ASI schema. `readScoreCovers` and `scoreCoversBlock` read and build the
rubric block that names the responses an externally scored outcome of a test covers.

Readers and writers for the companion specifications: Results Reporting (`results`), usage data and item statistics
(`usage`) and the QTI profile of Personal Needs and Preferences 3.0 (`pnp`), with `resolveSupports` for what a profile
asks for. Everything written validates against the official schemas. `xml` has `ElementReader`, which maps a document to a model
and reports what the model leaves unread, and `buildElement`; `values` has the lexical forms of `xs:date`, `xs:dateTime`
and ISO 8601 durations.

QTI content packages (`package`): the manifest, ZIP archives read with the checks against zip-slip, links, encryption and zip
bombs, ZIP64 reading, the documents of a package with their includes resolved, the resolvers of the delivery engine with the
variants of an item and their accessibility description, the dependency closure and LTI link documents; the metadata of their
resources (`metadata`): QTI metadata, LOM, curriculum standards and the accessibility description. `ElementReader` also reads
`xml:base`, takes the options of `parseXml`, and finishes an element that holds text only. For Node.js: packages from
ZIP files and from directories, with symbolic links rejected, and packages to ZIP files.

Computer adaptive testing (`cat`): `CatPort`, the six requests of a CAT 1.0 engine that the host implements, with the models
of their bodies and answers, `sectionData` for the section data of an adaptive section, `isSessionEnd` for item stages,
`checkPool` for the agreement of the item references with the engine's pool, and `catMetadata` for the metadata JSON of CAT
Appendix B. `metadata` has `checkQtiMetadata`.

Template, response and outcome processing (`processing`): `createItemVariables`, a tree interpreter for all 64
expressions and every rule with the semantics of the Information Model, the constraint loop of template processing, lookup
tables, the six standard response processing templates as models with their URIs normalized, custom operators that the
caller registers, the test scope through which outcome processing reads item sessions, and `OPERATOR_SIGNATURES` for static
checks.

Test session planning (`delivery`): `resolveStructure` for the section references of a test, `planTest` for the selection
and ordering of sections and items from a seeded generator and the numbering of item instances, `nextItem` and
`previousItem` for the order of presentation under pre-conditions and branch rules, `sessionControl` for the inheritance of
item session control, and `timeLimits` with `additionalTestingTime` for time limits with a candidate's extra time.
`package` has `resolveReference`.

Hardening of the readers and the interpreter against hostile input: `parseXml` refuses a lone surrogate, a namespace
declaration with white space at its start or end, and a qualified name whose parts are not names without a colon, so that
every tree it returns can be written; a package reads and parses a file that many `xi:include` elements name once;
`dependencyClosure` follows chains of any length; `qti-repeat` of NULL is NULL however many repeats it names; and the
compiler of patterns builds a repeat of an empty group at once. Each limit has its default in its TSDoc and in SECURITY.md.

The interactions (`interactions`): the descriptors of the 22 interactions with their bindings, `checkBindings`,
`checkResponse` with the rules of validity of INFO §5 and the answered status of Results Reporting, the initial order of
the choices with the fixed draw procedure, and the numeric record of a text entry. Portable custom interactions (`pci`):
the JSON binding of BPIG Appendix C with callbacks for file values, module resolution, properties and checks. What an item
shows (`content`): visibility of feedback, template content and choices, printed variables with the C `printf`
conversions, the substitution of template values in parameters and MathML, rubric views and their order, catalogs and
cards, and the mapping of the hazards of a resource to the terms of a PNP. `asi` has `childNodes` and `descendantNodes`
for walking content.
