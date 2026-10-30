# AGENTS.md

Conventions for people and coding agents working in this repository. Read this before changing anything. Most
rules are enforced by `pnpm lint` (Biome and cspell), `pnpm typecheck`, `pnpm knip`, `pnpm conformance`,
`pnpm compat` and `pnpm docs:api`; the rest are checked in review.

olah is a QTI 3.0 runtime for JavaScript and TypeScript, and tempuh is the player built on it, in one repository.
[packages/olah/docs/architecture.md](packages/olah/docs/architecture.md) and
[packages/tempuh/docs/architecture.md](packages/tempuh/docs/architecture.md) state the design principles; follow them.

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
                          checkNonNegativeInteger, checkPositiveInteger, checkSeed
  src/random.ts           Random, SeededRandom, createRandom, restoreRandom
  src/<module>/           one folder per module, with an index.ts
  test/<module>.test.ts   one file per source folder; fixtures/ holds oracle output
  docs/                   guides, one per module, and architecture, conventions, spec-gaps, evidence and the generated
                          conformance matrix; TypeDoc publishes them with the API reference
packages/tempuh/          the player
  src/index.ts            re-exports the errors and the messages
  src/errors.ts           TempuhError, DataError, AccessError, LtiError, ServiceError
  src/checks.ts           describe, isRecord, and checkRecord, checkArray, checkFunction, checkProperties, checkString,
                          checkNonEmptyString, checkNonNegativeInteger, checkPositiveInteger, checkBoolean, checkPositive,
                          checkChoice
  src/messages/           Messages, the English and Indonesian catalogs, selectMessages
  src/protocol/           Caller, ActionEnvelope and ViewEnvelope, with their checks
  src/<folder>/           player/, client/, server/, scoring/, cat/, lti/ and caliper/, as the build units add them
  player.css              the stylesheet of a content root: themes, the QTI 3 shared vocabulary, the PNP presentation
  scripts/                build-static.ts writes the static files of the player: the PCI frame and the recording worklet
  test/<folder>.test.ts   one file per source folder; lint.test.ts runs Biome on the layering and the GritQL rules;
                          *.browser.test.ts render in Chromium, Firefox and WebKit; fixtures/ holds the servers and
                          commands of the browser tests
  docs/                   guides
differential/             olah against Longsight qti3-core
compat/                   the browser baseline: the lint of the built code, the banned features, the pinned engines
conformance/              the inventories and their tooling
scripts/                  corpus and schema downloads, Unicode and element table generators
validation/               Python scripts that write fixtures
biome/                    Biome GritQL plugins
```

## Commands

```bash
pnpm install
pnpm lint             # Biome and cspell; `pnpm format` fixes formatting
pnpm typecheck        # tsc over every package and the tooling
pnpm test             # Vitest, offline
pnpm test:browser     # the browser tests of tempuh in Chromium, Firefox and WebKit; run `pnpm exec playwright install`, `pnpm schemas` and `pnpm corpus` first
pnpm test:corpus      # tests that read the corpus; run `pnpm corpus` first
pnpm test:xsd         # tests that validate against the official XSDs; run `pnpm schemas` and `pnpm corpus` first
pnpm schemas          # downloads the XSDs into .cache/schemas; `pnpm schemas:pin` writes new hashes
pnpm unicode          # regenerates the Unicode tables of `values` from the pinned files
pnpm asi-table        # regenerates the element table of `asi` from the pinned ASI schema; run `pnpm schemas` first
pnpm knip             # unused files, exports and dependencies
pnpm conformance      # every row of a merged unit has a test; docs/conformance.md is current
pnpm compat           # the built JavaScript and the CSS of tempuh stay inside the browser baseline; run `pnpm build` first
pnpm compat:engines   # the smoke test in the pinned old browsers, in Docker; run `pnpm build` first
pnpm build            # tsc -b after deleting dist/, so that no stale output ships
pnpm check:packages   # builds, then publint and Are the Types Wrong on the packed packages
pnpm docs:api         # TypeDoc into docs/api; fails on undocumented exports
```

Run all of them before finishing a change. Development needs Node.js 22.18+ and pnpm 12. The scripts in `conformance/`,
`compat/` and `scripts/` are TypeScript that Node runs directly, so their relative imports end in `.ts`. `pnpm compat:engines`
also needs Docker. `pnpm test:browser` runs all three engines, and the Firefox of Playwright does not start on some macOS
versions (it did not on macOS 27): run the suite in the Linux container of
[evidence.md](packages/tempuh/docs/evidence.md#tests-in-a-browser) there.

## Releases

Changesets version and publish the packages, each on its own version. A release has one changeset per package in
`.changeset/`; changes made before the release extend it. To release, a pull request from a `changeset-release/` branch
runs `pnpm changeset version`, which bumps the versions, writes `CHANGELOG.md` and consumes the changesets. After it is
merged, the maintainer runs the Release workflow by hand: it builds and publishes the versions not yet on npm. No
workflow opens pull requests, and Dependabot version updates are off. Changesets, docs and TSDoc describe current
behavior only, without "now", "no longer", "renamed" or "previously".

## Boundary between olah and tempuh

olah owns everything QTI defines that is not presentation or platform; tempuh owns presentation and the platform
([architecture.md](packages/olah/docs/architecture.md#boundary-with-tempuh) lists who owns what).

- Semantics belong to olah: validity, visibility, the choice of a variant, processing, the rules of a session, time limits,
  the flow of scoring and the view without answer keys. tempuh asks olah and never evaluates an expression, decides what is
  visible or valid, chooses a variant, or holds an answer key outside olah's solution view.
- Presentation and the platform belong to tempuh: rendering, the host of portable custom interactions, accessibility in the
  interface, URLs, clocks and timers, storage, and the network (LTI, CAT adapters, Caliper). olah never renders, reads a
  clock, builds a URL or fetches, apart from `olah schemas fetch`. The policy about which actions a client may send is
  tempuh's.
- A rule that tempuh needs and olah lacks is a change in olah, with its inventory row and test, and not a workaround in
  tempuh.
- The packages meet in JSON: views, actions and state, with values as `WireValue`. They have their own versions.

## Dependencies

- A module imports only the modules in its row of the table in
  [architecture.md](packages/olah/docs/architecture.md#layers); every module may import `errors.ts`, `checks.ts` and
  `random.ts`. Biome enforces the rows, and imports never form cycles.
- The olah core uses no platform API: no `node:*`, `fetch`, timers, DOM or `process`. Only `node/` and `cli/` may.
- `scripts/schemas.ts` imports `packages/olah/src/cli/fetch-schemas.ts` by relative path, so that `pnpm schemas` and
  `olah schemas fetch` run one implementation. Node runs that file directly, so it imports only `node:*` modules and types.
- `packages/olah` never imports `tempuh`. `tempuh` and the other packages import olah by package name and subpath, never
  by a relative path into `src/` or `dist/`.
- Runtime dependencies are listed in `packages/olah/package.json`, pinned, and recorded in `SECURITY.md`.
- A tempuh folder imports only the folders in its row of the table in
  [architecture.md](packages/tempuh/docs/architecture.md#layers); `errors.ts`, `checks.ts` and `messages/` are below all
  of them. Biome enforces the rows. Only `cat/` imports takar, and `fetch` appears only as an option parameter.
- tempuh's shared folders use no DOM or Node, its browser folders no Node, and its server folders no DOM. Time comes from
  a clock that the caller passes: `Date.now` appears only in `client/clock.ts` and `server/clock.ts`.
- Browser folders import from `@luthfanwakan/olah/delivery` only `viewFromJson`, `actionToJson` and types, because the
  engine holds the answer keys: `client/local.ts` alone loads the engine, with `import()`, for practice on a device.

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
  `checkFunction`, a string with `checkString`, a number with `checkFinite`, `checkNonNegative`,
  `checkNonNegativeInteger` or `checkPositiveInteger`, a seed with `checkSeed`, a boolean with `checkBoolean` and a
  string option with `checkChoice`: `<Label> must be a positive integer, found <value>.` An option's label is
  `The option <name>`. Inner functions validate shallowly, so that a call does not cost the size of the model. Other
  messages show values with `describe`.
- Options and optional fields are destructured with their defaults, so that a value set to `null` is checked and rejected,
  never taken as absent.
- Validation returns `Issue`s and does not throw; each issue cites the rule that defines it.
- Never use `Math.random`, read a clock, or construct a `RegExp`. Take a `Random` or a time from the caller, and compile
  author patterns with the linear-time automaton of `values`. `pnpm lint` fails on all three in `packages/olah/src`.
- Identifier-keyed data lives in `Map`s, never in plain objects, so that an identifier such as `__proto__` stays data.
- Every semantic rule cites its specification section in the TSDoc or in a `//` comment.
- A number with a meaning is a named constant with its source.
- No speculative options, abstractions or modules. Add a method only when a real use needs it, with its validation.

## Browser baseline

tempuh runs in Chromium 111, Firefox 115 and Safari 16.4, and later versions. This covers the shared and browser folders:
`errors.ts`, `checks.ts`, `messages/`, `protocol/`, `player/` and `client/`, and every stylesheet. The `lib` of the browser
tsconfig is `ES2023`, `DOM` and `DOM.Iterable`, so that TypeScript rejects later built-ins. These features are in the
baseline and used: custom elements and open shadow roots, constructed stylesheets, `<dialog>`, `inert`, `:focus-visible`,
container queries, `color-mix()`, `ResizeObserver`, `MediaRecorder`, `AudioWorklet`, WebCrypto and the ES2023 array
methods.

These are banned. `pnpm lint` fails on them (`baseline.grit` for TypeScript, `baseline-css.grit` for CSS), and
`pnpm compat` fails on any other feature that a baseline browser lacks (eslint-plugin-compat on the built JavaScript,
stylelint-no-unsupported-browser-features on the CSS). Do not guard a banned feature with a support check: the code
would be dead in some browsers and untested in the others.

| Feature                                                              | First versions (Chromium, Firefox, Safari) | Use instead                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| The Popover API                                                      | 114, 125, 17                               | a dialog, or an element that script positions                                            |
| CSS nesting                                                          | 112, 117, 16.5                             | flat selectors                                                                           |
| The `:has()` selector                                                | 105, 121, 15.4                             | a class that script sets                                                                 |
| ARIA reflection through `ElementInternals`                           | 81, 119, 16.4                              | `aria-*` attributes                                                                      |
| The RegExp `v` flag                                                  | 112, 116, 17                               | the `u` flag; author patterns go through `compileXsdRegex`                               |
| `Intl.Segmenter`                                                     | 87, 125, 14.1                              | counters that count code points                                                          |
| Declarative shadow DOM (`shadowrootmode`)                            | 111, 123, 16.4                             | `attachShadow`                                                                           |
| `Object.groupBy`, `Map.groupBy` and `Promise.withResolvers`          | 117–119, 119–121, 17.4                     | plain loops                                                                              |
| CSS `@scope`, anchor positioning, `text-wrap: balance` and `subgrid` | outside at least one engine                | a shadow root to scope styles, script to position elements, and plain wrapping and grids |
| The ES2025 `Set` methods                                             | 122, 127, 17                               | loops over the sets                                                                      |
| Iterator helpers                                                     | 122, 131, 18.4                             | an array: spread the iterator first                                                      |
| `Array.fromAsync`                                                    | 121, 115, 16.4                             | `for await`                                                                              |
| `AbortSignal.any`                                                    | 116, 124, 17.4                             | one controller that each source signal aborts                                            |
| `text-wrap: pretty` and `@starting-style`                            | outside at least one engine                | plain wrapping, and transitions without entry styles                                     |

A new banned feature is a row of `compat/banned-features.ts` with the code that the lint must report and a probe for the
pinned engines, a pattern in the `.grit` files with the message of that row, and a row of this table; the tests in
`compat/test/` and `packages/tempuh/test/lint.test.ts` fail until the three agree. [baseline.md](packages/tempuh/docs/baseline.md)
describes how the baseline is tested.

## Comments and docs

- Every export has a TSDoc comment: types and constants a noun phrase, functions a third-person verb phrase
  ("Returns ...", "Builds ..."), properties a short phrase. Defaults are written `Default: \`x\`.`Errors are listed with
 `@throws`.
- `//` comments only explain why something non-obvious is done, or cite a source. No commented-out code.
- US English. Docs state facts in short sentences; prefer a table or list to prose. Code samples are complete: they
  show their imports. Values shown in samples come from running them. No marketing language, emojis or filler. The Example
  of `packages/olah/README.md` is the file `packages/olah/test/readme-example.ts`, and `readme.test.ts` fails when the README
  shows other code or other output.
- Each document has one purpose: `README.md` for users, `docs/` for guides, `CONTRIBUTING.md` for the contribution
  process, `AGENTS.md` for conventions, `SECURITY.md` for deployment security, `validation/README.md` for running the
  fixture scripts.

## Evidence and tests

- Every test names its inventory row in brackets in its title: `it("[A79] equal: relative tolerance includes both bounds
  by default")`. A row needs a test once its unit is merged; see [evidence.md](packages/olah/docs/evidence.md).
- tempuh's tests name the rows of `conformance/tempuh-inventory.json` the same way (`[T97]`) and its WCAG 2.2 criteria as
  `[SC 3.2.4]`. A test is checked against the inventory of its own package, so `[T1]` in tempuh is not olah's `T1`.
- Expected values come from an oracle, never from the code under test: the specification's own statements and worked
  examples, an independent implementation, or a script in `validation/`. Typed by hand only for edge cases small enough to
  derive exactly.
- One test file per source folder, named after it: `xml.test.ts` for `src/xml/`. A file's `describe` blocks follow the
  order of the folder's source files, with a closing `properties` block; within a block, the comparisons with the
  oracle and the main behavior come first, then the options, then errors and edge cases.
- Every public function has a test of input of other types, as JavaScript or JSON pass it: `null` options and
  arguments, a string for a number, an object for an array. Pass such input with `JSON.parse`, not a cast.
- Properties that hold for any input are tested with fast-check.
- Fuzz tests of readers use `FUZZ` of `test/fuzz.ts`: a fixed seed and a bounded number of runs, so that CI runs the
  inputs a laptop does. A reader of documents is tested with `fuzzReader`, which mutates valid documents (`mutations` of
  `test/arbitraries/xml.ts`) and accepts a result or a `ReadError` or `SecurityError`, nothing else. A defect that fuzzing
  finds gets a regression test with the input that exposed it.
- Fast-check generators are in `test/arbitraries/`, one file for each module.
- Tests that read the corpus are in files named `*.corpus.test.ts` and run with `pnpm test:corpus`; those of tempuh that
  also need a browser are named `*.browser.corpus.test.ts`.
- Tests that run in browsers are in files named `*.browser.test.ts` and run with `pnpm test:browser`.
- Tests that validate against the official XSDs are in files named `*.xsd.test.ts` and run with `pnpm test:xsd`. Every
  writer test passes its output to `validateXmlFiles` of `node` with a `SchemaSet` that the file loads once.
- Test names describe behavior: `it("shares the places at a tied boundary equally")`.

## Where things go

- A construct: its row in `conformance/olah-inventory.json` already exists; its tests name it, and its unit joins `merged`
  when the unit completes. The same holds for a duty of the player and a WCAG criterion in
  `conformance/tempuh-inventory.json`.
- An olah module: a folder in `src/` with `index.ts`, a subpath in `package.json` `exports`, `export *` in `src/index.ts`
  unless it is `node` or `cli`, a test file, a guide in `docs/`, import rules in `biome.json` and the table in
  [architecture.md](packages/olah/docs/architecture.md#layers), and a row in the API table of `packages/olah/README.md`.
  `node` and `cli`, which the root does not re-export, also get an entry point in `packages/olah/typedoc.json`.
- A tempuh folder: its row in the table of [architecture.md](packages/tempuh/docs/architecture.md#layers), its Biome
  overrides and its entry in `lint.test.ts` when it is not one of the folders there, a subpath in `package.json`
  `exports` and `typedoc.json` when the host imports it, a test file and a guide in `docs/`.
- Checks shared by modules: of one value in `checks.ts`; otherwise with the data they check.
- A place where the specifications contradict themselves or are silent: its row `G<n>` in `conformance/olah-inventory.json`,
  the resolution in [spec-gaps.md](packages/olah/docs/spec-gaps.md), a test, and a mention in the guide of the module.
- Something olah defines because QTI does not: [conventions.md](packages/olah/docs/conventions.md), built from QTI's own
  elements so that documents stay valid.
- A difference from Longsight `qti3-core` that the specification settles: `conformance/accepted-differences.json`.
