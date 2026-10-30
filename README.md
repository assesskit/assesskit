# olah

A QTI 3.0 runtime for JavaScript and TypeScript, and the player built on it. This repository holds two packages:

| Package                               | What it is                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`olah`](packages/olah/README.md)     | Reads, writes, validates and executes everything in QTI 3.0 that is not presentation or platform, with a headless delivery engine that serves exams on a server or practice on a device. |
| [`tempuh`](packages/tempuh/README.md) | The player: rendering, the PCI host, accessibility in the UI and the server-side integrations. It uses olah only through its published subpaths. Placeholder until its design is built.  |

olah is not certified by 1EdTech. [Conformance](packages/olah/docs/conformance.md) states how every construct of the
specifications is evidenced.

## Development

Node.js 22.18+ and pnpm 12 are required.

```bash
pnpm install
pnpm lint            # Biome and cspell
pnpm typecheck       # every package, and the tooling at the root
pnpm test            # Vitest; runs offline
pnpm knip            # unused files, exports and dependencies
pnpm conformance     # every row of a merged unit has a test; the matrix is current
pnpm docs:api        # TypeDoc into docs/api; fails on undocumented exports
pnpm corpus          # downloads the 1EdTech examples and the W3C regular expression suite
pnpm test:corpus     # tests that read the corpus
pnpm unicode         # regenerates the Unicode tables of the regular expressions
```

[AGENTS.md](AGENTS.md) states the conventions, [CONTRIBUTING.md](CONTRIBUTING.md) the process and
[SECURITY.md](SECURITY.md) how to report a vulnerability.

## Layout

```
packages/olah/    the library; docs/ holds its guides
packages/tempuh/  the player
differential/     private package: olah against Longsight qti3-core
conformance/      the inventory of every construct, the certification features, the corpus pins, the coverage check
scripts/          corpus download, Unicode table generator
validation/       Python scripts that write the printf and rounding fixtures
biome/            GritQL lint rules
```

## License

[Apache License 2.0](LICENSE).
