import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkCoverage } from "./coverage.ts";
import { loadMatrixInput, loadTempuhInput, MATRIX_PATH } from "./files.ts";
import { renderMatrix } from "./matrix.ts";
import { checkTempuhCoverage } from "./tempuh.ts";

const root = resolve(import.meta.dirname, "..");
const input = loadMatrixInput(root);
const { missing, unknown } = checkCoverage(input.inventory, input.references);
const stale = readFileSync(join(root, MATRIX_PATH), "utf8") !== renderMatrix(input);
const tempuh = loadTempuhInput(root);
const covered = checkTempuhCoverage(tempuh.inventory, tempuh.references);

for (const id of missing) console.error(`${id} has no test: name it in brackets in the title of a test.`);
for (const { id, file } of unknown) console.error(`${file} names ${id}, which is not in the inventory.`);
if (stale) console.error(`${MATRIX_PATH} is stale: run pnpm conformance:render.`);
for (const id of covered.missing)
  console.error(`tempuh ${id} has no test: name it in brackets in the title of a test.`);
for (const { id, file } of covered.unknown) console.error(`${file} names ${id}, which is not in the tempuh inventory.`);
for (const id of covered.missingCriteria) {
  console.error(`WCAG ${id} has no test: name it as [SC ${id}] in the title of a test, or give it a manual check.`);
}
for (const { criterion, file } of covered.unknownCriteria) {
  console.error(`${file} names [SC ${criterion}], which is not in the tempuh inventory.`);
}
const problems =
  missing.length +
  unknown.length +
  covered.missing.length +
  covered.unknown.length +
  covered.missingCriteria.length +
  covered.unknownCriteria.length;
if (problems > 0 || stale) process.exit(1);
console.log(
  `Inventory: ${input.inventory.rows.length} rows, ${input.inventory.merged.length} merged units, all evidenced.`,
);
console.log(
  `Tempuh: ${tempuh.inventory.inventory.rows.length} rows and ${tempuh.inventory.criteria.length} criteria, ${tempuh.inventory.inventory.merged.length} merged unit, all evidenced.`,
);
