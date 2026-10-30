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
XML, with SSML and MathML in their namespaces, in a content root.

The browser tests of the interactions ([interactions](interactions.md)) render items written as XML with the renderers
of the interactions in a content root and give the interactions the descriptors of olah's `describeInteractions`
(`interactions-fixture.ts`). The asset origin also serves the worklet of the WAV recording under
`/static/recorder-worklet.js`, and two short tones and a caption file among the package files, for the rules of media.
The tests answer with the mouse, with real key presses and with a stream of an oscillator in place of the microphone;
Safari on macOS leaves form controls out of the tab order unless the person turns that on, so the keyboard tests focus a
control and press its keys. `elements.browser.corpus.test.ts` renders every item of the examples that has one of these
interactions, answers each, and runs axe on it.

The 1EdTech examples that run in the frame are tests of their own, `*.browser.corpus.test.ts`: `pnpm corpus` downloads
the examples, and `pnpm test:corpus` runs them in the three engines. The global setup serves the package of an example
under `/c/<token>/<example>/`, as the asset gate would, and the `pci-fixture.ts` helpers mount an interaction as the
player does.

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
repository. The container needs network access to install the dependencies and the browsers. takar is a dev dependency of
olah and tempuh, linked from `../../../takar/packages/takar`, so the container mounts the `takar` checkout beside the repository
at `/takar`:

```bash
docker run --rm --ipc=host --volume "$PWD":/src:ro --volume "$PWD/../takar":/takar:ro mcr.microsoft.com/playwright:v1.63.0-noble bash -c '
  mkdir /work && tar -C /src --exclude=node_modules --exclude=.git --exclude=dist --exclude=.cache -cf - . | tar -C /work -xf - &&
  cd /work && npm install --global pnpm@12.8.1 && pnpm install --frozen-lockfile --ignore-scripts &&
  pnpm schemas && pnpm exec playwright install chromium firefox webkit &&
  pnpm schemas && pnpm corpus && pnpm test:browser && pnpm test:corpus'
```

## Tests of the shell, the clients and the gate

The tests of `server/` run in Node with an in-memory store, scheduler and file store (`exam-fixture.ts`), a clock that a test
moves and the fixture package of a test of three items with an image, a stylesheet, a portable custom interaction and files
that hide as web content: an item fragment, a response-processing template and a document of QTI data that no resource
declares, under extensions that the gate serves and under `.xml`. Each rule of the gate has a test that fails without it.
The tests of the origin accept `http` on loopback and refuse the names and addresses that only look like it. The gate is also
tested over the 1EdTech examples (`server.corpus.test.ts`, run by `pnpm test:corpus` in the project `tempuh-corpus-node`):
under a token for the whole package, every file of each of the 24 directories and 24 archives is served or refused as an
oracle outside the gate says: the manifest, the main file of every resource of a document type, every file the reader of olah
parses as a document of QTI data, the references of adaptive sections and every file that is not a web asset are `404`; the
other files are `200`.

`bundle.test.ts` bundles the player and the remote session with esbuild and reads the metafile of the output: no file of olah's
engine has code in it, and a bundle that makes a local session has (so the check can see it).

The browser tests of the shell and the clients (`delivery.browser.test.ts`, `client.browser.test.ts`) run a session host in the
page with the wire between them: every envelope goes through JSON. `exam.browser.test.ts` is the end-to-end test: the global
setup `exam-setup.ts` starts an HTTP server (`exam-server.ts`) that runs session hosts and the asset gate, and the tests act as
a candidate through `fetch`. The server takes the authentication from the headers `x-session` and `x-principal`, picks the exam
from `x-exam` and moves its clock by `x-offset`, so that a test makes time pass for its own session only. It covers the
caller binding (403 for another candidate's session and for a second start), the policy that refuses `suspend` (400), the
proctor's suspension, conflict retries (a competing write comes first three times and the request still succeeds, and a
fourth gives 409), a time-out that the scheduler's job applies, the gate's refusals and headers, the token of an upload, and a
portable custom interaction with a relative `define` and a stylesheet with a relative `url()` that load under their prefixes.

## Tests of Caliper

The tests of `caliper/` and of `server/` run in Node with no network. Their oracles are not the code under test.

| Oracle                                        | Used for                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `validation/caliper_ids.py`                   | The name-based UUIDs of Python's `uuid5`, in `test/fixtures/caliper-ids.json`, and the worked example of RFC 9562 A.4. |
| `test/fixtures/caliper-context-v1p2.json`     | The JSON-LD context of Caliper 1.2, as 1EdTech serves it at `http://purl.imsglobal.org/ctx/caliper/v1p2/`.             |
| Caliper 1.2 §3.2, §3.6 and Appendices A and B | The actions, objects and generated entities each event may have, and the properties each entity may have.              |

`caliper-fixture.ts` checks an event against the context: every term is defined by it, every value has the type that the context
coerces its term to, an `@id` value is an absolute IRI, an `@vocab` value is a term, and the properties that §2.1 requires
are there. It checks an envelope for its four properties. `sendCaliper` is tested against a fake endpoint that records the
request, and `forwardEvents` against a log that records its calls. The fixture of the context is a copy of the file that was
served on 2026-10-30 (SHA-256 `8a78d3d0d380e80c03c7507d1e6d0113d8ab2aa2f772f3e1c8442d958d40837d`); a new version of the context is
a new file and a new decision.

## Tests of scoring

The tests of `scoring/` run in Node against olah's engine, and those of the display run in the browsers. Their oracles are not
the code under test.

| Oracle                                                               | Used for                                                                                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| olah's engine: `scorerView`, `pending`, `apply` and `results`        | The scorer view that `toSubmission` reads, and what the engine does with the action of `toSupplyScores`: the events, the pending requests and the results |
| olah's codec, `toWireValue` and `fromWireValue`, and BPIG Appendix C | The form of the values of a submission, which a property test decodes again from JSON text                                                                |
| INFO §4.5.10 and olah's scoring requests                             | Which outcomes are scored externally, by whom, and when a request is accepted: after the test ended, and again to replace the score                       |

`scoring.test.ts` plays tests and items through the engine: the request of an item outcome and of a test outcome with covers,
an item that was not presented, correct responses and template values, a score supplied before, and `unknown-request` for a
request the state lacks. A property test takes a candidate's text from the engine through a submission, as JSON text, to a
score, a second score that replaces it and the submission read again. The display has `submission.browser.test.ts`: the
content roots and their references, the values by cardinality and base type, the files by media type, the themes, and axe at
WCAG 2.2 A and AA with the contrast of the nested content in every theme.

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
