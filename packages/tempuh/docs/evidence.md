# Evidence

`conformance/tempuh-inventory.json` lists every duty of the player and every success criterion of WCAG 2.2 at levels A and
AA, with the evidence that proves it and the build unit that completes it.

## Rows

A row has an identifier `T1` to `T122`, the duty, the olah rows it implements (`olah`: identifiers or ranges such as
`J4–J6`, which must exist in `olah-inventory.json`), the folders that implement it, its evidence and its unit. A duty that
the host owns or that is not supported has an `owner` in place of folders, evidence and unit.

| Code | Evidence                                                                                   |
| ---- | ------------------------------------------------------------------------------------------ |
| R    | Rendering test in Vitest browser mode on Chromium, Firefox and WebKit                      |
| A    | axe-core at WCAG 2.2 A and AA, a keyboard-only script, and the manual checks of the matrix |
| E    | Playwright end-to-end flow on three engines                                                |
| X    | A 1EdTech sample renders, accepts input and logs no error                                  |
| U    | Unit test, in Node or the browser                                                          |
| F    | Fake service that records HTTP, compared with the cited payloads                           |
| P    | Property of the behavior, checked by fast-check                                            |
| L    | Live check by a person                                                                     |

## Criteria

A criterion has its number (`1.4.3`), name, level, tempuh's part, the evidence the design names and its unit. A criterion
has one of three kinds:

| Kind           | Fields              | Gate                                                    |
| -------------- | ------------------- | ------------------------------------------------------- |
| Tested         | `unit`              | A test names it as `[SC 1.4.3]` once the unit is merged |
| Manual         | `unit` and `manual` | The named manual check by a person; no test is required |
| Not applicable | `notApplicable`     | The reason; no unit and no test                         |

## Tests name their rows and criteria

A title names what it evidences in brackets, as a string literal: `it("[T97] chooses the catalog of the language")` or
`it("[SC 3.2.4] gives each function one key")`. A title may name several, such as `[T97][SC 3.2.4]`. Skipped and todo tests
do not count. tempuh's tests are the files `*.test.ts` in `packages/tempuh/test/`; an identifier is checked against the
inventory of its own package, so `[T1]` in tempuh is not olah's `T1`.

## The coverage gate

`pnpm conformance` fails when

- a row of a merged unit has no test;
- a criterion of a merged unit that is neither manual nor inapplicable has no test;
- a test names a row or a criterion that the inventory does not have.

A unit adds itself to `merged` in the commit that completes it, which makes its rows and criteria need tests from then on.
Rows and criteria of units that are not merged need no test yet.
