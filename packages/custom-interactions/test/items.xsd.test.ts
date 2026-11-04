import { resolve } from "node:path";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "@assesskit/runtime/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { writeMathEntryItem, writeStepsItem } from "./fixtures/items.js";

let set: SchemaSet;
beforeAll(async () => {
  set = await loadSchemaSet(requireSchemas(resolve(import.meta.dirname, "../../..")));
});
afterAll(() => set.close());

describe("the items of the interactions", () => {
  it("are valid against the official ASI schema: an expression scored by its key, with either decimal mark, and worked steps", async () => {
    const items = [
      writeMathEntryItem({ kind: "expression", expression: "2x+2" }, "Expand 2(x + 1)."),
      writeMathEntryItem(
        { kind: "expression", expression: "\\frac14", decimalSeparator: "," },
        "Tulis seperempat.",
        'data-decimal-separator=","',
      ),
      writeStepsItem("Solve 2x + 3 = 7."),
    ];
    const issues = await validateXmlFiles(
      set,
      items.map((content, index) => ({ path: `item-${index}.xml`, content })),
    );
    expect(issues).toEqual([]);
  });
});
