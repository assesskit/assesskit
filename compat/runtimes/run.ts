import { runAll } from "./scenario.ts";

// Node.js, Deno and Bun run the bundle of this file and read the results from its output, as JSON.
console.log(JSON.stringify(await runAll()));
