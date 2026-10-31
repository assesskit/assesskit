# Evidence

Every construct of the QTI 3.0 specifications has a row in `conformance/runtime-inventory.json`: a table letter and a number
(`A79`), the construct, its source, the modules that implement it, the evidence that proves it and the build unit that
completes it. A construct that the runtime leaves to another system has an owner instead. [Conformance](conformance.md) renders
all rows with their tests.

## Citations

A rule cites its source by an ID and a section, such as `INFO §2.11.3.37`.

| ID   | Document                                                    | Version                                           | Address                                                                      |
| ---- | ----------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| OVW  | QTI 3.0 Overview                                            | Final Release, 1 May 2022                         | https://www.imsglobal.org/spec/qti/v3p0/oview/                               |
| INFO | QTI 3.0 ASI Information Model                               | Final Release v1.0, 1 May 2022                    | https://www.imsglobal.org/spec/qti/v3p0/info/                                |
| BIND | QTI 3.0 ASI XML Binding                                     | Final Release, May 2022                           | https://www.imsglobal.org/spec/qti/v3p0/bind/                                |
| BPIG | QTI 3.0 Best Practices and Implementation Guide             | specification 3.0.1, document 2.0, 1 October 2024 | https://www.imsglobal.org/spec/qti/v3p0/impl/                                |
| MD   | QTI 3.0 Metadata Information Model and XSD Binding          | Final Release v1.0, 1 May 2022                    | https://www.imsglobal.org/spec/qti/v3p0/md-bind/                             |
| RR   | QTI 3.0 Results Reporting Information Model and XSD Binding | Candidate Final Public v1.0, 1 November 2022      | https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html |
| UD   | QTI 3.0 Usage Data and Item Statistics                      | Candidate Final Public v1.0, 2 February 2022      | https://www.imsglobal.org/sites/default/files/spec/qti/v3/ud-bind/index.html |
| CERT | QTI 3.0 Conformance and Certification                       | Final Release, document 2.0, 15 March 2022        | https://www.imsglobal.org/node/199101                                        |
| TERM | QTI 3.0 Terms and Definitions                               | Final Release, 1 May 2022                         | https://www.imsglobal.org/node/199091                                        |
| CAT  | 1EdTech Computer Adaptive Testing (CAT) 1.0                 | Candidate Final Public, 9 November 2020           | https://www.imsglobal.org/spec/cat/v1p0/impl/                                |
| PCI  | Portable Custom Interactions 1.0, cited by INFO §1.1        | Candidate Final, March 2020                       | not retrievable                                                              |
| RPT  | The six standard response processing templates              | QTI 3.0                                           | https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/                        |
| XSD  | The schemas of the specifications                           | ASI 3.0.1 and 3.0.0                               | https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/                         |
| EX   | The examples of 1EdTech, `qtiv3-examples/`                  | public repository, no license file                | https://github.com/1EdTech/qti-examples                                      |
| LS   | Longsight `qti3-core`, the differential oracle for items    | `@longsightgroup/qti3-core` 0.13.3, MIT           | https://github.com/LongsightGroup/qti3                                       |

The overview gives addresses for RR, UD, CERT and TERM that return 404; the table gives the addresses that serve them. PCI 1.0
itself is not retrievable: the requirements of the runtime's `pci` module come from BPIG §3.7.12 and its Appendices C and D, which
restate them.

## Evidence codes

| Code | Evidence                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| R    | Round trip: models satisfy read(write(m)) = m; documents of the corpus survive read and write unchanged up to canonical form |
| X    | Written output validates against the official XSD                                                                            |
| S    | Unit test whose expected value is a statement or worked example of the cited section                                         |
| P    | Property of the semantics, checked by fast-check                                                                             |
| D    | Differential test against Longsight `qti3-core` on items and item sessions                                                   |
| C    | Corpus document read, validated and, where it has processing, executed                                                       |
| N    | Negative fixture that must produce the named issue or error                                                                  |
| V    | Exhaustive vocabulary test: every term accepted, any other term rejected                                                     |
| U    | Unit test of data access only, where the specification has no semantics                                                      |

## Tests name their rows

A test or suite names the rows it evidences in brackets in its title, as a string literal:

```ts
it("[A79] equal: relative tolerance includes both bounds by default", () => {
  // ...
});
```

A title may name several rows, such as `[A79][B12]`. Skipped and todo tests do not count. A test file is a file named
`*.test.ts` in the `test/` folder of a package or of `differential/`.

## The coverage gate

`pnpm conformance` fails when

- a row of a merged unit has no test;
- a test names an identifier that the inventory does not have;
- `docs/conformance.md` differs from what `pnpm conformance:render` writes.

The inventory lists every unit in `units` and the merged ones in `merged`. A unit adds itself to `merged` in the commit
that completes it, which makes its rows need tests from then on. A row has one unit: the last unit that works on it.
Rows of units that are not merged show as pending in the matrix and need no test yet.

## The matrix

`pnpm conformance:render` writes `docs/conformance.md` from the inventory, `conformance/cert-features.json`,
`conformance/accepted-differences.json` and the tests. The feature file lists the features of 1EdTech's QTI 3.0
Conformance and Certification, Appendix A, with these fields:

| Field          | Meaning                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name`   | As in Appendix A.                                                                                                                               |
| `group`        | `tests`, `sections`, `items`, `interactions`, `accessibility`, `metadata` or `packaging`.                                                       |
| `levels`       | The levels that require the feature: `basic`, `advanced`, `elevated-accessibility`, `pnp` (CERT §3). Empty for an elective feature.             |
| `capabilities` | Optional. The capabilities for which the runtime and the player support it: `import`, `export`, `authoring`, `delivery`, `scoring` (CERT §2.2). |
| `owner`        | Optional. The package that supports it: `runtime`, `player` or `both`.                                                                          |
| `rows`         | Optional. The inventory rows that implement it.                                                                                                 |

## Tests that read the corpus

The corpus is public material that the repository does not contain: the 1EdTech examples have no license file, and
the W3C test suite is large. `conformance/corpus.lock.json` pins each source to a commit and to the SHA-256 of every file
below.

| Source         | Repository             | Files                                                                                                     |
| -------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `qti-examples` | `1EdTech/qti-examples` | `qtiv3-examples/`: items, tests, packages, the CAT and PCI examples, results, usage data                  |
| `xsdtests`     | `w3c/xsdtests`         | `msData/regex/` and `msMeta/Regex_w3c.xml`: the regular expression tests of the W3C XML Schema test suite |

`pnpm corpus` downloads the sources into `.cache/corpus/<source>/` unless the files there already match their hashes, and
fails without writing when a download does not. `pnpm test:corpus` runs the tests in files named `*.corpus.test.ts`,
which `pnpm test` leaves out so that it runs offline; those of `differential/` run with `pnpm test:differential`. A corpus
test calls `requireCorpus` of `scripts/corpus.ts`, which fails with an instruction when the corpus is missing.

The regular expression tests (`packages/runtime/test/values.corpus.test.ts`) apply the patterns of `msData/regex/` to the
instances that `msMeta/Regex_w3c.xml` names. They follow XML Schema 1.0, which INFO cites, and Unicode 6.0.0 where the
suite's result depends on the Unicode version. Tests that the suite marks as queried and tests of other base types than
string are left out.

To move a source to another commit, run `pnpm corpus:pin <source> [commit]`: it downloads the commit (the head of the
default branch when none is given), hashes the files that the source's `include` list selects and writes the lock.

## Tests that validate against the schemas

The XSDs of QTI 3.0 are 1EdTech and W3C files with their own license, so the repository does not contain them.
`packages/runtime/src/node/schema-files.json` pins each schema to its address and SHA-256 (it is `SCHEMA_FILES` of
the `node` module). `pnpm schemas` downloads the files into `.cache/schemas` unless the files there already match their
hashes, and fails without writing a file whose hash differs. `pnpm schemas:pin` downloads every file and writes the hashes
that it finds, for the day a schema changes.

Tests that validate against the schemas are in files named `*.xsd.test.ts`, which `pnpm test` leaves out so that it runs
offline. `pnpm test:xsd` runs them: it needs `pnpm schemas`, and `pnpm corpus` when a test reads the examples. A file loads
one `SchemaSet` with `loadSchemaSet` in `beforeAll` and closes it in `afterAll`; compiling the ASI schema takes about 2
seconds, and each schema is compiled once per set. Every test of a writer passes the output to `validateXmlFiles`
([node](node.md) lists the evidence on the schemas). `cli.xsd.test.ts` runs the command line on the examples of 1EdTech and
compares its report with the issues of the libraries it composes; its tests of `assesskit schemas fetch` serve the files of
`.cache/schemas` from a server on `127.0.0.1` and download them into a temporary directory, so that no test uses the network.
`pnpm schemas` runs the code of `assesskit schemas fetch` (`packages/runtime/src/cli/fetch-schemas.ts`), which `cli.test.ts` tests
against a server of small files.

`packages/runtime/src/asi/element-table.ts` is generated from the pinned ASI schema by `scripts/asi-table.ts` (`pnpm asi-table`).
`asi.xsd.test.ts` generates the table again and fails when the committed file differs. The same file validates documents that
fast-check generates from the table, and checks that they use every element of the rows A1 to A202 and H1 to H76. Worked
items, one for each family of interactions, for feedback, catalogs, companion materials, HTML, MathML and SSML, are
written and validated too, and so is a document for every term of every vocabulary of the content (W1 to W12, W14, W17,
W19, W24, W25, W34, W35, W42), next to the terms that the pinned schema itself lists.

## Generators

`packages/runtime/test/arbitraries/` holds the fast-check generators of the models that have a reader and a writer, one file
for each module: values (`values.ts`), results, usage data, PNP profiles and records, metadata and packages, with the
elements of an unknown namespace for the extensions (`xml.ts`). A generated model is what a reader returns for the
document the writer writes, so the properties check `read(write(m))` against `m`, and the XSD tests validate a fixed
sample of the written documents. A generator with `extensions: false` leaves out the elements of an unknown namespace,
which a schema with a strict wildcard rejects. The generators of `asi` (`asi.ts`) are driven by its element table instead.

## Fuzzing

The readers of documents and archives, the compiler of patterns and the interpreter of expressions are fuzzed with fast-check
for the row B94 and the security controls of the module (SECURITY.md). The result of a run is one of these, and anything
else is a defect: an uncaught exception, a result that breaks an invariant, or a run that does not end.

| Target                                                                              | Input                                                                                         | Allowed result                                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `parseXml`                                                                          | Text and bytes of written trees, mutated; small limits                                        | A tree that `serializeXml` writes back, `ReadError`, `SecurityError`         |
| `resolveIncludes`                                                                   | Documents of hostile includes: loops, outside paths, missing targets, fallbacks, small limits | A tree without includes within the limits, `ReadError`, `SecurityError`      |
| `readAsi`, `readManifest`, `readLtiLink`, `readResults`, `readUsageData`, `readPnp` | Text and bytes of written documents, mutated; a DOCTYPE before the root                       | A model, `ReadError`, `SecurityError` (`doctype` for the DOCTYPE)            |
| `readPackage`, `file`                                                               | Archives with hostile headers; archives of the fixtures and of `writePackage`, mutated        | Files within the limits and inside the package, `ReadError`, `SecurityError` |
| `document`, `packageResolvers`                                                      | An item and a file it includes, mutated                                                       | A document, `ReadError`, `SecurityError`                                     |
| `compileXsdRegex`                                                                   | Patterns, mutated, with the delimiters of the dialect; small limits                           | A pattern that matches any text, `DataError`                                 |
| `evaluate`                                                                          | Expressions over operators, literals at the edges of each base type and small limits          | A value that `normalizeValue` keeps, `ProcessingError`, `SecurityError`      |

`mutations` of `test/arbitraries/xml.ts` deletes, inserts, overwrites, duplicates and truncates, and inserts fragments that
break the rules of XML (a DOCTYPE, entities, forbidden characters, namespace declarations, includes). The runs are
deterministic: `FUZZ` of `test/fuzz.ts` sets the seed and 300 runs. `FUZZ_SEED` and `FUZZ_RUNS` set more, with a longer
test timeout:

```bash
FUZZ_SEED=7 FUZZ_RUNS=50000 pnpm exec vitest run --project the runtime --testTimeout=600000 -t "B94"
```

A defect that fuzzing finds is fixed with a test that names the input that exposed it.

## Test sessions

No independent implementation of a QTI 3 test session was found, so the rows of test sessions carry no D: their evidence is
S, P and C. The properties in `delivery.test.ts` generate tests (linear and nonlinear parts, individual and simultaneous
submission, time limits with and without late submission) and sequences of actions stamped by `stamp`, and check after
every step:

- the state given is unchanged, and a refusal is never `clock-regression`;
- `numAttempts` never decreases, a closed item takes no responses, and an item closed at a time limit takes none either;
- the current item never goes back in a linear part;
- the time of the test is the time the session ran, without suspended time, and no maximum time is left behind the step;
- `deserializeState(serializeState(state))` equals the state;
- the accepted actions replayed from the seed, also through the JSON form, give the same states and events.

`delivery.corpus.test.ts` plays tests of the examples to their end with the correct responses and compares the scores
with the `MAXSCORE` their authors declared, delivers the links to tools of `testWithLti`, and delivers alone every
example item that the static checks accept.

## Candidate view

No answer key reaches the view; the evidence is a property and a structure check:

- `delivery.test.ts` runs random actions, time included, on a test whose item holds a correct response and a mapping of a
  text, an outcome and a template value that nothing prints, feedback, modal feedback, template content and a choice that
  the variables hide, and rubric for the scorer and the author, each with a mark. After every step the JSON text of the view
  holds no mark, except the mark of the correct response in the solution state of an item whose control shows the solution
  (E20, E21). The property fails when the view takes the rubric of another view or the correct responses.
- At every step of generated tests, the view reads back equal from its JSON text and from a state read back; an action that
  reaches the engine through `actionToJson`, the JSON text, `parseCandidateAction` and `stamp` gives the step that the same
  action gives on the device; the engine refuses every action type the view leaves out, and meets no refusal of the state
  in a type it lists, except the two actions that change nothing, `next-attempt` during an attempt and `resume` of a running
  session.
- `delivery.corpus.test.ts` shows every example item that the static checks accept, checks that no view holds a property
  that names a key or processing, and reads each view back from its JSON text along the plays of the example tests.

## Differential tests

`differential/` is a private package, not a dependency of the runtime, that compares the runtime with Longsight `qti3-core`
(`@longsightgroup/qti3-core`, pinned to one version), which processes items. A case is an item document, responses and a
seed; an `Implementation` runs it and reports the outcome and template values as `Observed` values. `longsight` is the
oracle and `runtime` the subject: the runtime's run gives the responses as the first attempt of a session (`numAttempts` 1,
`completionStatus` `unknown`, defaults for the responses a case leaves out), and draws from `longsightRandom`, the
oracle's generator, so that both draw the same template values by the draw procedures they share. `compare` runs two
implementations on a list of cases and reports

- the cases both accept, whose variables it compares;
- the cases both reject;
- the differences, including an item that only one accepts.

`corpusCases` builds cases from the item documents below a directory of the corpus, named by their paths: each item
without responses, and with the correct responses the oracle reads from it.

An `Implementation` also plays item sessions. A session case is an item, its turns and a seed; a turn gives responses
and submits them, or ends the attempt with an end attempt interaction. The runtime plays it with `startItemSession`,
`presentItem` and `applyItemAction` for an item delivered alone without a limit on attempts, as the oracle has none, and a
processing failure, which the runtime reports as data, makes the case one that the runtime does not accept. `compareSessions` compares
the turns: whether each is accepted, the outcome values, `numAttempts`, and whether the session closed. `sessionCases`
gives four turns to each corpus item with interactions that choose identifiers, with choices from the oracle's generator
and a hint in the second turn when the item has an end attempt interaction; `generated.test.ts` plays adaptive and
non-adaptive items with generated turns. `differential/test/generated.test.ts` compares
items that fast-check generates for arithmetic, rounding, tolerances, logic, containers, mapping and random draws. A
difference that the specification settles goes into `conformance/accepted-differences.json` with the item, the variable
(empty when only one implementation accepts the item), the reason and the source; it shows in the matrix as accepted and
not as a difference.

The oracle also reads interactions. `differential/test/interactions.test.ts` compares the validity of generated responses
(choices, order, associations, inline choices) and the record of numeric text, and `interactions.corpus.test.ts` the
interactions of the corpus items: response variables, shuffling and choices. They agree, apart from the integer value of a
number that ends in its point (`5.`), which INFO §2.4.2.2 gives and the oracle does not; the test states it.

`pnpm test:differential` runs all of these, and `pnpm test` leaves them out. The tests that read the corpus need
`pnpm corpus` first.

## Fixtures from oracles

Expected values come from an oracle, never from the code under test. The scripts that write them are in `validation/` of
the repository and use the standard library of Python 3.12 or later:

| Script        | Fixture                                        | Oracle                                                                                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `printf.py`   | `packages/runtime/test/fixtures/printf.json`   | Python's `%` operator, for `e E f g G d i o x X` with flags, width and precision; `content` formats every case                                                                                                                                                                             |
| `rounding.py` | `packages/runtime/test/fixtures/rounding.json` | Python's `decimal` module with `ROUND_HALF_UP`, for `qti-round-to` and `qti-equal-rounded`                                                                                                                                                                                                 |
| `zip.py`      | `packages/runtime/test/fixtures/zip/`          | Python's `zipfile`, which writes the archives (stored and deflated entries, UTF-8 names, directories, data descriptors, a zip-slip, an absolute path, a backslash, a symbolic link, two names that normalize alike, a zip bomb) and reads back the ZIP64 archive that the script assembles |

Python and C differ in a few printf cases, which the printf script leaves out: the alternate form of `o`; the alternate
form and precision 0 of the integer conversions at the value 0; the flag `0` together with a precision on an integer
conversion; the flags `+` and space, and negative values, on the unsigned conversions `o`, `x` and `X`. Every case that
remains gives the same string with the C library's `printf`.

`zips.json` lists the files of each valid archive with the size and SHA-256 that `zipfile` read from it. The tests that need an
archive no tool writes, such as an encrypted entry, a header that understates a size, or a local header that names another
file, build it byte by byte (`test/zip-builder.ts`): their expected result is the rule, not an oracle.

The scripts use a fixed seed for their random samples and write the same files every time. Run them from the repository root
and commit the result.
