---
"@assesskit/player": major
---

`AccessError` and `ServiceError` take `ErrorOptions` last, and an error that reports another holds it as `cause`: the `ServiceError` of a CAT request whose port failed or whose engine answered with a body that is not JSON, the `DataError` of a request body that is not UTF-8 or not JSON, and the `AssesskitError` of a stylesheet that could not be fetched. A canvas that gives no picture is an `AssesskitError`, and a refused answer of a CAT engine is a `DataError` inside the loop's `ServiceError` (both were a plain `Error`).

The refusal of a view envelope is `{ reason, message }` (was `{ code, message }`), and `REFUSAL_REASONS` lists the reasons (was `REFUSAL_CODES`). `AccessError.reason` is the exported union `AccessErrorReason`: `not-bound` or `session-exists`.

`CallOptions` is the runtime's, from `@assesskit/runtime/checks` (no longer exported from `@assesskit/player/protocol`), and every port of the player takes it. `deployCatSections(pkg, port, options?)` takes a `signal` (`DeployCatSectionsOptions`), which ends its wait and reaches each request. `createRestCatPort` passes the signal of a call to its request and to a function of `engines` (`CatEngineResolver` takes the options of the call), and ends the call's wait for a token without stopping the token request that the calls share; `createCatRestHandler` gives the port the signal of the request. `createSessionHost` takes `clock` as an option, by default `SYSTEM_CLOCK`, and `scheduler` as an option, so that a host of untimed practice needs none: without one, `createSessionHost` refuses an engine whose test has a maximum time anywhere (`Engine.hasMaximumTime`) with a `DataError`, so that no candidate meets the refusal halfway through a sitting.

`createCatRestHandler` answers 413 for a body above `maxBodyBytes` or `maxTokens` (was 400): the reader throws the `SecurityError` of the limit, with its name and value, as STANDARDS asks of every limit on untrusted input.
