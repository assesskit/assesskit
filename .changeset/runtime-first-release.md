---
"@assesskit/runtime": major
---

A QTI 3.0 runtime for JavaScript and TypeScript. It reads, writes and validates assessment items, tests, content packages,
results, usage data and personal needs and preferences, against the official schemas and with semantic checks; runs
template, response and outcome processing; and delivers a test session without presenting it, on a server where the
answer keys never reach a candidate, or on a device for practice. A host answers the requests of a CAT engine through a
`CatPort`, one with `sendCatRequest` or all with `drainCat`. A rubric block for scorers can hold a structured scoring rubric,
with criteria, levels and weights aligned with CASE, and the runtime scores a rater's ratings under it. Items are compared with Longsight qti3-core, test sessions
are tested against the specifications, and the 1EdTech examples are read, validated and run. It is not certified by 1EdTech.
The `assesskit` command validates a package or a document.
