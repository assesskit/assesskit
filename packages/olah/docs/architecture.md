# Architecture

olah is one package with a subpath per module. These principles hold for every module; Biome enforces the ones marked
lint, and the rest are checked in review.

| Principle              | Rule                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure core              | Every module except `node` and `cli` uses ECMAScript 2023 and no platform API: no `node:*`, `fetch`, timers, `window`, `document` or `process` (lint). It runs in any JavaScript runtime.           |
| Deterministic          | Randomness comes from a `Random` the caller passes, time from an argument the caller passes. `Math.random`, `Date.now()`, `new Date()` and `performance.now()` fail lint.                           |
| No backtracking regexp | `new RegExp` and `RegExp(` fail lint everywhere in `src/`. Patterns that authors write run on olah's linear-time automaton, never on a backtracking engine.                                         |
| No code execution      | No `eval` (lint) and no code loading. Extension points are functions the caller registers.                                                                                                          |
| Untrusted input        | Every input is untrusted: documents, packages, actions, and what resolvers return. Entry points validate deeply; inner functions validate shallowly, so a call does not cost the size of the model. |
| Cited rules            | Every semantic rule cites the specification section that defines it, and every inventory row has a test ([evidence](evidence.md)).                                                                  |

## Layers

A module imports only from lower layers, and imports never form cycles (lint). Every module may import `errors.ts`,
`checks.ts` and `random.ts`; `checks.ts` imports `errors.ts` only, and `random.ts` imports `errors.ts` and `checks.ts`.
`delivery` is the top library layer, and no olah module imports it. `packages/olah` never imports `tempuh`, and
`tempuh` imports olah only through its published subpaths, never by relative path.

| Layer | Modules                                | Imports                                                                                                                    |
| ----- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1     | `errors.ts`, `checks.ts`, `random.ts`  | as above                                                                                                                   |
| 2     | `xml/`, `values/`                      | none                                                                                                                       |
| 3     | `asi/`, `results/`, `usage/`           | `xml/`, `values/`                                                                                                          |
| 3     | `pnp/`                                 | `xml/`                                                                                                                     |
| 4     | `metadata/`                            | `xml/`, `asi/`                                                                                                             |
| 4     | `processing/`, `interactions/`, `pci/` | `values/`, `asi/`                                                                                                          |
| 4     | `content/`                             | `values/`, `asi/`, `pnp/`                                                                                                  |
| 5     | `cat/`                                 | `values/`, `asi/`, `results/`, `metadata/`                                                                                 |
| 5     | `package/`                             | `xml/`, `asi/`, `metadata/`, `usage/`                                                                                      |
| 6     | `validate/`                            | every module of layers 2 to 5                                                                                              |
| 7     | `delivery/`                            | `values/`, `asi/`, `results/`, `pnp/`, `processing/`, `interactions/`, `pci/`, `content/`, `cat/`, `package/`, `validate/` |
| 8     | `node/`                                | `xml/`, `package/`, `validate/`, `node:*`                                                                                  |
| 9     | `cli/`                                 | `node/`, `validate/`, `package/`, `node:*`                                                                                 |

## Subpaths

Each module is a folder of `src/` with an `index.ts` and a subpath of `exports`. The root `.` re-exports every module
except `node`, so the root stays portable. `bin` maps `olah` to the CLI.

## Errors and issues

All errors extend `OlahError`, and their messages are full sentences that say what is wrong and what is expected.

| Class             | Thrown when                                                                                                               | Carries                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `DataError`       | An argument has the wrong type or is out of range, an untrusted action is not an action, or a state has an unknown format | the message               |
| `ReadError`       | A document is not well-formed, not in the expected namespace, or cannot be mapped to the model                            | `issues`                  |
| `SecurityError`   | Input breaks a security rule or a limit: a DOCTYPE, a path escape, a size, depth or ratio above its limit                 | `limit` and `value`       |
| `ProcessingError` | Processing meets a condition the specification does not define as NULL                                                    | `source` and `identifier` |

Validation does not throw. It returns `Issue`s: a severity, a code (`olah/<module>/<name>`, or the identifier of a rule
set in BIND §5), a message, the specification reference that defines the rule and, when known, a location with the file
path, line, column and element path.

## Determinism

`Random` is `{ uniform(): number }`, a structural subset of takar's `Random`, so a takar generator can be passed
wherever olah takes one. `createRandom(seed)` is takar's algorithm, xoshiro128** seeded through the MurmurHash3 finalizer,
with 53-bit uniform draws from integer arithmetic: equal seeds give equal streams in both libraries and in every runtime.
A `SeededRandom` also exposes `state()`, four 32-bit words, and `restoreRandom(state)` continues the sequence from it.

Draw procedures are part of the behavior of a module, are documented there, and changing one is a breaking change.
Collections keep document order, maps keep insertion order, and output never depends on hash order.
