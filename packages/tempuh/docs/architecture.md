# Architecture

tempuh is one package with a subpath per side of the wire. These principles hold for every folder; Biome enforces the
ones marked lint, and the rest are checked in review.

| Principle              | Rule                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thin over olah         | tempuh renders what olah's candidate view says. It evaluates no expression, decides no visibility or validity, chooses no variant and reimplements no codec.                                        |
| No keys in the browser | Browser folders import from `@luthfanwakan/olah/delivery` only `viewFromJson`, `actionToJson` and types (lint). Only `client/local.ts` loads the engine, with `import()`, for practice on a device. |
| Browser baseline       | Shared and browser code stays inside the [baseline](baseline.md) (lint, and `pnpm compat`).                                                                                                         |
| Deterministic          | `Math.random` fails lint. `Date.now`, `new Date()` and `performance.now()` fail lint except in `client/clock.ts` and `server/clock.ts`; time comes from a clock that the caller passes.             |
| No hidden network      | `fetch` appears only as an option parameter (lint), so that a caller can replace it. Only `cat/` imports takar (lint).                                                                              |
| Untrusted input        | Every input is untrusted: envelopes, tokens, payloads and messages. Entry points validate their input and throw `DataError`; inner functions validate shallowly.                                    |
| Cited rules            | Every inventory row and WCAG criterion has a test ([evidence](evidence.md)).                                                                                                                        |

## Layers

A folder imports only the folders in its row, and imports never form cycles (lint). `errors.ts` and `checks.ts` are
below every folder; `checks.ts` imports `errors.ts` only. The lint knows every folder of the table, so a folder is held
to its row from its first file.

| Layer | Folders                                | Side    | Imports                          |
| ----- | -------------------------------------- | ------- | -------------------------------- |
| 1     | `errors.ts`, `checks.ts`, `messages/`  | shared  | none of the folders below        |
| 2     | `protocol/`                            | shared  | layer 1                          |
| 3     | `player/`, `client/`                   | browser | layers 1 and 2                   |
| 3     | `scoring/`, `caliper/`, `cat/`, `lti/` | server  | layers 1 and 2                   |
| 4     | `server/`                              | server  | layers 1 to 3 of the server side |

Shared folders use no DOM, Node.js, timer or network API. Browser folders use the DOM and no Node.js. Server folders use
Node.js or any server runtime, and no DOM. tempuh imports olah by package name and subpath, never by a relative path.

## Subpaths

Each subpath is a folder of `src/` with an `index.ts`, listed in `exports`. The root `.` re-exports the errors and the
messages and nothing of the other subpaths, so that a browser bundle and a server load none of each other's code.

| Subpath      | Side    | Contents                                                                                                                                                           |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.`          | shared  | The errors and the interface messages                                                                                                                              |
| `player`     | browser | The host of portable custom interactions ([PCI](pci.md)), the tools of an item ([tools](tools.md)), mathematics ([math](math.md)) and speech ([speech](speech.md)) |
| `protocol`   | shared  | The caller and the envelopes between a browser and a server                                                                                                        |
| `cat`        | server  | The CAT engines over takar and over the REST binding of CAT 1.0, and their deployment ([CAT](cat.md))                                                              |
| `lti`        | server  | LTI 1.3: the tool role ([lti](lti.md)) and the platform role ([lti-platform](lti-platform.md))                                                                     |
| `player.css` | browser | The stylesheet of a content root ([styling](styling.md)); a file at the package root, not a folder of `src/`                                                       |

The package also exports static files that a host serves: `pci-frame/*`, the frame of a portable custom interaction.
`pnpm build` writes them to `dist/pci-frame/` with `scripts/build-frame.ts`, which bundles `src/player/pci/frame/bridge.ts`
into a classic script with esbuild and copies `frame.html` and RequireJS beside it.

tempuh depends on olah (`workspace:^`), which browser folders import by package name and subpath. The built `dist/` keeps
those imports, so a page loads the player through a bundler, which also resolves olah's own dependencies.

## TypeScript

Five configurations check the package, each with the libraries of its side:

| File                    | Checks                                                                                | `lib` and types                                |
| ----------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `tsconfig.json`         | the tests, their fixtures and `scripts/`                                              | `ES2023`, `DOM`, `DOM.Iterable`, Node.js types |
| `tsconfig.browser.json` | shared and browser folders                                                            | `ES2023`, `DOM`, `DOM.Iterable`                |
| `tsconfig.server.json`  | shared and server folders                                                             | `ES2023`, Node.js types                        |
| `tsconfig.build.json`   | the build of `src/`, which emits `dist/`; the program of the frame is bundled instead | `ES2023`, `DOM`, `DOM.Iterable`, Node.js types |

`ES2023` is the newest library, so that TypeScript rejects built-ins that the baseline browsers lack.

## Errors

All errors extend `TempuhError`, and their messages are full sentences that say what is wrong and what is expected.
olah's errors pass through tempuh unchanged.

| Class          | Thrown when                                                                                                           | Carries             |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `DataError`    | An argument has the wrong type or is out of range, or untrusted input is not what it should be, such as an envelope   | the message         |
| `AccessError`  | A caller acts on a session it is not bound to, starts a session that exists, or presents a login hint that is invalid | `reason`            |
| `LtiError`     | An LTI launch, login or service message fails validation, in either role                                              | `reason`            |
| `ServiceError` | A call to the CAT, AGS, JWKS or Caliper service fails, or a store conflict outlasts its retries                       | `status` and `body` |

`reason` is a kebab-case code such as `session-exists`. A host maps `AccessError` to 403. `status` is `0` when a service did
not answer.
