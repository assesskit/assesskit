---
"@assesskit/player": major
---

`checkViewEnvelope` refuses an asset prefix that is not a directory, empty or ending in `/`, as the asset gate signs them, which refuses `__proto__`, `prototype` and `constructor`. `checkSubmission` reads the content as a view carries it, so a property with one of those names at any depth, and `null`, are refused.
