import { join } from "node:path";
import { loadAcceptedDifferences } from "./accepted.ts";
import { collectReferences, type TestReference } from "./coverage.ts";
import { loadFeatures } from "./features.ts";
import { loadInventory } from "./inventory.ts";
import type { MatrixInput } from "./matrix.ts";
import { loadPlayerInventory, type PlayerInventory } from "./player.ts";

/** The packages whose tests evidence the rows of `runtime-inventory.json`. */
const RUNTIME_TESTS = ["packages/runtime", "differential"];

/** The generated conformance document, relative to the repository root. */
export const MATRIX_PATH = "packages/runtime/docs/conformance.md";

/** Reads the inventory, the feature list, the accepted differences and the test references of a repository. */
export function loadMatrixInput(root: string): MatrixInput {
  const inventory = loadInventory(join(root, "conformance/runtime-inventory.json"));
  const rows = new Set(inventory.rows.map((row) => row.id));
  return {
    inventory,
    features: loadFeatures(join(root, "conformance/cert-features.json"), rows),
    accepted: loadAcceptedDifferences(join(root, "conformance/accepted-differences.json")),
    references: collectReferences(root, RUNTIME_TESTS),
    directory: "packages/runtime/docs",
  };
}

/** Reads the inventory of the player, which cites the rows of the runtime's, and the tests that name its rows and criteria. */
export function loadPlayerInput(root: string): {
  readonly inventory: PlayerInventory;
  readonly references: readonly TestReference[];
} {
  const runtimeRows = new Set(
    loadInventory(join(root, "conformance/runtime-inventory.json")).rows.map((row) => row.id),
  );
  return {
    inventory: loadPlayerInventory(join(root, "conformance/player-inventory.json"), runtimeRows),
    references: collectReferences(root, ["packages/player"]),
  };
}
