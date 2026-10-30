# AGENTS.md

Conventions for people and coding agents working in this repository. Read this before changing anything. Most
rules are enforced by `pnpm lint` (Biome and cspell), `pnpm typecheck`, `pnpm knip`, `pnpm conformance` and
`pnpm docs:api`; the rest are checked in review.

olah is a QTI 3.0 runtime for JavaScript and TypeScript, and tempuh is the player built on it, in one repository.
[packages/olah/docs/architecture.md](packages/olah/docs/architecture.md) states the design principles; follow them.

## Terms

Use these words with these meanings in code, comments and docs.

| Term                      | Meaning                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| item                      | One question or task: a `qti-assessment-item` with interactions, declarations and processing.                                      |
| test                      | A `qti-assessment-test`: items arranged in test parts and sections.                                                                |
| test part                 | A major division of a test, with a navigation mode and a submission mode.                                                          |
| section                   | A group of item references and sections, with selection, ordering and visibility rules.                                            |
| item ref                  | A `qti-assessment-item-ref`: the reference from a section to an item.                                                              |
| item instance             | One occurrence of an item in a test session; selection with replacement makes several of one item.                                 |
| item session              | The state of one item instance for one candidate: variables, attempts and status.                                                  |
| attempt                   | One cycle of responding that ends when the responses go to response processing.                                                    |
| candidate session         | The delivery of one test, or one item, to one candidate.                                                                           |
| draft, submitted response | A draft is what the candidate has entered; a submitted response is what response processing reads. Only submitted responses count. |
| outcome                   | A variable that processing sets, such as `SCORE`.                                                                                  |
| template variable         | A variable that template processing sets once for an item instance.                                                                |
| context variable          | A variable that a test declares and its items read.                                                                                |
| NULL                      | The absence of a value (INFO §2.2.2). In code it is `null`, never `undefined`.                                                     |
| container                 | A value of cardinality `multiple`, `ordered` or `record`.                                                                          |
| interaction               | An element that presents a task and binds a response variable.                                                                     |
| choice                    | An option of a choice-based interaction.                                                                                           |
| action                    | An input to the delivery engine, with the time it happened.                                                                        |
| refusal                   | The engine's answer to a well-formed action that the rules do not allow; the state stays unchanged.                                |
| pending work              | A request the engine makes to its host and waits for, such as an external score.                                                   |
| cover                     | The olah convention that names the items an externally scored outcome of a test covers.                                            |
| inventory row             | One construct of the specifications in `conformance/olah-inventory.json`, such as `A79`.                                           |
| unit                      | A step of the build plan; a row has the unit that completes its evidence.                                                          |

## Layout

```
packages/olah/            the library
  src/index.ts            re-exports the modules, the errors and the random number generator
  src/errors.ts           OlahError, DataError, ReadError, SecurityError, ProcessingError; Issue
  src/checks.ts           checks of one value: describe, isRecord, and checkRecord, checkArray, checkOptions,
                          checkFunction, checkString, checkBoolean, checkChoice, checkFinite, checkNonNegative,
                          checkPositiveInteger, checkSeed
  src/random.ts           Random, SeededRandom, createRandom, restoreRandom
  test/<module>.test.ts   one file per source folder; fixtures/ holds oracle output
  docs/                   guides; TypeDoc publishes them with the API reference
packages/tempuh/          the player
differential/             olah against Longsight qti3-core
conformance/              the inventory and its tooling
scripts/                  corpus download, Unicode table generator
validation/               Python scripts that write fixtures
biome/                    Biome GritQL plugins
```

## Commands

```bash
pnpm install
pnpm lint             # Biome and cspell; `pnpm format` fixes formatting
pnpm typecheck        # tsc over every package and the tooling
pnpm test             # Vitest, offline
pnpm test:corpus      # tests that read the corpus; run `pnpm corpus` first
pnpm unicode          # regenerates the Unicode tables of `values` from the pinned files
pnpm knip             # unused files, exports and dependencies
pnpm conformance      # every row of a merged unit has a test; docs/conformance.md is current
pnpm build            # tsc -b after deleting dist/, so that no stale output ships
pnpm check:packages   # builds, then publint and Are the Types Wrong on the packed packages
pnpm docs:api         # TypeDoc into docs/api; fails on undocumented exports
```

Run all of them before finishing a change. Development needs Node.js 22.18+ and pnpm 12. The scripts in `conformance/`
and `scripts/` are TypeScript that Node runs directly, so their relative imports end in `.ts`.

## Releases

Changesets version and publish the packages, each on its own version. A release has one changeset per package in
`.changeset/`; changes made before the release extend it. To release, a pull request from a `changeset-release/` branch
runs `pnpm changeset version`, which bumps the versions, writes `CHANGELOG.md` and consumes the changesets. After it is
merged, the maintainer runs the Release workflow by hand: it builds and publishes the versions not yet on npm. No
workflow opens pull requests, and Dependabot version updates are off. Changesets, docs and TSDoc describe current
behavior only, without "now", "no longer", "renamed" or "previously".

## Dependencies

- A module imports only the modules in its row of the table in
  [architecture.md](packages/olah/docs/architecture.md#layers); every module may import `errors.ts`, `checks.ts` and
  `random.ts`. Biome enforces the rows, and imports never form cycles.
- The olah core uses no platform API: no `node:*`, `fetch`, timers, DOM or `process`. Only `node/` and `cli/` may.
- `packages/olah` never imports `tempuh`. `tempuh` and the other packages import olah by package name and subpath, never
  by a relative path into `src/` or `dist/`.
- Runtime dependencies are listed in `packages/olah/package.json`, pinned, and recorded in `SECURITY.md`.

## Naming

- Files: kebab-case. One concept per file, named after it. Group files in folders by module.
- Values and functions: camelCase. Module-level constant data: SCREAMING_SNAKE. Object keys may also be SCREAMING_SNAKE,
  for the identifiers of QTI variables such as `SCORE`.
- Types: PascalCase. Type parameters: `T` or `T` plus a name.
- QTI names keep their spelling in the model: `qti-assessment-item` becomes `AssessmentItem`, and attribute `max-attempts`
  becomes `maxAttempts`.
- Function options are `<Name>Options`; limits are `<Name>Limits` with `DEFAULT_<NAME>_LIMITS` for the defaults.
- Labels are string unions in kebab-case (`"very-good"`).

## Code

- TypeScript strict, ESM, named exports only, `.js` extensions in relative imports of `src/`, `import type` for types.
- No `as` casts except where untyped data enters and is validated next. No non-null assertions.
- Entry points validate their input deeply and throw `DataError` with a full sentence that says what is wrong and what is
  expected, e.g. `A seed must be a safe integer, found 1.5.` Input may come from plain JavaScript or JSON, so every
  argument is checked for its type before it is read, once, where the public function reads it, with a `check` function of
  `checks.ts`: options with `checkOptions`, arrays with `checkArray`, objects with `checkRecord`, a function with
  `checkFunction`, a string with `checkString`, a number with `checkFinite`, `checkNonNegative` or
  `checkPositiveInteger`, a seed with `checkSeed`, a boolean with `checkBoolean` and a string option with `checkChoice`:
  `<Label> must be a positive integer, found <value>.` An option's label is `The option <name>`. Inner functions validate
  shallowly, so that a call does not cost the size of the model. Other messages show values with `describe`.
- Options and optional fields are destructured with their defaults, so that a value set to `null` is checked and rejected,
  never taken as absent.
- Validation returns `Issue`s and does not throw; each issue cites the rule that defines it.
- Never use `Math.random`, read a clock, or construct a `RegExp`. Take a `Random` or a time from the caller, and compile
  author patterns with the linear-time automaton of `values`. `pnpm lint` fails on all three in `packages/olah/src`.
- Identifier-keyed data lives in `Map`s, never in plain objects, so that an identifier such as `__proto__` stays data.
- Every semantic rule cites its specification section in the TSDoc or in a `//` comment.
- A number with a meaning is a named constant with its source.
- No speculative options, abstractions or modules. Add a method only when a real use needs it, with its validation.

## Comments and docs

- Every export has a TSDoc comment: types and constants a noun phrase, functions a third-person verb phrase
  ("Returns ...", "Builds ..."), properties a short phrase. Defaults are written `Default: \`x\`.`Errors are listed with
 `@throws`.
- `//` comments only explain why something non-obvious is done, or cite a source. No commented-out code.
- US English. Docs state facts in short sentences; prefer a table or list to prose. Code samples are complete: they
  show their imports. Values shown in samples come from running them. No marketing language, emojis or filler.
- Each document has one purpose: `README.md` for users, `docs/` for guides, `CONTRIBUTING.md` for the contribution
  process, `AGENTS.md` for conventions, `SECURITY.md` for deployment security, `validation/README.md` for running the
  fixture scripts.

## Evidence and tests

- Every test names its inventory row in brackets in its title: `it("[A79] equal: relative tolerance includes both bounds
  by default")`. A row needs a test once its unit is merged; see [evidence.md](packages/olah/docs/evidence.md).
- Expected values come from an oracle, never from the code under test: the specification's own statements and worked
  examples, an independent implementation, or a script in `validation/`. Typed by hand only for edge cases small enough to
  derive exactly.
- One test file per source folder, named after it: `xml.test.ts` for `src/xml/`. A file's `describe` blocks follow the
  order of the folder's source files, with a closing `properties` block; within a block, the comparisons with the
  oracle and the main behavior come first, then the options, then errors and edge cases.
- Every public function has a test of input of other types, as JavaScript or JSON pass it: `null` options and
  arguments, a string for a number, an object for an array. Pass such input with `JSON.parse`, not a cast.
- Properties that hold for any input are tested with fast-check.
- Tests that read the corpus are in files named `*.corpus.test.ts` and run with `pnpm test:corpus`.
- Test names describe behavior: `it("shares the places at a tied boundary equally")`.

## Where things go

- A construct: its row in `conformance/olah-inventory.json` already exists; its tests name it, and its unit joins `merged`
  when the unit completes.
- A module: a folder in `src/` with `index.ts`, a subpath in `package.json` `exports`, `export *` in `src/index.ts`
  unless it is `node` or `cli`, a test file, a guide in `docs/`, import rules in `biome.json` and the table in
  [architecture.md](packages/olah/docs/architecture.md#layers), and a row in the API table of `packages/olah/README.md`.
- Checks shared by modules: of one value in `checks.ts`; otherwise with the data they check.
- A difference from Longsight `qti3-core` that the specification settles: `conformance/accepted-differences.json`.
