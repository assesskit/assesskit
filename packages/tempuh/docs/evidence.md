# Evidence

`conformance/tempuh-inventory.json` lists every duty of the player and every success criterion of WCAG 2.2 at levels A and
AA, with the evidence that proves it and the build unit that completes it.

## Rows

A row has an identifier `T1` to `T122`, the duty, the olah rows it implements (`olah`: identifiers or ranges such as
`J4–J6`, which must exist in `olah-inventory.json`), the folders that implement it, its evidence and its unit. A duty that
the host owns or that is not supported has an `owner` in place of folders, evidence and unit.

| Code | Evidence                                                                                    |
| ---- | ------------------------------------------------------------------------------------------- |
| R    | Rendering test in Vitest browser mode on Chromium, Firefox and WebKit (`pnpm test:browser`) |
| A    | axe-core at WCAG 2.2 A and AA, a keyboard-only script, and the manual checks of the matrix  |
| E    | Playwright end-to-end flow on three engines                                                 |
| X    | A 1EdTech sample renders, accepts input and logs no error                                   |
| U    | Unit test, in Node or the browser                                                           |
| F    | Fake service that records HTTP, compared with the cited payloads                            |
| P    | Property of the behavior, checked by fast-check                                             |
| L    | Live check by a person                                                                      |

## Criteria

A criterion has its number (`1.4.3`), name, level, tempuh's part, the evidence the design names and its unit. A criterion
has one of three kinds:

| Kind           | Fields              | Gate                                                    |
| -------------- | ------------------- | ------------------------------------------------------- |
| Tested         | `unit`              | A test names it as `[SC 1.4.3]` once the unit is merged |
| Manual         | `unit` and `manual` | The named manual check by a person; no test is required |
| Not applicable | `notApplicable`     | The reason; no unit and no test                         |

## Tests in a browser

The browser tests use fixtures in `test/fixtures/`. The global setup `global-setup.ts` builds the files of the frame and
starts three servers on free ports: the asset origin, a second origin that a test may allow, and a stranger that nothing
may reach. A test asks a server for the paths it was requested for at `/__hits`, and the browsers of a run share the
servers, so each test names its paths with a token of its own. The asset origin also serves MathJax and its fonts from
the `mathjax` package under `/mathjax/`, and validates SSML: a test posts a document to `/validate/ssml` and gets the
issues that the SSML 1.1 schema finds, as JSON. That needs the schemas, so run `pnpm schemas` and `pnpm corpus` before
`pnpm test:browser`. Without them the tests that validate SSML fail with the reason that the server gave (status 500). A
server of the fixtures that fails answers with the reason and never throws, because Vitest cannot print an error that
escapes it. The browser commands in `commands.ts` give a test what a page cannot do: run axe-core inside a frame of an
opaque origin, click in it, read the accessibility tree with its frames, and read the XML and CSS files of the 1EdTech
examples (`corpusFiles`, which needs `pnpm corpus`). The asset origin also serves the package files of the content
renderer from `test/fixtures/content/` under `/content/<token>/`. `test/content-fixture.ts` mounts content written as
XML, with SSML and MathML in their namespaces, in a content root. The 1EdTech examples that run in the frame are tests
of their own, `*.browser.corpus.test.ts`: `pnpm corpus` downloads the examples, and `pnpm test:corpus` runs them in the
three engines. The global setup serves the package of an example under `/c/<token>/<example>/`, as the asset gate would,
and the `pci-fixture.ts` helpers mount an interaction as the player does.

MathJax is a global of the page and a failure to load it is final, so a test that needs a page without MathJax, or with a
failure, has a file of its own (`math-failure` and `math-wrong-script`). A test file runs in a page of its own.

The tests of the content renderer read items with olah's `readAsi` and render their nodes in a content root of `css-fixture.ts`
(`renderer-fixture.ts`), so that the nodes are the ones the engine gives. `content.corpus.browser.test.ts` renders every item and
stimulus of the examples, adopts every stylesheet they reference and opens every modal feedback, and compares the HTML elements
of each body with the XML it came from. The hostile cases are markup that olah's reader accepts, nodes that only a forged view
could carry, and stylesheets with every way to load a resource; the asset server's record of requests shows that the
browser asked no other origin.

The browser tests of the tools build their page in the test: the toolbar in the document and the item in a shadow root, as
the player lays them out. `tools-fixture.ts` reads the companion materials of BPIG §3.7.8 with olah's `readAsi`, so that the
tools get what the player gets. The tests run axe-core with the rules of WCAG 2.2 A and AA and `label-content-name-mismatch`,
which axe leaves off by default, and press real keys and pointer buttons.

The smoke test of the pinned old browsers (`pnpm compat:engines`) also runs a portable custom interaction in its frame, and
operates the tools by keyboard.

Where the Firefox of Playwright does not start, such as on macOS 27, run the suite in a Linux container from the root of the
repository. The container needs network access to install the dependencies and the browsers:

```bash
docker run --rm --ipc=host --volume "$PWD":/src:ro mcr.microsoft.com/playwright:v1.63.0-noble bash -c '
  mkdir /work && tar -C /src --exclude=node_modules --exclude=.git --exclude=dist --exclude=.cache -cf - . | tar -C /work -xf - &&
  cd /work && npm install --global pnpm@12.8.1 && pnpm install --frozen-lockfile --ignore-scripts &&
  pnpm schemas && pnpm exec playwright install chromium firefox webkit &&
  pnpm schemas && pnpm corpus && pnpm test:browser && pnpm test:corpus'
```

## Tests name their rows and criteria

A title names what it evidences in brackets, as a string literal: `it("[T97] chooses the catalog of the language")` or
`it("[SC 3.2.4] gives each function one key")`. A title may name several, such as `[T97][SC 3.2.4]`. Skipped and todo tests
do not count. tempuh's tests are the files `*.test.ts` in `packages/tempuh/test/`, and those named `*.browser.test.ts`
run in the browsers with `pnpm test:browser`, after `pnpm exec playwright install`. An identifier is checked against the
inventory of its own package, so `[T1]` in tempuh is not olah's `T1`.

## The coverage gate

`pnpm conformance` fails when

- a row of a merged unit has no test;
- a criterion of a merged unit that is neither manual nor inapplicable has no test;
- a test names a row or a criterion that the inventory does not have.

A unit adds itself to `merged` in the commit that completes it, which makes its rows and criteria need tests from then on.
Rows and criteria of units that are not merged need no test yet.
