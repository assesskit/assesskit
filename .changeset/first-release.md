---
"@luthfanwakan/olah": major
---

The error classes, the `Issue` type, and a seeded random number generator whose state can be saved and restored, with
the same sequence as takar's. The `values` module: base types, cardinalities, values and NULL, lexical forms, matching and
promotion, the JSON codec of BPIG Appendix C with olah's wire value, base64 and base64url that decode only the canonical
encoding (RFC 4648), and regular expressions of XML Schema that run in linear time.

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
`checkPool` for the agreement of the item references with the engine's pool, `catMetadata` for the metadata JSON of CAT
Appendix B, and `assessmentResultToJson`, `assessmentResultFromJson` and `itemStageFromJson` for the JSON of the public CAT
binding. `metadata` has `checkQtiMetadata`.

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

Validation (`validate`): `validateAsi`, `validateTest`, `validatePackage`, `validateResults`, `validatePnp` and
`validatePnpNamespace` return `Issue`s for what a schema cannot state. They check the rule sets of BIND §5, the
constraints of the Information Model, the static types of every expression and rule against `OPERATOR_SIGNATURES`, the
variables (with a warning for `ITEM.VAR` of an item that selection with replacement can repeat, whose value the
specification leaves undefined), the structure of a test (selection, adaptive sections, branch rules and what no path
reaches), the covers of externally scored outcomes, the files and resources of a package, Results Reporting and personal
needs profiles. `validateTest` is the static gate of a delivery engine. `asi` has `walkDocument` and `scoreCoverBlocks`,
and `processing` has the types and built-ins that the checks read.

The command line (`cli`), installed as the program `olah` and exported as `runCli`: `olah validate <path>` checks a package, a
package directory or an XML document against the official schemas, which it compiles once, and with the semantic checks of
`validate`, and prints text or JSON with the exit codes 0 for valid, 1 for errors and 2 for a command line, input or schema
set that it cannot use; `olah schemas fetch` downloads the pinned schemas into the user cache directory and checks their
SHA-256, and is the only network access in olah.

Item sessions (`delivery`): `startItemSession`, `presentItem`, `suspendItem`, `closeItem` and `applyItemAction` run the
session of one item instance as plain data, with refusals as values and the time of every step given: attempts and the
budget of `max-attempts` with `count-attempt`, adaptive items that close at completion, end attempt interactions, drafts
kept apart from submitted responses, skipping and validity, review, solution and comments, the states of portable custom
interactions, the item duration, and template and response processing failures reported as events. `itemFeedback`,
`itemResponses` and `resultStatus` give the feedback, the responses and the Results Reporting status of a session, and
`standaloneSessionControl` the control of an item delivered alone.

The delivery engine (`delivery`): `createEngine` runs the static checks over everything a session of a test, or of an item
delivered alone, can reach, refuses a resolver that returns a promise, and gives an engine whose `start` and `apply` are a
pure reducer of candidate sessions as plain data: actions with their times, refusals as values, navigation in linear and
nonlinear parts, individual and simultaneous submission, outcome processing after each submission, pre-conditions and
branch rules, template defaults, context values, time limits with `deadlines`, time-outs and late submission, suspension,
supports, variants chosen by hazards and language, events, and processing failures reported as events. `stamp` stamps
actions monotonically, and `serializeState` and `deserializeState` write and read states in a versioned JSON format.
`startItemSession` takes the template defaults of a test.

The candidate side of the engine: `Engine.view` gives the view of a state at a time, with the maximum times that passed
applied, built so that no answer key, processing or hidden content reaches it: the navigation map, the item after
resolution with its choices in the order of presentation, interaction descriptors, drafts, feedback, rubric, timers,
allowed actions, supports with their settings, hazards, the variant, the link to a tool and the states of portable custom
interactions. `viewToJson` and `viewFromJson`, and `actionToJson` and `parseCandidateAction`, carry values as `WireValue`;
`parseCandidateAction` refuses the actions of the host and actions above the limits `DEFAULT_ACTION_LIMITS` sets, and
`stamp` checks the action it stamps.

Pending work and results (`delivery`): `Engine.pending` lists what a session waits on the host for. A scoring request is made
for each externally scored outcome of an item when its session is over, and of the test when the responses its covers name
are over or the test ends, with the declaration, the mode, the covers resolved to instances, presented or not, and the exact
submitted responses. `supply-scores` gives its value in any state, also after the test ended, and a second supply replaces
the first; the supplied value is the starting value of the outcome in every later run of outcome processing. `scorerView`
gives a rater the rubric, the items as the candidate saw them and the answers. A link to a tool is an item scored by its tool
through `SCORE` and `MAXSCORE`. An adaptive section asks its CAT engine for its stages: Create Session on entering, Submit
Results when the first `stageLength` items are submitted or the candidate leaves, with the minimal report and the earlier
results that changed, and End Session when the candidate leaves before the engine ends the session. `cat-response` gives the
answers, which add the stages and merge the outcomes the engine reports, and `drainCat` makes the requests through a
`CatPort`. `results` assembles the Results Reporting report of a session, with datestamps in RFC 3339 with an offset.

Documentation: a guide for every module, the architecture with the boundary to tempuh, the convention for the covers of
externally scored outcomes, the spec gaps with olah's resolution of each, and the evidence behind every construct. The README
has an example that a test runs, the supported versions of the specifications, and the scoped claim: items differentially
tested; test sessions specification-tested. SECURITY.md lists the threat model, every default limit and the deployment advice.
