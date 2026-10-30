import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Returns the element names of the rows `A<first>` to `A<last>` of the inventory, which the design generated from the
 * schema, so that a test can check the table and the generated documents against rows and not against themselves.
 */
export function inventoryElements(first: number, last: number): string[] {
  const inventory: { rows: { id: string; construct: string }[] } = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../conformance/olah-inventory.json"), "utf8"),
  );
  const names = new Map(inventory.rows.map(({ id, construct }) => [id, construct.replaceAll("`", "")]));
  return Array.from({ length: last - first + 1 }, (_, index) => names.get(`A${first + index}`) ?? "");
}
