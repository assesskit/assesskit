---
"@assesskit/runtime": major
---

A QTI 3.0 runtime for JavaScript and TypeScript. It reads, writes and validates assessment items, tests, content packages
(with `resolveLaunchUrl` for the launch URL of an LTI link), results, usage data and personal needs and preferences, against
the official schemas and with semantic checks; runs template, response and outcome processing; and delivers a test session
without presenting it, on a server where the answer keys never reach a candidate, or on a device for practice. A host
answers the requests of a CAT engine through a `CatPort`, one with `sendCatRequest` or all with `drainCat`. A rubric block
for scorers can hold a structured scoring rubric, with criteria, levels and weights aligned with CASE; `validate` checks it,
and the runtime scores a rater's ratings under it. Items are compared with Longsight qti3-core and Amp-up
qti3-item-player, test sessions are tested against the specifications, and the 1EdTech examples are read, validated and
run. It is not certified by 1EdTech. The `assesskit` command validates a package or a document, and `assesskit schemas
fetch` downloads the official schemas, with a stall timeout of 30 seconds and three tries for a network error or the status
408, 429 or 5xx.

Each name is exported by the subpath of its module and by no other entry. The root `@assesskit/runtime` holds what no
module owns, the seeded random number generator (`createRandom`, `restoreRandom`, `Random`, `RandomState` and
`SeededRandom`). `@assesskit/runtime/delivery/wire` holds the wire forms of the candidate side (`readView`, `writeView`,
`readCandidateAction`, `writeCandidateAction`, `DEFAULT_ACTION_LIMITS`, `CANDIDATE_ACTION_TYPES`, `REFUSAL_REASONS` and the
types of the candidate view) and reaches no file of the engine, so that a client in a browser keeps the engine out of its
first load in a bundler that splits code by file. A host reaches the item session, the plan of a test and its times through
`createEngine`, and an item delivered alone is `createEngine({ kind: "item" })`.

Every function is named by what it does, with one verb for one meaning: `read` and `write` for a form that a standard
defines, `parse` and `format` for the lexical form of one datatype, `validate` for findings returned as data, `check` for a
throw, `build` for plain data, `create` for an object with behavior, `derive`, `resolve`, `select`, `list` and `find`.
Optional parameters come in one options object with documented defaults, and every options object is read by a strict
reader that refuses an option the function does not take, whatever its type, a misspelled limit included; the message
names the path of the option (`The options object is invalid at limits.maxBytes: expected a value of at least 1, found 0.`).

The errors are `AssesskitError` and its subclasses `DataError`, `ReadError`, `ProcessingError`, `SecurityError` and
`ServiceError`, from `@assesskit/runtime/errors`. `SecurityError` carries the name of the limit or rule it reports as
`limit` and its value as `maximum`; `ServiceError` is the error that a `CatPort` throws to refuse a request, with its status
(400, 404, 429 or 503) and body, so that a CAT engine depends on the runtime alone. Every error class takes `ErrorOptions`
last, and an error that reports another holds it as `cause`. A refusal of the engine is `{ reason, message }`, with
`RefusalReason` from `REFUSAL_REASONS`, on the JSON of a view as in the engine; an issue names the rule it breaks as `rule`,
in the JSON report of `assesskit validate` too. `CallOptions`, `{ signal? }`, of `@assesskit/runtime/checks` is the options
of every call that waits, and `raceAbort` takes it.

A stored session state is read by every later 1.x release, and `STATE_VERSION` is exported from `@assesskit/runtime/delivery`.
The option `contentVersion` of `createEngine` names the version of the content: a state keeps it, and the engine refuses a
state that another version started. `response-processed` events carry the `attempt` number and the `duration` of the item
so far in milliseconds, and with the option `eventOutcomes` of `createEngine` its outcomes, so that a host needs no
`results()` call after each step. The option `reviewAfterEnd` of `createEngine` lets a candidate review the items presented
after the test ended, as each item session control allows; it is off by default, and an engine with it names the content
version of the states it reads. `Engine.hasMaximumTime` says, before any session, whether the test, a test part, a section
or an item reference has a maximum time, so that a host knows whether it must schedule time-outs. `Engine.apply` and
`stamp` read an action through the schema that `readCandidateAction` reads, and `writeCandidateAction` refuses a property
that the action's type does not have. An item instance in JSON has `ref` and `instance` and no other property, in an action
as in a state.

The action `mark` marks an item instance that was presented for review, or takes the mark away; the mark is a field of the
state, `marked` in the navigation map, and never in the results. The action `support-settings` changes the settings of a
support that is on, whatever its state: the preferences that CERT asks the candidate to change during the session
(`ADJUSTABLE_SETTINGS`: braille, magnification, reading aloud, text appearance). The action carries the settings whole, the
state keeps them, and the engine refuses one that changes a setting of the program with `setting-not-adjustable`. The view
lists the action while such a support is on, and carries the stylesheets of the test as package paths
(`TestView.stylesheets`) in every status of the session.

`readItemVariables` and `readTestInputs` of `@assesskit/runtime/delivery` read a stored results report back into the inputs
of `runResponseProcessing` and `runOutcomeProcessing`, so that a host can score a fixed item again; the guide has the recipe.
For that, a report lists every instance of the plan, in plan order: those not presented have the status `initial` and the
sequence indexes after the others, and the report of a session writes the correct response of a variable whose key
template processing set. `CatSessionPort` is the three requests that a session makes (Create Session, Submit Results, End
Session), the type that `drainCat` and `sendCatRequest` take, so that a port without the deployment of sections serves; the
six methods of `CatPort` take `options?: CallOptions` last, and `sendCatRequest(port, request, { signal })` and `drainCat`
pass the signal of their caller to the port and end their wait when it aborts. A custom operator that throws is a
`ProcessingError` that names it and keeps what it threw as `cause`, so that `Engine.apply` reports `processing-failed` and
never throws on a state of the engine.

The default limits keep the worst input of every reader within a budget of 256 MiB of heap, measured and pinned by a test:
an XML document has at most 10 MiB (`maxBytes`) and 300,000 nodes (`maxNodes`), and a file of a package at most 64 MiB
(`maxEntryBytes`); SECURITY.md has the peak of each reader and what raising a limit costs. `readPackageFile` reads a ZIP
file by ranges, its end and central directory when it opens and the bytes of an entry when it is read, so that the memory
follows the directory and the largest entry opened and not the size of the file (up to `maxTotalBytes`, 2 GiB); a central
directory of more than 512 bytes for each entry that `maxEntries` allows is a `SecurityError` of the limit
`maxDirectoryBytes`, before it is read. The ZIP reader ends the central directory by its size and not by the 16-bit count of
the end record, so that an archive of more than 65,535 entries is read whole and counted against `maxEntries`, and an end
record whose count differs from the entries is a `ReadError`. `readResultsJson(json, { limits })` refuses the JSON of a
result above `maxResultSize`, 8,388,608 by default, and `readCandidateAction(json, { limits })` an action above
`maxActionSize`, with a `SecurityError`; `maxSettingListLength`, 256 by default, bounds each list in the settings of a
`support-settings` action. Both refuse a property named `__proto__`, `prototype` or `constructor` at any depth through
`checkJsonInput` of `@assesskit/runtime/checks`, and every reader of an object of untrusted JSON refuses those names on the
object it reads. `deserializeState` and `readView` read what the engine wrote, from the host's own store and server, and
have no limit of size. `readModuleResolution` refuses a file longer than 65,536 characters with the `SecurityError` of the
limit `maxModuleResolutionLength` before it parses it. A document that declares ISO-8859-1 is read byte for byte.
`checkArray` refuses an array with a hole, which `forEach`, `map` and `every` skip unseen, and names the index of the hole.

A validation lists at most `maxFindings` issues, 1,000 by default, and ends a longer list with the error
`assesskit/validate/findings-stopped`; `validateResults`, `validatePnpNamespace` and `validateXmlFiles` take the option too.
`validate` accepts a text entry bound to a record, a `ruby` with an `rp` before and after its `rt`, and a portable custom
interaction whose module resolution files and modules lie at the root of the package, from an item in any folder. It warns
about the pre-conditions and branch rules of a test part in nonlinear mode, which the engine ignores as it ignores those of
the sections and items in it. `defaultSchemaDirectory()` of `@assesskit/runtime/node` returns the directory that
`assesskit schemas fetch` writes the schemas to, so that a program loads what the command fetched with
`loadSchemaSet(defaultSchemaDirectory())`.

`readPnp` reads the color theme of the best practices guide into `TextAppearance.colorTheme`, with the terms of
`PNP_COLOR_THEMES` and `isColorTheme`. The PNP schema has no such element, so `writePnp` leaves it out and `validatePnp`
warns. `selectCard` takes the candidate's `braille` settings and chooses among the entries of a card by their
`data-braille-type`, `data-braille-grade` (or `data-grade`) and `data-math-type`, as the best practices guide marks braille
and tactile files, falling back to the language and the default where no entry fits.

The builders of the covers block and of the scoring rubric block are `buildScoreCoversBlock` and `buildScoringRubricBlock`,
and `RUBRIC_KINDS` of `asi` lists the kinds of a rubric block. `isInsideShape(shape, coords, point)` of
`@assesskit/runtime/processing` is the hit test of the shapes of QTI that `qti-inside` and `qti-map-response-point` make, the
edge included, for a scorer of the points of a response. `resolveResourcePath(manifest, resource)` without the option `href`
resolves the main file of a resource: its `href`, or else its only file. `writePackage` writes through `zipSync` of
`fflate`: a file at the root whose name is a whole number, such as `12`, comes before the manifest, and a file named
`__proto__` at the root is refused with a `DataError`. `encodeBase64`, `decodeBase64` and `decodeBase64Url` run on
`@scure/base` and refuse every spelling but the canonical one: a text with bits after the last byte, white space, a lone
digit or excess padding gives `undefined`. `writeWireValue(value, { declaration })` needs the declaration only for a NULL.

`@assesskit/runtime/item-formats`: `readGift` and `readMoodleXml` read a GIFT or a Moodle XML file, the formats of Moodle's
question bank, into QTI items as Moodle's own importers read them, and `writeGift` and `writeMoodleXml` write QTI items as
files that Moodle imports. Multiple choice of one and of several answers, true or false, short answers, numerical
questions, matching questions, essays and descriptions convert, with their credits, Moodle's grades, per-answer, general and
combined feedback, categories, identifiers and tags; a short answer or an inline choice at GIFT's missing word stands at its
place in the text. A reader writes each grading in QTI's own expressions; a writer learns an item's credits and feedback by
running its response processing. Everything that does not convert is in the result's `losses`, each with its reason
(`item`, `scoring`, `feedback`, `content`, `setting`). The HTML of a question is parsed with parse5 and kept as QTI content;
`DEFAULT_ITEM_FORMAT_LIMITS` bounds a file, and the writers take `{ maxAnswers }` as their limits. Moodle XML also carries
the mark, shuffling, case, the feedback by how right a response is, an essay's options and information for graders, and the
files that a text embeds, which `readMoodleXml` returns in `files` and `writeMoodleXml` takes in its option `files`.

`@assesskit/runtime/operators`: custom operators that score what QTI's own expressions cannot, for the `customOperators` of
processing, an engine and validation. `createScoringOperators` gives five, by `urn:uuid:` definitions that name no brand:
`expression-equivalent` (a mathematical expression, an equation or a solution set, typed as LaTeX, against its key, by a
seeded comparator in complex arithmetic whose verdicts equal SymPy's), `number-equivalent` (units, fractions, significant
figures, credit tiers, intervals and components, in exact rationals), `text-equivalent` (normalization, patterns, the
`words` scheme, credit tiers by edit distance, length rules and `numericEquivalence`, under which `.5`, `0.50`, `5e-1` and
`1/2` are one value; `foldWidth` normalizes a text to its form again after it folds the widths, so that halfwidth `ｶﾞ` matches
`ガ` in every form), `hotspot-matching` (a maximum matching of points to keyed areas) and `readable`. `buildOperatorCall`
writes the `qti-custom-operator` of a key, its options as RFC 8785 canonical JSON with every default resolved, and reads a
call and its follow-through with strict schemas; the schemas of a key hold each field's default, and both a call and an item
read a key through them. `compareMathSteps` checks worked steps line by line, and `countLength` counts words, grapheme
clusters and the squares of a manuscript sheet; `pnpm unicode` writes the grapheme break table of Unicode 17.0.0.

`@assesskit/runtime/scoring`: `compileScoring` compiles the keys of an item's responses into its response declarations, with
their correct responses and mappings, the outcomes `SCORE`, `MAXSCORE`, `SCORE_<identifier>` and `FEEDBACK`, and the
response processing that sets them. It writes QTI's own expressions where they score a key exactly (`qti-match`,
`qti-map-response`, `qti-map-response-point`, `qti-index`, `qti-contains`, `qti-equal`) and the operators of
`@assesskit/runtime/operators` where they cannot, scales each response to `maxPoints` and `weight`, and takes `allParts`, a
`floor` and `portable`, the form in which a host scores what an operator would. `@assesskit/runtime/keys` holds the key
model: `Key` of nine kinds (`choice`, `choice-mapping`, `choice-marking`, `pairs`, `order`, `areas`, `text`, `number`,
`expression`), `ScoredResponse`, `FollowThrough` and the parts of a key, with `DEFAULT_KEY_LIMITS`, which bounds the keys
that `compileScoring` reads (256 responses, the count at which the worst item ends within the budget of memory).
`interactions` gives the attributes that each interaction needs.
