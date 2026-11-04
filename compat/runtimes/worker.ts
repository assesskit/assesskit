import { runAll } from "./scenario.ts";

/** The worker answers every request with the results of the scenario as JSON. */
// biome-ignore lint/style/noDefaultExport: a Worker module exports its handlers as the default export.
export default {
  async fetch(): Promise<Response> {
    return Response.json(await runAll());
  },
};
