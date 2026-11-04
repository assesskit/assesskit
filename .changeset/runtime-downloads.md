---
"@assesskit/runtime": major
---

`assesskit schemas fetch` aborts a download whose answer does not begin in 30 seconds or whose body brings no byte for 30 seconds, and tries a download that fails with a network error or the status 408, 429 or 5xx three times in all, after 2 and then 4 seconds, telling each retry on the standard error. Any other status is not tried again. The `fetch` option of `runCli` is called with the address and the request's `signal` and `headers`.
