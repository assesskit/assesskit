import type { PoolItem } from "@measurekit/psychometrics/cat";
import { fourParameterLogistic } from "@measurekit/psychometrics/irt";
import type { StoredItem } from "./section-store.ts";

/**
 * The scaling constant of a bank on measurekit's scale: measurekit's models are in the IRT form of mirt with D = 1 (measurekit,
 * `docs/irt.md`), so the parameters of the usage data are taken as they are.
 */
export const DEFAULT_SCALING_CONSTANT = 1;

/**
 * Returns the item pool of a section: the items of the usage data, with `a` multiplied by the scaling constant, so that a
 * bank on the normal-ogive metric (D = 1.702) is on measurekit's scale, and then the host's items. A host item replaces the
 * item of the usage data with its identifier and keeps its place, and a host item with another identifier is added at the
 * end. Host items are taken as they are: they are measurekit's items, on measurekit's scale.
 */
export function poolOf(
  items: readonly StoredItem[],
  hostItems: readonly PoolItem[],
  scalingConstant: number,
): PoolItem[] {
  const pool = new Map<string, PoolItem>(
    items.map(({ id, a, b, c, d }) => [
      id,
      { id, model: fourParameterLogistic, parameters: { a: a * scalingConstant, b, c, d } },
    ]),
  );
  for (const item of hostItems) pool.set(item.id, item);
  return [...pool.values()];
}
