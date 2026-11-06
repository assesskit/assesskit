# AGENTS.md

The working rules of this repository for people and coding agents. The gates enforce most of them (`pnpm lint`,
`check:standards`, `typecheck`, `knip`, `compat:baseline`, `docs:api`); this file holds the rest. The workspace's engineering standards
apply, and the deviations from them are recorded below.

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
| NULL                      | The absence of a value (INFO section 2.2.2). In code it is `null`, never `undefined`.                                              |
| container                 | A value of cardinality `multiple`, `ordered` or `record`.                                                                          |
| interaction               | An element that presents a task and binds a response variable.                                                                     |
| choice                    | An option of a choice-based interaction.                                                                                           |
| action                    | An input to the delivery engine, with the time it happened.                                                                        |
| refusal                   | The engine's answer to a well-formed action that the rules do not allow; the state stays unchanged.                                |
| pending work              | A request the engine makes to its host and waits for, such as an external score.                                                   |
| cover                     | The runtime convention that names the items an externally scored outcome of a test covers.                                         |

## Layout

| Path                                                             | Holds                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/runtime/src/<module>/`                                 | One folder per module: `index.ts`, the one entry that exports the module's names, `internal.ts` for what other modules or the tests need and a host does not (the item session, the plan and the times of delivery are a host's through `createEngine`), a file per concept                 |
| `packages/runtime/src/{errors,checks,checks-internal,random}.ts` | The errors, the checks of one value, the checks that only the runtime uses, the random number generator; the subpaths `errors` and `checks` serve the player                                                                                                                                |
| `packages/runtime/test/`                                         | `<module>.test.ts` for each source folder; `fixtures/` (oracle output, stored states); `differential/` (the harness against Longsight `qti3-core` and Amp-up `qti3-item-player`)                                                                                                            |
| `packages/player/src/`                                           | `errors.ts`, `messages/`, `protocol/`, `player/`, `client/`, `server/`, `scoring/`, `cat/`, `cat-rest/`                                                                                                                                                                                     |
| `packages/player/{player.css,scripts/,test/}`                    | The stylesheet of a content root; `build-static.ts` (the PCI frame and the recording worklet); `<folder>.test.ts`, `fixtures/` (servers and commands of the browser tests)                                                                                                                  |
| `packages/custom-interactions/src/`                              | `index.ts`, `interaction-types.ts` and `write-character-module.ts`, the root entry; `node/`, the reader of the built modules; `frame/`, what the modules share in the frame; a folder for each interaction, its AMD module from `module.ts`                                                 |
| `packages/custom-interactions/{scripts,test,licenses}/`          | `build-modules.ts`, which bundles each module into `modules/` (ignored by git); the tests, with `fixtures/` (the asset origin and the commands of the browser tests); the licenses of files that a module carries beside it                                                                 |
| `examples/<package>/<name>/`                                     | A runnable example, a package of its own; its `test/` runs it                                                                                                                                                                                                                               |
| `docs/<package>/`                                                | The guides of a package, one per module, with architecture, evidence and supported; TypeDoc publishes them                                                                                                                                                                                  |
| `docs/typedoc-seo.ts`, `docs/favicon.svg`                        | The plugin of TypeDoc that makes the docs site from `scripts/family.ts`, and the icon of the site; `.github/workflows/docs.yml` deploys the site to GitHub Pages and stays disabled until the repository is public                                                                          |
| `compat/`, `scripts/`, `validation/`, `biome/`                   | The browser baseline (`compat/`) and the runtimes (`compat/runtimes/`); downloads, generators, CI checks (`check-*.ts`, `rules/`), the peak-memory harness, the runner of the samples of the guides and `prepare.ts`; fixture scripts (Python, and Moodle in containers); GritQL lint rules |

[Layers](docs/runtime/architecture.md#layers) and [player layers](docs/player/architecture.md#layers) are rows of tables that
Biome enforces, folder by folder.

## Commands

| Command                          | Does                                                                                                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                   | Installs the dependencies and, in a clone or a worktree, the git hooks (`scripts/prepare.ts`)                                                                                                                                                                        |
| `pnpm lint`, `pnpm format`       | Biome, and cspell over the sources, tests, guides, READMEs, scripts, changesets and the Markdown at the root; `format` fixes formatting                                                                                                                              |
| `pnpm check:standards`           | The standards that a tool can check, the sections of the guides and READMEs among them; `node scripts/check-standards.ts <path>...` reports the files below the paths                                                                                                |
| `pnpm check:duplication`         | jscpd over `packages/*/src`; fails on a repeat that [the table below](#repeats-left-on-purpose) does not list                                                                                                                                                        |
| `pnpm typecheck`                 | `tsc` over every package, example and the tooling                                                                                                                                                                                                                    |
| `pnpm knip`                      | Unused files, exports and dependencies                                                                                                                                                                                                                               |
| `pnpm test`                      | Vitest in Node, offline: no browser, corpus, XSD or benchmark project                                                                                                                                                                                                |
| `pnpm test:coverage`             | The Node tests with the coverage floors: statements, functions and lines of each module, a folder of a package's `src` or a file beside them, and branches of each package (`vitest.config.ts`); the XSD run holds `cli` and `node`                                  |
| `pnpm test:browser`              | The browser tests in Chromium, Firefox and WebKit; needs `pnpm exec playwright install`, `pnpm schemas`, `pnpm corpus`                                                                                                                                               |
| `pnpm test:coverage:browser`     | The browser tests in Chromium with the floors of the folders that draw a page and of the client                                                                                                                                                                      |
| `pnpm test:corpus`               | The tests that read the corpus; needs `pnpm corpus`                                                                                                                                                                                                                  |
| `pnpm test:xsd`                  | The tests that read the official XSDs; needs `pnpm schemas` and `pnpm corpus`                                                                                                                                                                                        |
| `pnpm test:coverage:xsd`         | The XSD tests with the tests of the runtime, and the floors of the runtime's `cli` and `node`; needs `pnpm schemas` and `pnpm corpus`                                                                                                                                |
| `pnpm bench`                     | The benchmarks of the runtime, then the mount time of the player in Chromium with the CPU slowed 4 times, one package at a time, against budgets and against Longsight, libxml2 and the Amp-up player                                                                |
| `pnpm build`                     | `tsc -b` after deleting `dist/`, so that no stale output ships                                                                                                                                                                                                       |
| `pnpm check:packages`            | publint and Are the Types Wrong on the packed packages                                                                                                                                                                                                               |
| `pnpm check:release`             | Fails when a package that a changeset releases is private or lacks `publishConfig.access`, or is at 0.0.0 and its changesets give it less than `major` (below 1.0.0) or tell of an earlier state                                                                     |
| `pnpm check:tarballs`            | Installs the packed packages into a scratch project, imports every subpath and type-checks it with `bundler` and `node16`                                                                                                                                            |
| `pnpm check:licenses`            | Fails on a production dependency whose license is not MIT, Apache-2.0, BSD or ISC                                                                                                                                                                                    |
| `pnpm check:audit`               | `pnpm audit` of the production dependencies at any severity and of all dependencies at high; needs the network                                                                                                                                                       |
| `pnpm check:rules`               | Removes each security rule of `scripts/rules/` from a copy of the code and fails when its test still passes (exit 1); a run that takes too long is reported as `TIMED OUT` (exit 2), never as unguarded; needs Chromium; takes the source files whose rules to check |
| `pnpm docs:api`                  | TypeDoc into `docs/api`, with the pinned Mermaid copied in so that no page loads a script from elsewhere; fails on undocumented exports                                                                                                                              |
| `pnpm check:site`                | The site that `pnpm docs:api` built: a title, a description and a canonical URL for each page, the sitemap, the Markdown copy of each README and guide, `llms.txt` and the links to it                                                                               |
| `pnpm compat:baseline`           | The built JavaScript and the CSS of the player, and the built JavaScript of the runtime but `node` and `cli`, stay inside the browser baseline                                                                                                                       |
| `pnpm compat:engines`            | The smoke test in the pinned old browsers; needs Docker                                                                                                                                                                                                              |
| `pnpm compat:runtimes`           | The built runtime and the handler of the CAT binding give the same results on Node.js, Deno, Bun and workerd, and the bundles hold no file outside a package's `dist`; needs Deno and Bun                                                                            |
| `pnpm corpus`, `pnpm schemas`    | Download the 1EdTech examples into `.cache/corpus` and the XSDs into `.cache/schemas`, which CI keeps by the hash of their locks; `corpus:pin` and `schemas:pin` write new hashes                                                                                    |
| `pnpm conformance`               | Takes the official packages of a 1EdTech member through the runtime, outside the repository; `conformance:pin` rewrites the feature list                                                                                                                             |
| `pnpm unicode`, `pnpm asi-table` | Regenerate the Unicode tables of `values` and `operators` with the grapheme break test fixture, and the element table of `asi` (needs `pnpm schemas`), from the pinned files                                                                                         |

- A gate that reads `dist/` builds it first, so a fresh clone passes every gate.
- Run the gates that the change touches before finishing; [CONTRIBUTING.md](CONTRIBUTING.md#before-opening-a-pull-request) says which.
- The `changes` job of `ci.yml` compares the commit with the last green run of main and gives each job to the packages it reads.
  A package's change reaches the members that use it (the player, the examples and compat/runtimes use the runtime); the guides in
  `docs/<package>/` reach the jobs that run their samples, not the members that use the package, except that the player's
  tests hold the runtime's delivery guide to the wire format; the lock file, the root configuration, `ci.yml` and the scripts
  that the tests share reach every job, and Markdown, changesets and the configuration of the linters reach `check` alone. The
  tests of `scripts/` read the sources of the mutation rules, the changesets and the manifests, and bundle the sources of the
  packages for the peak-memory readings, so every run of `test` holds them. A newer push to the same ref cancels the run in progress; a cancelled run is not a failure. Every job has a
  `timeout-minutes` of about three times its last green time, so a hung job stops.
- `rules` is not a job of `ci.yml`: `rules.yml` runs it each Monday, on `workflow_dispatch` and from `release.yml`, which publishes
  only when it passes, so that per-push CI stays short as Actions minutes are limited. A builder runs the rules of its package
  before a merge (`pnpm check:rules packages/<package>`).
- `player-bench`, `browsers` and `rules` run in the image of the Playwright that the lock file pins, which holds the browsers,
  so that no job installs them: a bump of Playwright changes the tag in both workflows and in the container of
  [evidence.md](docs/player/evidence.md#tests-in-a-browser), which `scripts/test/versions.test.ts` holds to the lock file.

| Job                      | Runs when the change reaches                                                              | Minutes |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------: |
| `check`                  | every push                                                                                |      12 |
| `test` (Node 22, 24, 26) | any package, example, compat or script                                                    |      20 |
| `bench`                  | the runtime                                                                               |      10 |
| `player-bench`           | the player                                                                                |      10 |
| `browsers`               | the player, its guides, or the custom interactions                                        |      25 |
| `engines`                | the player or compat                                                                      |      10 |
| `runtimes`               | the runtime, the player or compat/runtimes                                                |      10 |
| `corpus`                 | the runtime, its guides or an example of it                                               |      10 |
| `xsd`                    | the runtime, its guides, the player, the custom interactions or an example of the runtime |      10 |
| `rules` (`rules.yml`)    | each Monday, on dispatch and at a release                                                 |     120 |

- The scripts in `compat/` and `scripts/` are TypeScript that Node runs directly, so their relative imports end in `.ts`.
- The Firefox of Playwright does not start on some macOS versions (it did not on macOS 27): run the browser tests in the Linux
  container of [evidence.md](docs/player/evidence.md#tests-in-a-browser) there.

## Releases

- Changesets version and publish the packages, each on its own version. A release has one changeset per package in
  `.changeset/`; a change made before the release extends it, so that its notes state what the release is. The notes of a
  first release reach the changelog of 1.0.0 and name no earlier state.
- A pull request from a `changeset-release/` branch runs `pnpm changeset version`; after it merges, the maintainer runs the
  Release workflow by hand from the public repository: it runs `rules.yml` and, when it passes, builds and publishes the
  versions not yet on npm with provenance, the first version of each package with the short-lived token of the secret
  `NPM_TOKEN` and later ones through each package's trusted publisher; then `scripts/github-release.ts` creates one GitHub
  release named by the date with the versions published and their changelog entries (`node scripts/github-release.ts
  --dry-run` prints it and creates nothing).
- At the public release the owner sets what a repository file cannot: the repository's description (the family's sentence of
  `scripts/family.ts`), topics and homepage, the social preview (`.github/social-preview.png`, drawn from
  `.github/social-preview.svg`), the organization's profile (`.github/profile/README.md`, copied into the organization's
  `.github` repository), the domain of `SITE` with Pages and `docs.yml`, and Zenodo, which reads `CITATION.cff`. Context7 reads
  `context7.json`, whose description and rules `pnpm check:standards` holds to the family's sentence and `FACTS`.

## Boundary between the runtime and the player

[architecture.md](docs/runtime/architecture.md#boundary-with-the-player) says who owns what. The player never evaluates an
expression, decides what is visible or valid, chooses a variant, or holds an answer key outside the runtime's solution view. A rule
that the player needs and the runtime lacks is a change in the runtime, with its test, never a workaround in the player.

## Dependencies

- `scripts/schemas.ts` and `scripts/download.ts` import `packages/runtime/src/cli/fetch-schemas.ts` by relative path, so that
  `pnpm schemas`, `assesskit schemas fetch` and every other download of the repository (the corpus, the Unicode tables, the
  conformance document) run one implementation, with a stall timeout of 30 s and three tries. Node runs that file directly and
  does not resolve the `.js` specifiers of an `internal.ts`, so it imports only `node:*` modules and types;
  `scripts/asi-table.ts` imports only types, through `asi/internal.ts`. A script downloads through
  `scripts/download.ts`, which reports each retry on the standard error.
- Dependencies are pinned to exact versions, development ones too; a runtime dependency has its row in
  [SECURITY.md](SECURITY.md#runtime-dependencies). A version is installed only when it is at least 3 days old:
  `pnpm-workspace.yaml` sets `minimumReleaseAge: 4320`, which pnpm checks against the lock file on every install.
- `pnpm check:audit` lets four advisories below high pass, all of development dependencies that read no untrusted input
  (2026-11-05): quill 1.3.7 (GHSA-4943-9vgg-gr5r) and vue 2.7.16 (GHSA-5j4c-8p2g-v4jx), which the Amp-up player carries, a
  reference that the tests run on the repository's own items, and which no release of it replaces; minimatch 10.2.6
  (GHSA-g3hv-75wg-m249), which TypeDoc and ESLint run on the patterns of the configuration, and whose repair, minimatch 11,
  lacks the `matchOne` that TypeDoc calls; and katex 0.16.47 (GHSA-238p-pmpm-9mq7), which Mermaid bundles into the copy that
  the docs site serves, where it draws only the repository's diagrams.
- The player gets `AssesskitError` and `DataError` from `@assesskit/runtime/errors` and its checks from
  `@assesskit/runtime/checks`, never from the root of the runtime, which holds only the random number generator. Its browser folders take the wire
  forms of views and actions from `@assesskit/runtime/delivery/wire` and only types from `@assesskit/runtime/delivery`, whose
  index reaches the engine: esbuild splits code by file, so a page that imports the index and also loads the engine with
  `import()` loads the whole engine first.
- The remote session is `@assesskit/player/client` and the local session `@assesskit/player/client/local`: a part that a page
  uses alone is a subpath of its own, so that an exam page and a practice page each import only what they run, in every
  bundler.
- `scripts/measurekit.lock.json` and `scripts/interopkit.lock.json` change with the library that an example needs.
- A library that a module of `@assesskit/custom-interactions` holds is a development dependency of that package, bundled at
  build time and pinned, with its row in [SECURITY.md](SECURITY.md#runtime-dependencies): `scripts/build-modules.ts` heads the
  module with the library's license and fails on one that `check:licenses` refuses, and a file that the module loads beside it,
  such as a font, carries its own license into the module's folder.
- The JSON of the bodies of the CAT REST binding is written once, in `packages/player/src/cat-rest/binding.ts`, and the client
  and the handler both use it.

## Deviations from the standards

| Standard                                                                     | What the repository does                                                                                                                                     | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each type is exported by the entry that owns it, never re-exported by a root | The root of the player exports the 44 types of `@assesskit/runtime` that its declarations name, and the root of the custom interactions `CallOptions`        | A user installs one package, and pnpm does not let a program import a dependency of a dependency, so a type of the runtime in a signature must come from the package a user installed (STANDARDS section 4, "Types of a dependency"). `scripts/test/root-types.test.ts` holds each root to exactly the names its declarations use; `AssesskitError`, the base class of `AccessError`, is exported as a value so that `instanceof` holds. |
| Code that two packages of a family need goes in the family's `core`          | The checks of one value, `CallOptions` and `raceAbort`, which the runtime and the player share, are `@assesskit/runtime/checks`; no `@assesskit/core` exists | The family has two packages and the player depends on the runtime already, so a third package would add a release and a boundary for plain functions. Approved by the owner on 2026-11-01.                                                                                                                                                                                                                                               |
| A trusted library's project is active in the last year                       | `saxes` 6.0.0 and `xmlchars` 2.2.0 read XML; their last releases are of May 2022, and their repositories are archived                                        | They implement XML 1.0 and Namespaces in XML 1.0, which have not changed since, with no advisory; the alternatives are named in [xml.md](docs/runtime/xml.md#build-or-adopt). Approved by the owner on 2026-11-05.                                                                                                                                                                                                                       |
| A part with a standard or dependencies of its own is its own package         | `item-formats` is a subpath of the runtime, with `parse5`                                                                                                    | A package would make `typeNamed`, `writeElement`, `parseAttributeValue` and `TypeInfo` public, internals of `asi` that it reads; `parse5` with its one dependency, `entities`, is 876 KB installed against `valibot`'s 1.8 MB. A move after 1.0 breaks an import. Approved by the owner on 2026-11-05.                                                                                                                                   |

## Naming

- QTI names keep their spelling in the model: `qti-assessment-item` becomes `AssessmentItem`, and the attribute `max-attempts`
  becomes `maxAttempts`.
- Functions are named by the verbs of STANDARDS section 4: `validate<X>` returns `Issue`s, `check<X>` throws `DataError`, `read<X>`
  and `write<X>` convert a form that QTI or another standard defines, `build<X>` assembles plain data and `create<X>` returns an
  object with behavior. A quantity that QTI names keeps its name (`rubricScoreRange`, `allowLateSubmission`).
- Options are `<Name>Options`, named for the function (`ReadNumericRecordOptions`); limits are `<Name>Limits`, with
  `DEFAULT_<NAME>_LIMITS` for the defaults. An optional parameter goes in the options, and only a required one is positional.
- Labels are string unions in kebab-case (`"very-good"`).

## Code

- No `as` casts except where untyped data enters and is validated next.
- Entry points check their input deeply, once, where the public function reads it, with the `check*` functions of `checks.ts`,
  and throw `DataError` with a full sentence: `<Label> must be a positive integer, found <value>.` An option's label is
  `The option <name>`, and a value is shown with `describe`. Inner functions validate shallowly, so that a call does not cost
  the size of the model.
- JSON and objects that a host passes in are read with a valibot schema named `<name>Schema` and `parseWith(schema, input, label)`,
  which throws the `DataError` of the first issue with its path. `check*` calls stay for the arguments of inner functions.
- Every options object is read one way: `parseWith(strictRecord({...}), options, "The options object")`, so that an option the
  function does not take, a misspelled one, is refused whatever its type. A host's callback is `functionSchema`, its object
  with methods `methodsSchema`, any other object `objectSchema`, a DOM object `guardSchema`; the limits of a module are
  `limitsSchema(DEFAULTS, caps)` of `checks-internal.ts`. A schema takes three to five times as long as the key list, so a
  function that every item, node or element goes through (`startItemSession`, `createItemVariables`, `listPlanItems`,
  `timeLimits`, `resolveStandaloneSessionControl`, `buildElement`, `findAttribute`, `resolveResourcePath`) reads its options with `checkOptionNames`, over the key
  list, to keep the work of one item within the budgets of the benchmarks. The options of a call that waits (`CallOptions`, `HostApplyOptions`)
  are read by `checkCallOptions` and `checkHostApplyOptions`, which are over the key list: every port call reads them, and one
  sentence serves them all. The options of `mountDelivery` and `mountItem` are read over the key list too, by
  `checkDeliveryOptions` and `checkItemOptions`.
- A rule that a schema cannot express is a `check` or a `rawCheck` with a message of its own, or code after the parse; code
  that throws `DataError` joins a schema with `transformWith`.
- `strictRecord` where nothing else is allowed. `recordSchema` before an object schema of untrusted input: it refuses an
  array, which valibot reads as an object whose entries are all optional, and `__proto__`, `prototype` and `constructor`, which
  `v.object` and `v.looseObject` drop unseen. `mapSchema` where property names are data, which keeps those names as names. The
  names are one constant in `checks.ts`.
- A function that valibot calls to make a default is wrapped, `() => fn`.
- No valibot grapheme action (`graphemes`, `minGraphemes`, `maxGraphemes`): they use `Intl.Segmenter`, which the browser baseline bans.
- Options and optional fields are destructured with their defaults, so that a value set to `null` is checked and rejected, never
  taken as absent.
- An error that reports another holds it as `cause`: every error class takes `ErrorOptions` last, `biome/error-cause.grit`
  holds `packages/*/src` to it for an error built in a `catch`, and a helper that builds an error for a caught one, such as
  `createReadError`, takes the cause in its options. A broken invariant of the code itself is an `AssesskitError`, never a
  plain `Error`.
- Validation returns `Issue`s, each with the stable `rule` it breaks and a message, and does not throw. A refusal of the engine is
  `{ reason, message }`, and an error that names its cause has a `reason`; each `reason` is a kebab-case union the package
  exports (`RefusalReason`, listed in the [delivery guide](docs/runtime/delivery.md), and `AccessErrorReason`).
- Identifier-keyed data lives in `Map`s, never in plain objects, so that an identifier such as `__proto__` stays data.
- A reader of untrusted input bounds it before it builds anything, with a size or a token count before `JSON.parse`, and a list
  of findings has a limit (`maxFindings`): memory follows the tokens and the findings, not the bytes.
- An array whose length a document, a response or a request decides is never spread into the arguments of a call (`push`,
  `append`, `Math.max`): above about 100,000 values that throws a `RangeError`. `biome/no-spread-arguments.grit` holds every
  folder of `packages/*/src` to it for `push`, `unshift`, `append`, `prepend`, `replaceChildren`, `Math.min` and `Math.max`,
  and lets a call spread an array literal or a choice between two, whose length the code sets. Nodes go into an element with
  `appendAll` or `replaceAll` of `player/dom.ts`, which append in steps and are the one place the rule leaves out.
- Every semantic rule names its specification with `@see` in the TSDoc of the code that applies it, and not in an issue.
- A status or message the player writes after an action keeps its room whether or not it has text: the style gives it a
  `min-height` and never `display: none` when empty, so that what follows does not move under a pointer and a button that
  moves between press and release does not lose its click. A new live region gets a browser test that holds the position of the
  element after it across the write (STANDARDS section 10). Room is kept only for what can appear after the render: the hint
  of an interaction keeps its line while the candidate responds when a response given through the controls can break a rule
  (`hintCanChange` of `elements/hints.ts`), and a note set once at the render, such as the limits, or a hint that the controls
  rule out, takes none while it is empty. A status that can grow beyond its line stands after the controls it describes, so
  that its growth moves nothing a pointer aims at; where a control must follow it, it keeps the room of its longest message
  at the width it has.

## The state format

`DeliveryState` is stored by hosts. [delivery.md](docs/runtime/delivery.md#state-across-releases) states the rule for users.

- A new optional field leaves `STATE_VERSION` as it is, with a test that a state without it still reads and advances as before.
- At 1.0 only version 1 exists, so the reader has no upgrade step. The first bump widens `stateSchema` in `state-json.ts` to accept
  the version it replaces, adds the step that maps that state to the new one, and adds a fixture of its own beside
  `test/fixtures/state-1.json`. A fixture is never written again.
- The test `a state that an earlier release wrote` in `delivery.corpus.test.ts` reads each fixture and compares every step with a
  replay from the seed.

## Browser baseline

[baseline.md](docs/player/baseline.md) names the browsers, and `pnpm compat:baseline` holds the shared and browser folders of the player, and
the runtime but its `node` and `cli`, which the player loads in a page, to them. Do not guard a feature that a baseline browser lacks with a support check: the code would be dead in some browsers and
untested in the others.

## Repeats left on purpose

`pnpm check:duplication` runs jscpd over `packages/*/src` with `--min-tokens 40 --min-lines 4`, the settings of the three
repositories, and compares the clones with the table below: it fails on a clone whose files no one row holds together, and on
a file of a row that no longer repeats anything. A new clone is merged into a helper of the module that owns the concept, or
listed here with its reason. A file is written `<package>/<path below src>`, and `{a,b}` stands for several files of a folder.
A row that says "candidate" is a repeat that a helper would remove, in a part of the player whose change needs the browser
tests of every engine, and waits for the next change to that part.

| Repeat                                        | Where                                                                                                                 | Why it stays                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The table of the elements of the ASI schema   | `runtime/asi/element-table.ts`                                                                                        | Generated by `pnpm asi-table` from the schema, which repeats its attribute groups and types; the file is never edited.                               |
| The primitives of a value                     | `player/player/elements/values.ts`, `runtime/interactions/response-check.ts`                                          | Six lines in two packages; the runtime keeps its function private to the check of responses, and exporting it is a change to the public API.         |
| Chunks joined into one array                  | `player/cat-rest/body.ts`, `runtime/package/zip-reader.ts`                                                            | Five lines in two packages; the player imports the runtime's published subpaths only, and a helper of bytes is not part of its API.                  |
| The listeners of a session                    | `player/client/local/session.ts`, `player/client/remote.ts`                                                           | The local and the remote session are subpaths of their own so that a page loads one; the three lines are all that they share.                        |
| The object a mount returns                    | `player/player/delivery/mount.ts`, `player/player/delivery/mount-item.ts`                                             | `update`, `settled` and `destroy` of two mounts, which differ in the ticker that one of them runs.                                                   |
| `reserve` and `fill` of the host's files      | `player/player/delivery/options.ts`, `player/player/elements/options.ts`                                              | `MountFiles` is what a host passes to mount, with signals; `InteractionFiles` is what an interaction uses of it. Candidate: one base interface.      |
| An element builder for two namespaces         | `player/player/dom.ts`                                                                                                | `html` and `svg` set the attributes and append the children of an element of HTML or of SVG, which `createElementNS` and `createElement` tell apart. |
| The imports that open sibling elements        | `player/player/elements/{associate,order,choice,hottext,gap-match,graphic-gap-match,position-object,select-point}.ts` | Lists of imports of files that use the same helpers.                                                                                                 |
| The imports that open two readers of metadata | `runtime/metadata/{access-for-all,curriculum-standards}.ts`                                                           | Lists of imports of two files that read an element with the same helpers.                                                                            |
| The layout of a board element                 | `player/player/elements/{associate,gap-match,graphic-gap-match,order}.ts`                                             | Each element names its own sources, places, tokens and pool for the layout that `BoardElement` reads; the shape is the base class's, the values not. |
| The change of a set of points                 | `player/player/elements/{position-object,select-point}.ts`                                                            | Candidate: a method of `InteractionElement`, which every other element would then carry for two.                                                     |
| The four arrow keys                           | `player/player/elements/graphic/picker.ts`, `player/player/tools/placed-tool.ts`                                      | Candidate: one constant of `player/internal.ts`.                                                                                                     |
| The optional fields of an outcome variable    | `runtime/cat/result-json-read.ts`, `runtime/delivery/results-assembly.ts`                                             | One reads them from JSON and the other from the engine's variables, to the same model; the shape of the model is the repeat.                         |
| The checks that open a function of a session  | `runtime/delivery/item-lifecycle.ts`                                                                                  | `presentItem` and `closeItem` check the session, the time and the context alike before they switch on the status.                                    |
| The settling of closed items                  | `runtime/delivery/{step-time,step-walk}.ts`                                                                           | The loop body of two walks over the items of a step, which choose the items differently.                                                             |
| The checks that open a test                   | `runtime/delivery/structure.ts`, `runtime/validate/validate-test.ts`                                                  | The same arguments, checked at the entry of two public functions, as the entry of each checks its own.                                               |
| The standard templates of response processing | `runtime/processing/standard-templates.ts`                                                                            | `map_response` and `CC2_map_response` are two templates of the specification that have the same rule.                                                |
| The readers of two reports                    | `runtime/results/{read-results,value-elements}.ts`, `runtime/usage/read-usage-data.ts`                                | Three converters of a text and the reading of a field of a value, in two modules that must not import each other.                                    |
| The rule sets that a validation visits        | `runtime/validate/{item,test}.ts`                                                                                     | The order of the visitors that a walk of an item and of a test call, the same list for two documents.                                                |

## Comments and docs

- A TSDoc comment starts with one sentence: a noun phrase for a type or a constant, a third-person verb phrase for a function
  ("Returns ..."), a short phrase for a property.
- A code sample in a guide is complete: it shows its imports and holds no TypeScript syntax, so that it runs as it is. It gives its
  result as `// => result`, and `runGuideSamples` of `scripts/guide-samples.ts`, the one runner of both packages, runs the samples in
  the test file of the module and fails on a result that differs, or on a result that no statement picked up. It takes the text of
  the guide: a test in Node reads the file, and the guides of the player that run in a page are imported with `?raw`, in
  `guides.browser.test.ts`.
- Each guide has the diagram, a Quick start that runs, the options with their defaults, the limits with their values, the errors
  with what to do about them, what is not included and why, and the differences from the references, or `None` and the reason.
  Not included is the table `| Not included | Why |`. `pnpm check:standards` fails on a guide without these sections; the documents of
  `docs/<package>/` that are not the guide of a module (architecture, baseline, choosing, conformance, conventions, evidence, performance,
  size, spec gaps and supported) are listed in `NOT_GUIDES` of `scripts/check-standards.ts`.
- What a call throws goes into a table of errors, not into a sample.
- The main function of each subpath has an `@example` in its TSDoc, after the other tags: a fenced `ts` block as complete as a
  guide's sample, with its imports and its results as `// => result`, short, and taken from the guide of the module where the
  guide has one. `pnpm check:standards` fails (`module-example`) on a subpath of a `package.json` whose entry exports functions
  and none has an `@example`, through the modules it re-exports; an entry that exports none, such as `errors`, is left out. The
  `tsdoc.test.ts` of each package runs the examples of its `src` with `examplesIn` and `runExample` of
  `scripts/tsdoc-examples.ts`, and fails on an example that shows no result or a result that differs; in Node,
  `scripts/tsdoc-sources.ts` reads the sources and loads the packages of the repository from their sources and not a build.
- Every package has a Supported, an Evidence and a Choosing page in `docs/<package>/` (`evidence-page`). A count on them is a number of
  a file of the repository or of `pnpm exec vitest list`, stated with the commit and the date of the count, and a statement of
  what another library has is dated and linked, with what the package lacks of it. The Choosing pages are written from
  `assesskit-comparators.md` of the workspace, re-checked against the guides: a comparator's status is its own text of that
  date, never a test result of ours, and a claim word is never used for a certification, which only 1EdTech grants.
- The Quick start of `packages/player/README.md` runs in `protocol.test.ts`.
- One purpose for each document: `README.md` for users, `docs/<package>/` for guides, `CONTRIBUTING.md` for the process,
  `AGENTS.md` for conventions, `SECURITY.md` for deployment security, `validation/README.md` for the fixture scripts.
- The README of a package is its npm page: it opens with its description as its first sentence and the install line, and has
  the sections `## Quick start`, `## Architecture`, with its diagram, since npm shows a diagram as its source, `## API`,
  `## Supported`, `## Documentation` and `## License`; the root README opens with the family's sentence and has
  `## Which package`, with each package's description, `## Documentation`, `## Development`, `## Layout` and `## License`, in
  that order (`readme-sections`). The root README and the README of each package link absolutely: a guide or a package at its
  page on the docs site, any other file at its address in the repository.
- The docs site is TypeDoc with the plugin `docs/typedoc-seo.ts` and the `structure-dir` router, whose paths never change once
  the site is indexed. Each guide has a title that names its subject (the H1 of its file), and the plugin writes the title of
  its page as `<H1> · <package> (<label>)`, a description from its first paragraph and a canonical URL that the sitemap lists;
  `llms.txt`, `robots.txt`, `CNAME`, `404.html` and the Markdown copies are generated, never written by hand. The API pages are
  named by the import path of their module (`@module @assesskit/runtime/asi`). `pnpm check:site` fails when two URLs of the site differ only by case, which a case-insensitive disk and a search engine
  take as one.
- `scripts/family.ts` holds the identity of the family: `SITE`, the base of the docs site (`https://assesskit.wakan.dev/`, the
  owner's domain), the family's sentence, each package's description, label and keywords, and the marks of others with their
  holders. A package's `description`, `keywords`, `homepage` and `author` and the first sentence of its README come from its
  row, and `scripts/check-identity.ts` holds them to it in `pnpm check:standards`; change a sentence in `family.ts` first.
- Marks of others are named nominatively (`STANDARDS.md` section 2, "Names"): the plain name, and no claim word (compliant,
  conformant, certified, official, approved, endorsed) in a README, a NOTICE, a guide or a description; a quotation stays in
  quotation marks, and a name in code stays in code (`OfficialResult`). The marks are 1EdTech's (QTI, LTI, Caliper and the
  others `family.ts` lists); W3C's Recommendations (WCAG, MathML) and IEEE's metadata (LOM) carry their body's line; Moodle,
  MathLive, Hanzi Writer and the other products a text names are named plainly, with no line. Every README and NOTICE that names
  a mark or a body carries, each on a line of its own, the line of each mark, the body's own line and the line that assesskit is
  not affiliated with the bodies, as `linesFor` of `scripts/identity.ts` writes them; the symbol of a mark appears only inside
  those lines. `pnpm check:standards` names any line that is missing or not needed.

## Evidence and tests

| File                       | Runs with           | Holds                                                                                                                                              |
| -------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*.test.ts`                | `pnpm test`         | Behavior in Node; one file for each source folder, named after it                                                                                  |
| `*.corpus.test.ts`         | `pnpm test:corpus`  | Tests that read the corpus, in Node                                                                                                                |
| `*.browser.test.ts`        | `pnpm test:browser` | Tests in the three engines                                                                                                                         |
| `*.browser.corpus.test.ts` | `pnpm test:corpus`  | The corpus in a browser                                                                                                                            |
| `*.xsd.test.ts`            | `pnpm test:xsd`     | Tests that read the official XSDs; every writer test passes its output to `validateXmlFiles` of `node` with a `SchemaSet` that the file loads once |
| `*.bench.ts`               | `pnpm bench`        | Benchmarks that fail above their budget in `test/budgets.ts` or `test/mount-budgets.ts` ([performance.md](docs/runtime/performance.md))            |

- A module has its coverage floors as soon as it exists: `vitest.config.ts` lists the folders and the files of each `src`, and a module that falls under the floor of its package for statements, functions or lines fails on its own, however high the average of the package is. Branches are held for the package as a whole: V8 counts the fallback of an indexed read, `a[i] ?? 0`, as a branch that no test can take, and the refusals that matter are held by the mutation rules.
- `scripts/test/root-types.test.ts` emits the declarations of each package that depends on another of the family, follows every type
  that a public declaration names, and holds the root of the package to exactly the names of those packages that it finds: a type
  that enters a signature is exported from the root, and nothing else of them is.
- Tests derive what to cover from the schemas, the element table and the runtime's descriptors, never from a list that the
  repository keeps ([evidence.md](docs/runtime/evidence.md#completeness)).
- A file's `describe` blocks follow the order of the folder's source files, with a closing `properties` block; within a block,
  the comparisons with the oracle and the main behavior come first, then the options, then errors and edge cases.
- Every public function has a test of input of other types, as JavaScript or JSON pass it: `null` options and arguments, a string
  for a number, an object for an array. Such input comes from `JSON.parse`, not from a cast.
- Properties that hold for any input are tested with fast-check, and its generators are in `test/arbitraries/`, a file for each module.
- Peak memory is pinned in a process of its own, never in the test runner's: `scripts/test/peak-memory.test.ts` runs each
  reader of untrusted input on its worst input within its limits in a Node.js process whose heap is twice the least heap in
  which it ended on Node.js 22, 24 and 26, so a regression fails the reading and the load of the machine cannot. `node
  scripts/peak-memory.ts [name...]` finds the least heap. The inputs are made in the process outside the heap, in
  `scripts/peak-memory-readings.ts`, from the default limits, so that a new default changes them. The worst input of the XML
  readers is the one of most nodes and attributes that the limits allow, not the longest. The budget is 256 MiB of heap, and a
  default that puts a reader above it is lowered. The bytes of a file that `file` inflates lie outside the heap, so its case
  (`packageEntry`) also bounds the resident memory that the reading raises (`riseMiB`), as do the readings of a ZIP file, which the
  reading writes as a sparse file of the length that a package may have (`packageFile`, `packageDirectory`).
- A benchmark against a reference runs the two sides in turns on the same input, doing the same work to the same point, and
  gates the ratio; in the runtime it is `compareRow` of `test/budgets.ts`, which also gates the time.
- A test reads a JSON fixture with `readFixture<T>` of `packages/runtime/test/fixtures.ts` and declares `T` for the fields it
  reads; a type that several files use goes in `fixtures.ts`. It never imports a JSON file: the type checker builds a type
  for every element, and `pnpm lint` fails on the import in `packages/*/test`, benchmarks included. `resolveJsonModule` is off in
  `tsconfig.base.json`, so `tsc` refuses the import as well; the one JSON file that `src` imports, `src/node/schema-files.json`, has its type
  in `schema-files.d.json.ts` (`allowArbitraryExtensions`), and only `tsconfig.build.json` turns the option on, to copy the file to `dist`.
- Fuzz tests of readers use `FUZZ` of `test/fuzz.ts`: a fixed seed and a bounded number of runs, so that CI runs the inputs a laptop
  does. A reader of documents is tested with `fuzzReader`, which mutates valid documents (`mutations` of `test/arbitraries/xml.ts`)
  and accepts a result, a `ReadError` or a `SecurityError`, nothing else.
- A browser test waits for a condition with `waitFor` of `test/wait.ts`, never with `vi.waitFor`, whose limit of one second a busy
  host does not meet; for media it waits for the events of the recording and moves the timers by hand, never for a time.
- A browser test that records waits with `heardFor` of `test/audio.ts` until the audio contexts have played the seconds it needs,
  never for real time: a busy host stalls the clock of a context, and the recording holds a header and no sound. The fake
  microphone presses a button first, because WebKit keeps an audio context suspended without a recent gesture.

## Where things go

- A reader of untrusted input or a limit: the worst input within it as a reading of `scripts/peak-memory-readings.ts`, its case in
  `scripts/test/peak-memory.test.ts`, its row in the table of [SECURITY.md](SECURITY.md#default-limits) and its rule in
  `scripts/rules/`. `pnpm check:standards` fails on a limit that SECURITY.md does not name: the `limit` of a `SecurityError`,
  a key of an exported `*_LIMITS` object and a property of an exported `*Limits` interface. A reader of JSON takes its size limit, and its refusal of the three reserved names at any depth, from `checkJsonInput`. A reader that reads only what the engine wrote, from
  the host's own store or server, has no limit of size: SECURITY.md says so in **Readers of trusted input**, and its TSDoc.
- A construct of the specifications: its test, and a line of `supported.md` of the package when what is supported changes.
- A test that a row of [conformance.md](docs/runtime/conformance.md) cites: that row changes with it, and `scripts/test/conformance.test.ts`
  fails until it does. A row says `Implements` only for what the guide and the test show; the docs say "implements", never "certified".
- A runtime module: a folder in `src/` with `index.ts`, a subpath in `package.json` `exports` with its budget in
  `packages/player/test/size-budgets.ts`, `export *` in `src/index.ts` unless it is `node` or `cli`, a test file, a guide in
  `docs/`, import rules in `biome.json`, its row in the table of [architecture.md](docs/runtime/architecture.md#layers) and in the
  API table of `packages/runtime/README.md`. `node` and `cli` also get an entry point in `packages/runtime/typedoc.json`.
- A player folder: its row in the table of [architecture.md](docs/player/architecture.md#layers), its Biome overrides and its entry in
  `lint.test.ts`, a subpath in `package.json` `exports` with its budget in `test/size-budgets.ts` and in `typedoc.json` when the host
  imports it, a test file and a guide in `docs/`.
- A custom interaction: a folder in `packages/custom-interactions/src/` with `module.ts`, its type identifier in
  `PCI_TYPE_IDENTIFIERS`, its entry in `MODULES` of `scripts/build-modules.ts` and its budget in `test/size-budgets.ts`, its rules
  in `scripts/rules/custom-interactions.ts`, a guide in `docs/custom-interactions/`, a browser test in the player's frame and
  its items in `items.xsd.test.ts`.
- A check shared by modules: of a value of a JavaScript type in `checks.ts` when the player uses it, else in `checks-internal.ts`; of a value that a module defines, in the `internal.ts` of
  that module.
- A place where the specifications contradict themselves or are silent: as CONTRIBUTING says, and a mention in the guide of the module.
- Something the runtime defines because QTI does not: [conventions.md](docs/runtime/conventions.md), built from QTI's own elements
  so that documents stay valid.
