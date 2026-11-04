import { fitsCoordinateCount } from "../asi/index.js";
import { isInsideShape } from "../processing/index.js";
import type { Value } from "../values/index.js";
import { maximumMatching } from "./matching.js";
import { checkOperandCount, pointsOf, share } from "./operands.js";
import { type OptionsOf, optionsError, pathOf } from "./options.js";
import type { AreasKeyData } from "./schemas.js";

/**
 * Reads and checks the options of `hotspot-matching`.
 *
 * @throws `DataError` for coordinates that do not fit their shape, an id given twice, or a `select` above the count of areas.
 */
export function prepareAreas(options: OptionsOf<"hotspot-matching">, prefix: string): AreasKeyData {
  const { key } = options;
  const ids = new Set<string>();
  key.areas.forEach((area, index) => {
    const path = pathOf(prefix, `key.areas[${index}]`);
    if (ids.has(area.id)) throw optionsError(`${path}.id`, `the area id ${JSON.stringify(area.id)} is given twice.`);
    ids.add(area.id);
    if (!fitsCoordinateCount(area.shape, area.coords.length))
      throw optionsError(`${path}.coords`, `a ${area.shape} cannot have ${area.coords.length} coordinates.`);
  });
  if (key.select > key.areas.length)
    throw optionsError(pathOf(prefix, "key.select"), `select ${key.select} is above the ${key.areas.length} areas.`);
  return key;
}

/**
 * `hotspot-matching`: the keyed areas a response's points hit, edges included, each point matched to one area at most by a
 * maximum matching (Hopcroft and Karp), over `select`, at most 1. More points than the key has areas is unreadable: NULL, as
 * a NULL response is.
 */
export function scoreAreas(key: AreasKeyData, operands: readonly (Value | null)[]): Value | null {
  checkOperandCount(operands, 1);
  const points = pointsOf(operands[0]);
  if (points === null || points.length > key.areas.length) return null;
  const edges = points.map((point) =>
    key.areas.flatMap((area, index) => (isInsideShape(area.shape, area.coords, point) ? [index] : [])),
  );
  const matched = maximumMatching(edges, key.areas.length);
  return share(Math.min(matched, key.select) / key.select);
}
