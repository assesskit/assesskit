import type { AreaMapping, Mapping } from "../asi/index.js";
import { ProcessingError } from "../errors.js";
import type { Primitive, Value } from "../values/index.js";
import { primitiveKey } from "../values/internal.js";
import { readPrimitive } from "./declared-value.js";
import { asPoint, asString, floatResult, primitivesOf } from "./operands.js";
import type { DeclaredResponse } from "./scope.js";
import { isInsideArea, parseCoords } from "./shapes.js";
import { foldCase } from "./strings.js";

/**
 * The value of an unmapped key when the mapping gives no `default-value`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const DEFAULT_MAPPED_VALUE = 0;

/**
 * Returns the bounded sum of a container's mapped values: `lower-bound` and `upper-bound` apply to containers only.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
function bounded(sum: number, table: Mapping | AreaMapping, container: boolean): number {
  if (!container) return sum;
  const low = Math.max(sum, table.lowerBound ?? Number.NEGATIVE_INFINITY);
  return Math.min(low, table.upperBound ?? Number.POSITIVE_INFINITY);
}

/**
 * Returns the distinct values of a response: a container counts each value once.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function distinct(value: Value): Primitive[] {
  if (value.cardinality === "record") return [];
  const seen = new Map<string, Primitive>();
  for (const primitive of primitivesOf(value)) seen.set(primitiveKey(value.baseType, primitive), primitive);
  return [...seen.values()];
}

function unmapped(identifier: string, element: string): ProcessingError {
  return new ProcessingError(
    `The response variable ${identifier} has no ${element} to map its value with.`,
    identifier,
  );
}

/**
 * `qti-map-response`: the mapped value of a single response, or the sum of the mapped values of the distinct values of
 * a container, bounded by `lower-bound` and `upper-bound`.
 *
 * @remarks
 * A value maps to the first entry whose key equals it, else to `default-value`. String keys compare case-insensitively
 * unless the entry is `case-sensitive`; keys of other base types compare as `qti-match` does. NULL when the response is
 * NULL.
 *
 * @throws `ProcessingError` when the response has no mapping or is a record, or a key is not a value of its base type.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-map-response}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function mapResponse({ declaration, value }: DeclaredResponse): Value | null {
  const { identifier, mapping, baseType } = declaration;
  if (mapping === undefined || baseType === undefined) throw unmapped(identifier, "qti-mapping");
  if (value === null) return null;
  const entries = mapping.mapEntries.map((entry) => {
    const key = readPrimitive(entry.mapKey, baseType, `The map key of ${identifier}`);
    const folded = baseType === "string" && entry.caseSensitive !== true;
    return { key: folded ? foldCase(asString(key)) : primitiveKey(baseType, key), folded, mapped: entry.mappedValue };
  });
  const mappedValue = (primitive: Primitive): number => {
    const exact = primitiveKey(baseType, primitive);
    const folded = typeof primitive === "string" ? foldCase(primitive) : exact;
    const entry = entries.find((candidate) => candidate.key === (candidate.folded ? folded : exact));
    return entry?.mapped ?? mapping.defaultValue ?? DEFAULT_MAPPED_VALUE;
  };
  const sum = distinct(value).reduce<number>((total, primitive) => total + mappedValue(primitive), 0);
  return floatResult(bounded(sum, mapping, value.cardinality !== "single"));
}

/**
 * `qti-map-response-point`: the mapped value of the area that a single point falls in, or the sum over the distinct
 * points of a container, bounded as `qti-map-response` is.
 *
 * @remarks
 * A point counts for the first area that holds it, in document order, and each area counts once however many points
 * fall in it; a point in no area adds `default-value`. NULL when the response is NULL.
 *
 * @throws `ProcessingError` when the response is no point or has no area mapping, or coordinates do not fit their
 * shape.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-map-response-point}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function mapResponsePoint({ declaration, value }: DeclaredResponse): Value | null {
  const { identifier, areaMapping, baseType } = declaration;
  if (areaMapping === undefined || baseType !== "point") throw unmapped(identifier, "qti-area-mapping of points");
  if (value === null) return null;
  const areas = areaMapping.areaMapEntries.map((entry) => ({
    shape: entry.shape,
    coords: parseCoords(entry.shape, entry.coords),
    mapped: entry.mappedValue,
  }));
  const counted = new Set<number>();
  let sum = 0;
  for (const primitive of distinct(value)) {
    const point = asPoint(primitive);
    const area = areas.findIndex((candidate) => isInsideArea(candidate.shape, candidate.coords, point));
    if (area === -1) sum += areaMapping.defaultValue ?? DEFAULT_MAPPED_VALUE;
    else if (!counted.has(area)) {
      counted.add(area);
      sum += areas[area]?.mapped ?? 0;
    }
  }
  return floatResult(bounded(sum, areaMapping, value.cardinality !== "single"));
}
