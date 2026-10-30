# olah

A QTI 3.0 runtime for JavaScript and TypeScript, and the player built on it. This repository holds two packages:

| Package                               | What it is                                                                                                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`olah`](packages/olah/README.md)     | Reads, writes, validates and executes everything in QTI 3.0 that is not presentation or platform, with a headless delivery engine that serves exams on a server and practice on a device.                                                                                               |
| [`tempuh`](packages/tempuh/README.md) | The player: rendering, the host of portable custom interactions, accessibility applied in the interface and the server-side integrations. It uses olah only through its published subpaths. Under development and not yet published; its README says what the current version contains. |

olah is not certified by 1EdTech. [Conformance](packages/olah/docs/conformance.md) states how every construct of the
specifications is evidenced, and the claim is scoped: items differentially tested; test sessions specification-tested.

## How the two packages split

olah owns what QTI defines that is not presentation or platform: the documents, packages and results, validation, processing,
and the rules of a test session. tempuh owns presentation and the platform. tempuh never evaluates an expression, decides what
is visible or valid, chooses a variant, or holds an answer key outside olah's solution view.

| Concern                                                                | olah                                | tempuh                                       |
| ---------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| Reading, writing and validating content, packages, results, usage data | yes                                 | uses                                         |
| Response, template and outcome processing                              | yes                                 |                                              |
| Navigation, submission, time limits, attempts, variants                | the engine                          | applies it on a device, hosts it on a server |
| Rendering, MathML, stylesheets, accessibility in the interface         |                                     | yes                                          |
| Portable custom interactions                                           | the data, the codec and the state   | loading and API                              |
| The candidate view, without answer keys                                | builds it                           | transports and shows it                      |
| External scoring, computer adaptive testing                            | requests, covers, scorer view, port | scorer interface, adapters to engines        |
| LTI 1.3 with grade services, Caliper                                   | results and events                  | yes                                          |
| The validator command line                                             | yes                                 |                                              |

The two meet in JSON: views, actions and state, with values in a self-describing form, so nothing needs a declaration to be
decoded. On a server, tempuh hosts olah's engine: clients hold only views and send actions, and the answer keys and the seed
never leave. For practice, the engine runs in the browser. [Architecture](packages/olah/docs/architecture.md#boundary-with-tempuh)
has the full list of who owns what, and [Delivery](packages/olah/docs/delivery.md#modes) the two modes.

To read, validate, process or run QTI content in your own code or pipeline, use olah. To deliver tests to candidates in a
browser, use tempuh, which depends on olah.

## Development

Node.js 22.18+ and pnpm 12 are required.

```bash
pnpm install
pnpm lint               # Biome and cspell
pnpm typecheck          # every package, and the tooling at the root
pnpm test               # Vitest; runs offline
pnpm test:browser       # the tests of tempuh that need a browser; run pnpm exec playwright install first
pnpm knip               # unused files, exports and dependencies
pnpm conformance        # every row of a merged unit has a test; the matrix is current
pnpm build              # the built packages
pnpm check:packages     # publint and Are the Types Wrong on the packed packages
pnpm compat             # the built code of tempuh stays inside its browser baseline; run pnpm build first
pnpm compat:engines     # the smoke test in the pinned old browsers, in Docker; run pnpm build first
pnpm docs:api           # TypeDoc into docs/api; fails on undocumented exports
pnpm corpus             # downloads the 1EdTech examples and the W3C regular expression suite
pnpm test:corpus        # tests that read the corpus
pnpm test:differential  # olah against Longsight qti3-core on items; run pnpm corpus first
pnpm unicode            # regenerates the Unicode tables of the regular expressions
pnpm schemas            # downloads the official XSDs (about 140 MB) into .cache/schemas
pnpm test:xsd           # tests that validate against the XSDs
pnpm bench              # the benchmarks of olah against their budgets
```

[AGENTS.md](AGENTS.md) states the conventions, [CONTRIBUTING.md](CONTRIBUTING.md) the process and
[SECURITY.md](SECURITY.md) how to report a vulnerability and how to deploy safely.

## Layout

```
packages/olah/    the library; docs/ holds its guides
packages/tempuh/  the player; docs/ holds its guides
differential/     private package: olah against Longsight qti3-core
compat/           private packages: the browser baseline of tempuh, its lint and the pinned old browsers
conformance/      the inventories of olah and tempuh, the certification features, the corpus pins, the coverage check
scripts/          corpus and schema downloads, Unicode table generator
validation/       Python scripts that write the printf and rounding fixtures
biome/            GritQL lint rules
```

## License

[Apache License 2.0](LICENSE). QTI and 1EdTech are trademarks of 1EdTech Consortium, Inc.; see the NOTICE of each package.
