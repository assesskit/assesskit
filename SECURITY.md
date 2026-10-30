# Security

Report vulnerabilities privately through the repository's security advisory form rather than a public issue.

Points to be aware of when deploying olah:

- **No I/O.** The olah core reads no files, makes no network requests, reads no environment variables, reads no clock and
  runs no code it is given. Only the `node` and `cli` modules use Node.js.
- **No fetching.** Absolute URLs in content are data. The core never fetches them, and callers supply the callbacks that
  resolve references.
- **Untrusted input.** Every input is untrusted: documents, packages, actions and what callbacks return. Entry points
  validate their input and throw `DataError` on malformed data, so data from users or files can be passed in directly.
- **Randomness.** `createRandom` is a seeded generator whose draws are reproducible from the seed. It is not
  cryptographically secure. Selections and shuffles that use it can be reproduced by anyone who knows the seed, so keep the
  seed of an exam session on the server.
