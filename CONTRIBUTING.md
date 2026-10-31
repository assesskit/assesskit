# Contributing

Contributions in English or Bahasa Indonesia are welcome.
Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Node.js 22.18+ and pnpm 12 are required. `pnpm install` also installs the Lefthook git hooks. [AGENTS.md](AGENTS.md)
lists the commands and the conventions for layout, naming, code, docs and tests;
[architecture.md](packages/runtime/docs/architecture.md) states the design principles.

## Issues

Open a bug report with the document or the sequence of actions that fails, as the smallest code that runs as pasted, and the
section of the specification that defines the behavior you expected. Open a feature request only for something that belongs
to a section of the specifications, an extension point or a runtime convention ([conventions.md](packages/runtime/docs/conventions.md)),
and name it. Report a vulnerability privately, as [SECURITY.md](SECURITY.md) describes.

## Semantics and evidence

A change to semantics cites the specification section in the pull request, updates the inventory row and its test, and
names the row in the test's title ([evidence.md](packages/runtime/docs/evidence.md)). Fixtures come from oracles, never typed by
hand except for edge cases derivable exactly: extend the script in `validation/` and regenerate the fixtures as
[validation/README.md](validation/README.md) describes. Commit the regenerated fixtures; CI runs only the TypeScript
tests. A difference from Longsight `qti3-core` that the specification settles goes into
`conformance/accepted-differences.json` with its reason. A place where the specifications contradict themselves or are silent
is a gap: it gets a row, a resolution in [spec-gaps.md](packages/runtime/docs/spec-gaps.md) and a test, and changing a resolution
is a breaking change.

## Before opening a pull request

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm knip` and `pnpm conformance`, then `pnpm build`,
`pnpm check:packages`, `pnpm compat` and `pnpm docs:api`. A change to the code that runs in a browser also runs
`pnpm test:browser`, which needs the browsers of `pnpm exec playwright install`, the schemas of `pnpm schemas` and the corpus of `pnpm corpus`, and `pnpm compat:engines`, which needs
Docker ([baseline](packages/player/docs/baseline.md)). The tests that read the corpus run with `pnpm corpus` and `pnpm test:corpus` (those of the player also need the browsers of `pnpm exec playwright install`),
the tests that validate against the official XSDs with `pnpm schemas`, `pnpm corpus` and `pnpm test:xsd`, and the comparison with
Longsight `qti3-core` with `pnpm corpus` and `pnpm test:differential`.

CI runs the jobs `xsd`, `corpus`, `differential` and `bench` only when a change touches `packages/runtime/`, the harness
(`conformance/`, `differential/`, `scripts/`, `validation/` and the configuration files at the root) or `.github/workflows/ci.yml`;
the other jobs run on every change.

A change to a package goes into the pending release's changeset in `.changeset/`, or a new one made with
`pnpm changeset` when none is pending ([AGENTS.md](AGENTS.md#releases)).

A change to behavior also changes the TSDoc of what it touches and the guide of the module in `packages/runtime/docs/`. The
matrix `packages/runtime/docs/conformance.md` is generated: run `pnpm conformance:render` and commit the result. The Example of
`packages/runtime/README.md` is the file `packages/runtime/test/readme-example.ts`; change the README and the file together, and
`pnpm test` fails until they agree.

The pre-commit hook formats staged code, JSON, Markdown and YAML with Biome; the pre-push hook runs the type check,
tests, Knip and the coverage check.

## License of contributions

assesskit is licensed under the [Apache License 2.0](LICENSE). As its section 5 states, a contribution you submit for
inclusion is licensed under the same terms, unless you state otherwise. There is no contributor license agreement;
you keep the copyright in your contributions. Do not contribute files you do not have the right to license: the
repository contains no 1EdTech schema, example or test package.
