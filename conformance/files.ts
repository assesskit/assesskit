import { join } from "node:path";
import { loadAcceptedDifferences } from "./accepted.ts";
import { collectReferences } from "./coverage.ts";
import { loadFeatures } from "./features.ts";
import { loadInventory } from "./inventory.ts";
import type { MatrixInput } from "./matrix.ts";

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
    references: collectReferences(root),
    directory: "packages/olah/docs",
  };
}
