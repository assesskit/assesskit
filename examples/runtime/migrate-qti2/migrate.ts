import { join } from "node:path";
import { migrateSamples } from "./src/migrate-samples.ts";
import { formatReport, summarize } from "./src/report.ts";
import { readSamples } from "./src/samples.ts";

/** The 1EdTech examples of QTI 2.2 that `pnpm corpus` downloads, from the root of the repository. */
const DEFAULT_SAMPLES = join(import.meta.dirname, "../../../.cache/corpus/qti-examples/qtiv2p2-examples/items");

const [, , directory = DEFAULT_SAMPLES] = process.argv;
console.log(formatReport(summarize(await migrateSamples(readSamples(directory)))));
