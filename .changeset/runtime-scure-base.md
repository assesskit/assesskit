---
"@assesskit/runtime": patch
---

`encodeBase64`, `decodeBase64` and `decodeBase64Url` run on `@scure/base` 2.4.0 in place of 158 lines of own code, a seventh runtime dependency. The canonical rule stays: a text with bits after the last byte, white space, a lone digit or excess padding still gives `undefined`, and the texts are the same, measured against the old code over 360,000 cases on Node.js, Bun and Deno. The first load of an exam page grows by 829 bytes after gzip, within its budget.
