import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkCoverage } from "./coverage.ts";
import { loadMatrixInput, MATRIX_PATH } from "./files.ts";
import { renderMatrix } from "./matrix.ts";

const root = resolve(import.meta.dirname, "..");
const input = loadMatrixInput(root);
const { missing, unknown } = checkCoverage(input.inventory, input.references);
const stale = readFileSync(join(root, MATRIX_PATH), "utf8") !== renderMatrix(input);

for (const id of missing) console.error(`${id} has no test: name it in brackets in the title of a test.`);
for (const { id, file } of unknown) console.error(`${file} names ${id}, which is not in the inventory.`);
if (stale) console.error(`${MATRIX_PATH} is stale: run pnpm conformance:render.`);
if (missing.length + unknown.length > 0 || stale) process.exit(1);
console.log(
  `Inventory: ${input.inventory.rows.length} rows, ${input.inventory.merged.length} merged units, all evidenced.`,
);
