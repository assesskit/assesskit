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

`readItemVariables` and `readTestInputs` of `@assesskit/runtime/delivery` read a stored results report back into the inputs of
`runResponseProcessing` and `runOutcomeProcessing`, so that a host can score a fixed item again; the guide has the recipe. For that, a
report lists every instance of the plan: those not presented follow the others with the status `initial`, and the report of a session
writes the correct response of a variable whose key template processing set.
