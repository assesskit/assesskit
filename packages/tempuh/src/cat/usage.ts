import { readUsageData, type TargetObject } from "@luthfanwakan/olah/usage";
import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { StoredItem } from "./section-store.js";

/** The item statistics that give the parameters of a logistic item, by the property of `StoredItem` they set (UD §2.8.2). */
const PARAMETERS: ReadonlyMap<string, keyof Omit<StoredItem, "id">> = new Map([
  ["A-Param", "a"],
  ["B-Param", "b"],
  ["C-Param", "c"],
  ["D-Param", "d"],
]);

/** The parameters of an item that the usage data does not give: the Rasch discrimination, no guessing, no slip. */
const DEFAULTS = { a: 1, c: 0, d: 1 } as const;

/** The parameters of one item found so far, by property of `StoredItem`. */
type ItemParameters = Map<keyof Omit<StoredItem, "id">, number>;

/**
 * Returns whether a statistic is about a whole item: its target object names the item and no part of it, and it is not
 * about another kind of object (UD §2.6.4).
 */
function isWholeItem(target: TargetObject): boolean {
  return target.partIdentifier === undefined && (target.objectType === undefined || target.objectType === "item");
}

/**
 * Reads the item parameters of a usage data file. Only ordinary statistics about a whole item are read: `A-Param`,
 * `B-Param`, `C-Param` and `D-Param` (UD §2.8.2), as the logistic models of the 1PL to the 4PL use them. An item needs
 * its `B-Param`; the other parameters default to a Rasch item (`a = 1`, `c = 0`, `d = 1`). Other statistics are left alone.
 *
 * @throws `DataError` when a parameter is given twice for an item or is not a number, or an item has a parameter and no
 * `B-Param`.
 * @throws `ReadError` and `SecurityError` as `readUsageData` does for a file that is not usage data.
 */
export function readItems(bytes: Uint8Array): StoredItem[] {
  const found = new Map<string, ItemParameters>();
  for (const statistic of readUsageData(bytes).statistics) {
    const property = PARAMETERS.get(statistic.name);
    if (property === undefined || statistic.kind !== "ordinary") continue;
    const { value, baseType = "float" } = statistic.value;
    if (typeof value !== "number" || (baseType !== "float" && baseType !== "integer")) {
      throw new DataError(
        `The statistic ${statistic.name} must be a number of the base type float or integer, found ${describe(value)} of the base type ${baseType}.`,
      );
    }
    for (const target of statistic.targetObjects.filter(isWholeItem)) {
      const parameters: ItemParameters = found.get(target.identifier) ?? new Map();
      if (parameters.has(property)) {
        throw new DataError(
          `The usage data gives ${statistic.name} for the item ${describe(target.identifier)} more than once; the item needs one value.`,
        );
      }
      found.set(target.identifier, parameters.set(property, value));
    }
  }
  return [...found].map(([id, parameters]) => {
    const b = parameters.get("b");
    if (b === undefined) {
      throw new DataError(`The usage data gives parameters for the item ${describe(id)} but no B-Param.`);
    }
    return {
      id,
      a: parameters.get("a") ?? DEFAULTS.a,
      b,
      c: parameters.get("c") ?? DEFAULTS.c,
      d: parameters.get("d") ?? DEFAULTS.d,
    };
  });
}
