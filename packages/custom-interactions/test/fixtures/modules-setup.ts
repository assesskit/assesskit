import { resolve } from "node:path";
import { buildModules } from "../../scripts/build-modules.ts";

/** Builds the modules into the package's `modules/`, where `readInteractionFiles` reads them, as `pnpm build` does. */
export default async function setup(): Promise<void> {
  await buildModules(resolve(import.meta.dirname, "../../modules"));
}
