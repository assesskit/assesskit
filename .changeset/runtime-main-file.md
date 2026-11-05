---
"@assesskit/runtime": minor
"@assesskit/player": patch
---

`resolveResourcePath(manifest, resource)` without the option `href` resolves the main file of a resource: its `href`, or else its only file, the rule that the package resolvers, `validatePackage` and the asset gate each wrote for themselves. The asset gate now finds a test whose resource has one file and no `href`, which it skipped before. A resource with an `href` resolves as before.
