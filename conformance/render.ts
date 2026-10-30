import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadMatrixInput, MATRIX_PATH } from "./files.ts";
import { renderMatrix } from "./matrix.ts";

const root = resolve(import.meta.dirname, "..");
writeFileSync(join(root, MATRIX_PATH), renderMatrix(loadMatrixInput(root)));
console.log(`Wrote ${MATRIX_PATH}.`);
