---
"@assesskit/player": major
---

The CAT binding refuses a property named `__proto__`, `prototype` or `constructor` at any depth of a request's body, with a 400, and of an answer of an engine or a token endpoint, with a `DataError`; its answers stay lenient about every other property. A QTI metadata record and its context of a portable custom interaction refuse a list, which they read as an empty object.
