# Evidence

Every construct of the QTI 3.0 specifications has a row in `conformance/olah-inventory.json`: a table letter and a number
(`A79`), the construct, its source, the modules that implement it, the evidence that proves it and the build unit that
completes it. A construct that olah leaves to another system has an owner instead. [Conformance](conformance.md) renders
all rows with their tests.

## Evidence codes

| Code | Evidence                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| R    | Round trip: models satisfy read(write(m)) = m; documents of the corpus survive read and write unchanged up to canonical form |
| X    | Written output validates against the official XSD                                                                            |
| S    | Unit test whose expected value is a statement or worked example of the cited section                                         |
| P    | Property of the semantics, checked by fast-check                                                                             |
| D    | Differential test against Longsight `qti3-core` on items                                                                     |
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

| Field          | Meaning                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`, `name`   | As in Appendix A.                                                                                                                    |
| `group`        | `tests`, `sections`, `items`, `interactions`, `accessibility`, `metadata` or `packaging`.                                            |
| `levels`       | The levels that require the feature: `basic`, `advanced`, `elevated-accessibility`, `pnp` (CERT §3). Empty for an elective feature.  |
| `capabilities` | Optional. The capabilities for which olah and tempuh support it: `import`, `export`, `authoring`, `delivery`, `scoring` (CERT §2.2). |
| `owner`        | Optional. The package that supports it: `olah`, `tempuh` or `both`.                                                                  |
| `rows`         | Optional. The inventory rows that implement it.                                                                                      |

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
which `pnpm test` leaves out so that it runs offline. A corpus test calls `requireCorpus` of `scripts/corpus.ts`, which
fails with an instruction when the corpus is missing.

The regular expression tests (`packages/olah/test/values.corpus.test.ts`) apply the patterns of `msData/regex/` to the
instances that `msMeta/Regex_w3c.xml` names. They follow XML Schema 1.0, which INFO cites, and Unicode 6.0.0 where the
suite's result depends on the Unicode version. Tests that the suite marks as queried and tests of other base types than
string are left out.

To move a source to another commit, run `pnpm corpus:pin <source> [commit]`: it downloads the commit (the head of the
default branch when none is given), hashes the files that the source's `include` list selects and writes the lock.

## Tests that validate against the schemas

The XSDs of QTI 3.0 are 1EdTech and W3C files with their own license, so the repository does not contain them.
`packages/olah/src/node/schema-files.json` pins each schema to its address and SHA-256 (it is `SCHEMA_FILES` of
the `node` module). `pnpm schemas` downloads the files into `.cache/schemas` unless the files there already match their
hashes, and fails without writing a file whose hash differs. `pnpm schemas:pin` downloads every file and writes the hashes
that it finds, for the day a schema changes.

Tests that validate against the schemas are in files named `*.xsd.test.ts`, which `pnpm test` leaves out so that it runs
offline. `pnpm test:xsd` runs them: it needs `pnpm schemas`, and `pnpm corpus` when a test reads the examples. A file loads
one `SchemaSet` with `loadSchemaSet` in `beforeAll` and closes it in `afterAll`; compiling the ASI schema takes about 2
seconds, and each schema is compiled once per set. Every test of a writer passes the output to `validateXmlFiles`
([node](node.md) lists the evidence on the schemas).

`packages/olah/src/asi/element-table.ts` is generated from the pinned ASI schema by `scripts/asi-table.ts` (`pnpm asi-table`).
`asi.xsd.test.ts` generates the table again and fails when the committed file differs. The same file validates documents that
fast-check generates from the table, and checks that they use every element of the rows A1 to A130.

## Generators

`packages/olah/test/arbitraries/` holds the fast-check generators of the models that have a reader and a writer: values
(`values.ts`), results, usage data and PNP profiles and records, with the elements of an unknown namespace for the
extensions (`xml.ts`). A generated model is what a reader returns for the document the writer writes, so the properties
check `read(write(m))` against `m`, and the XSD tests validate a fixed sample of the written documents. A generator with
`extensions: false` leaves out the elements of an unknown namespace, which a schema with a strict wildcard rejects. The
generators of `asi` are driven by its element table instead (`asi-arbitraries.ts`).

## Differential tests

`differential/` is a private package, not a dependency of olah, that compares olah with Longsight `qti3-core`
(`@longsightgroup/qti3-core`, pinned to one version), which processes items. A case is an item document, responses and a
seed; an `Implementation` runs it and reports the outcome and template values as `Observed` values. `compare` runs two
implementations on a list of cases and reports

- the cases both accept, whose variables it compares;
- the cases both reject;
- the differences, including an item that only one accepts.

`corpusCases` builds cases from the item documents of a directory of the corpus. A difference that the specification
settles goes into `conformance/accepted-differences.json` with the item, the variable, the reason and the source; it
shows in the matrix as accepted and not as a difference.

## Fixtures from oracles

Expected values come from an oracle, never from the code under test. The scripts that write them are in `validation/` of
the repository and use the standard library of Python 3.12 or later:

| Script        | Fixture                                     | Oracle                                                                                     |
| ------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `printf.py`   | `packages/olah/test/fixtures/printf.json`   | Python's `%` operator, for `e E f g G d i o x X` with flags, width and precision           |
| `rounding.py` | `packages/olah/test/fixtures/rounding.json` | Python's `decimal` module with `ROUND_HALF_UP`, for `qti-round-to` and `qti-equal-rounded` |

Python and C differ in a few printf cases, which the printf script leaves out: the alternate form of `o`; the alternate
form and precision 0 of the integer conversions at the value 0; the flag `0` together with a precision on an integer
conversion; the flags `+` and space, and negative values, on the unsigned conversions `o`, `x` and `X`. Every case that
remains gives the same string with the C library's `printf`.

Both scripts use a fixed seed for their random samples and write the same files every time. Run them from the
repository root and commit the result.
