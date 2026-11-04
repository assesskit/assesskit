---
"@assesskit/runtime": major
---

`ServiceError` is the runtime's, from `@assesskit/runtime/errors` and the root, beside `DataError`: it is the error that a `CatPort` throws to refuse a request (the status 400, 404, 429 or 503), so a CAT engine depends on the runtime alone. The class, its status and its body are those that `@assesskit/player` exported.
