import { join } from "node:path";
import { loadAcceptedDifferences } from "./accepted.ts";
import { collectReferences, type TestReference } from "./coverage.ts";
import { loadFeatures } from "./features.ts";
import { loadInventory } from "./inventory.ts";
import type { MatrixInput } from "./matrix.ts";
import { loadTempuhInventory, type TempuhInventory } from "./tempuh.ts";

/** The packages whose tests evidence the rows of `olah-inventory.json`. */
const OLAH_TESTS = ["packages/olah", "differential"];

/** The generated conformance document, relative to the repository root. */
export const MATRIX_PATH = "packages/olah/docs/conformance.md";

/** Reads the inventory, the feature list, the accepted differences and the test references of a repository. */
export function loadMatrixInput(root: string): MatrixInput {
  const inventory = loadInventory(join(root, "conformance/olah-inventory.json"));
  const rows = new Set(inventory.rows.map((row) => row.id));
  return {
    inventory,
    features: loadFeatures(join(root, "conformance/cert-features.json"), rows),
    accepted: loadAcceptedDifferences(join(root, "conformance/accepted-differences.json")),
    references: collectReferences(root, OLAH_TESTS),
    directory: "packages/olah/docs",
  };
}

/** Reads the inventory of tempuh, which cites the rows of olah's, and the tests that name its rows and criteria. */
export function loadTempuhInput(root: string): {
  readonly inventory: TempuhInventory;
  readonly references: readonly TestReference[];
} {
  const olahRows = new Set(loadInventory(join(root, "conformance/olah-inventory.json")).rows.map((row) => row.id));
  return {
    inventory: loadTempuhInventory(join(root, "conformance/tempuh-inventory.json"), olahRows),
    references: collectReferences(root, ["packages/tempuh"]),
  };
}
