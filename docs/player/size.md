# Size

What a browser loads from the player, and the budgets that keep it from growing. `packages/player/test/size.test.ts` bundles
each entry point as a host's bundler does (esbuild, minified, for the browsers of the [baseline](baseline.md)), and fails when a
file is above its budget after gzip.

```mermaid
xychart-beta
  title "Entry points after gzip, in kilobytes"
  x-axis ["root", "protocol", "client", "player", "mountItem", "engine (on demand)"]
  y-axis "kB" 0 --> 140
  bar [11.9, 7.1, 21.4, 123.6, 87.6, 125.2]
```

| File                          | Bytes   | Gzip    | Budget  | What it holds                                                                                                                 |
| ----------------------------- | ------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@assesskit/player`           | 36,737  | 11,874  | 14,500  | The errors, the checks of the player, valibot, and the interface messages in English and Indonesian                           |
| `@assesskit/player/protocol`  | 22,112  | 7,067   | 7,500   | The envelopes and their schemas, and the check of a scoring rubric; valibot is 10.9 kB of it                                  |
| `@assesskit/player/client`    | 66,539  | 21,407  | 25,000  | The remote and the local session, and the decoders of a view and of an action that they take from the runtime                 |
| `@assesskit/player/player`    | 386,277 | 123,577 | 140,500 | The custom elements, the tools, the delivery, the supports, speech, the rating form, the host of portable custom interactions |
| `mountItem`                   | 271,245 | 87,568  | 107,500 | The content, the interactions, the supports, speech and the host of portable custom interactions; no chrome and no tools      |
| `@assesskit/runtime/delivery` | 529,076 | 125,213 | 152,000 | The engine, which `createLocalSession` loads with `import()` for practice on a device                                         |
| `pci-frame/bridge.js`         | 10,026  | 3,735   | 5,000   | The script of the frame of a portable custom interaction                                                                      |
| `pci-frame/require.js`        | 17,781  | 6,863   | 9,000   | RequireJS, which the frame loads                                                                                              |
| `recorder-worklet.js`         | 322     | 270     | 500     | The script of the audio worklet of a WAV recording                                                                            |
| `player.css`                  | 61,800  | 12,993  | 16,000  | The stylesheet of a content root                                                                                              |

The sizes are bytes of the minified file. The first load of a client holds none of the engine: the engine is a chunk that
the client loads on demand, and the test fails when the first load holds a file of the runtime's processing. The entry points of
the shared folders `scoring` and `cat` and of the server side (`cat-rest`, `server`) have no budget, as none
of the entry points above loads them; the root, the protocol and the client hold no `jose` or XML parser, and the
player holds no `jose`.

`mountItem` is `mountDelivery` without the chrome, the tools, the panel of the supports and the frame of an LTI item, so it
loads the content and the interactions that every mount shares. `bundle.test.ts` fails when a file of the chrome is in a bundle
that imports only `mountItem`, and `size.test.ts` fails when it is not smaller than a bundle of `mountDelivery`. The XML parser
that reads a pronunciation lexicon (`saxes` and the runtime's `xml`, 40 kB of the player) is a chunk that loads with the
first lexicon, so neither `mountItem` nor `mountDelivery` holds it in the first load; the `player` entry point holds it, because it
exports `parseLexicon`.

## What is in the player

| Part                                             | Bytes   | Why                                                                                              |
| ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------ |
| The elements of the player                       | 233,720 | The folders of `player/`, of which `elements` is 74 kB and `tools` 39 kB                         |
| `values` of the runtime                          | 40,761  | The values of responses, and the automaton and the Unicode tables for the patterns of text entry |
| The messages                                     | 27,400  | Both catalogs; `selectMessages` chooses one at run time                                          |
| `saxes`, and `xml` and `xmlchars` of the runtime | 40,317  | The reader of a pronunciation lexicon in `speech/`                                               |
| valibot                                          | 11,350  | The schemas of the JSON that crosses the wire                                                    |

## Running it

`pnpm test` runs the size test with the other tests of the player, and needs no build. A budget is 1.25 times the size
measured, rounded up to the next 500 bytes, and changes only with the reason in the commit that changes it. The static files
are built by `scripts/build-static.ts`, which the test calls, so it measures what `pnpm build` writes.

## Mount time

`pnpm bench` also times the mounts in Chromium with the CPU slowed 4 times through the DevTools protocol, as a mid-range
phone is, and fails when the fastest of 5 samples is above its budget. The files are `mount-time.browser.bench.ts` and
`mount-budgets.ts` in `packages/player/test/`; the browser pane of the run is the Chromium of Playwright.

| Mount                                                      | On the CI runner | On a laptop | Budget |
| ---------------------------------------------------------- | ---------------- | ----------- | ------ |
| `mountDelivery` over a test, until the first item is shown | 30 ms            | 5 ms        | 200 ms |
| 10 calls of `mountItem` on one page, until all are shown   | 73 ms            | 16 ms       | 400 ms |
| Turning on the highlighter over a passage of 2,000 words   | 48 ms            | 14 ms       | 300 ms |

A budget is five times the fastest sample, the median over three runs, rounded up to one significant digit: the rule of the
other benchmarks of the repository ([performance](../runtime/performance.md#budgets)), whose sample is the one that the CI
runner took, because the gate runs there. The runner takes 4 to 6 times as long as a laptop, and one run of it takes up to 1.4
times as long as another on the same code (`mountDelivery` 23.9, 30.1 and 33.2 ms), so a budget of five times the sample of a
laptop fails on the runner with no change in the code. A mount must become several times slower on the runner before it fails
its budget; the sizes above guard the load.

The times do not include loading and parsing the bundle, which `size.test.ts` bounds by bytes: with the CPU slowed 4 times
the bundle of `mountDelivery` loaded, parsed and evaluated in 47 ms, and that of `mountItem` in 46 ms.
