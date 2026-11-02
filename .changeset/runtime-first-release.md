---
"@assesskit/runtime": major
---

A QTI 3.0 runtime for JavaScript and TypeScript. It reads, writes and validates assessment items, tests, content packages (with `ltiLaunchUrl` for the launch URL of an LTI link),
results, usage data and personal needs and preferences, against the official schemas and with semantic checks; runs
template, response and outcome processing; and delivers a test session without presenting it, on a server where the
answer keys never reach a candidate, or on a device for practice. A host answers the requests of a CAT engine through a
`CatPort`, one with `sendCatRequest` or all with `drainCat`. A rubric block for scorers can hold a structured scoring rubric,
with criteria, levels and weights aligned with CASE; `validate` checks it, and the runtime scores a rater's ratings under it. Items are compared with Longsight qti3-core, test sessions
are tested against the specifications, and the 1EdTech examples are read, validated and run. It is not certified by 1EdTech.
The `assesskit` command validates a package or a document.

A stored session state is read by every later 1.x release, and `STATE_VERSION` is exported from `@assesskit/runtime/delivery`.
The option `contentVersion` of `createEngine` names the version of the content: a state keeps it, and the engine refuses a
state that another version started.
`response-processed` events carry the `attempt` number and the `duration` of the item so far in milliseconds, and with the
option `eventOutcomes` of `createEngine` its outcomes, so that a host needs no `results()` call after each step.
The option `reviewAfterEnd` of `createEngine` lets a candidate review the items presented after the test ended, as each item
session control allows; it is off by default, and an engine with it names the content version of the states it reads.
The builders of the covers block and of the scoring rubric block are `buildScoreCoversBlock` and `buildScoringRubricBlock`.
`parseCandidateAction(json, { limits })` takes its limits in an options object like the other readers, and reports an action
above a limit as a `SecurityError` that names it. `sendCatRequest(port, request, { signal })` and `drainCat` end their wait
when the signal aborts, and leave the request of the port to its own timeout. A custom operator that throws is a
`ProcessingError` that names it and keeps what it threw as `cause`, so that `Engine.apply` reports `processing-failed` and
never throws on a state of the engine. The ZIP reader ends the central directory by its size and not by the 16-bit count of
the end record, so that an archive of more than 65,535 entries is read whole and counted against `maxEntries`, and an end
record whose count differs from the entries is a `ReadError`. A document that declares ISO-8859-1 is read byte for byte.
A validation lists at most `maxFindings` issues, 1,000 by default, and ends a longer list with the error
`assesskit/validate/findings-stopped`; `validateResults`, `validatePnpNamespace` and `validateXmlFiles` take the option too.
`parseModuleResolution` refuses a file longer than 65,536 characters before it parses it.

`readItemVariables` and `readTestInputs` of `@assesskit/runtime/delivery` read a stored results report back into the inputs of
`runResponseProcessing` and `runOutcomeProcessing`, so that a host can score a fixed item again; the guide has the recipe. For that, a
report lists every instance of the plan, in plan order: those not presented have the status `initial` and the sequence indexes after the
others, and the report of a session writes the correct response of a variable whose key template processing set.

`CatSessionPort` is the three requests that a session makes (Create Session, Submit Results, End Session), the type that `drainCat` and `sendCatRequest`
take, so that a port without the deployment of sections serves.

The action `mark` marks an item instance that was presented for review, or takes the mark away; the mark is a field of the
state (a state without it reads as before), `marked` in the navigation map, and never in the results. `validate` accepts a
text entry bound to a record, a `ruby` with an `rp` before and after its `rt`, and a portable custom interaction whose module
resolution files and modules lie at the root of the package, from an item in any folder. It warns about the pre-conditions and branch rules of a test part in nonlinear mode, which the engine ignores as it
ignores those of the sections and items in it.

`readPnp` reads the color theme of the best practices guide into `TextAppearance.colorTheme`, with the terms of `PNP_COLOR_THEMES`
and `isColorTheme`. The PNP schema has no such element, so `writePnp` leaves it out and `validatePnp` warns.
