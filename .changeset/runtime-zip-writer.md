---
"@assesskit/runtime": patch
---

`writePackage` writes through `zipSync` of `fflate` in place of an own ZIP writer of 120 lines, and gives the same bytes, in every time zone. Two names differ, because `zipSync` holds its files in a plain object: a file at the root whose name is a whole number, such as `12`, comes before the manifest, and a file named `__proto__` at the root is refused with a `DataError`.
