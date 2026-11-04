---
"@assesskit/player": major
---

`AccessError` and `ServiceError` take `ErrorOptions` last, and an error that reports another holds it as `cause`: the `ServiceError` of a CAT request whose port failed or whose engine answered with a body that is not JSON, the `DataError` of a request body that is not UTF-8 or not JSON, and the `AssesskitError` of a stylesheet that could not be fetched. A canvas that gives no picture is an `AssesskitError`, and a refused answer of a CAT engine is a `DataError` inside the loop's `ServiceError` (both were a plain `Error`).

The refusal of a view envelope is `{ reason, message }` (was `{ code, message }`), and `REFUSAL_REASONS` lists the reasons (was `REFUSAL_CODES`). `AccessError.reason` is the exported union `AccessErrorReason`: `not-bound` or `session-exists`.
