import { type AreaShape, fitsCoordinateCount } from "../asi/index.js";
import { checkArray, checkChoice, describe } from "../checks.js";
import { DataError, ProcessingError } from "../errors.js";
import type { Point, Value } from "../values/index.js";
import { asPoint, booleanResult, primitivesOf } from "./operands.js";

/** A coordinate: a non-negative number of pixels (`CoordsDType`). */
const COORDINATE = /^[0-9]+(?:\.[0-9]+)?$/;

/**
 * Reads the coordinates of an area: numbers separated by commas, as many as the shape takes.
 *
 * @remarks
 * A percentage is relative to the size of the image, which processing does not know.
 *
 * @throws `ProcessingError` when a coordinate is a percentage or not a number, or the count does not fit the shape.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function parseCoords(shape: AreaShape, coords: string): number[] {
  const tokens = shape === "default" && coords.trim() === "" ? [] : coords.split(",").map((token) => token.trim());
  for (const token of tokens) {
    if (!COORDINATE.test(token)) {
      const problem = token.endsWith("%")
        ? "a percentage of the image, whose size processing does not know"
        : "not a number";
      throw new ProcessingError(`The coordinate ${JSON.stringify(token)} of a ${shape} is ${problem}.`);
    }
  }
  if (!fitsCoordinateCount(shape, tokens.length)) {
    throw new ProcessingError(`A ${shape} cannot have the ${tokens.length} coordinates ${JSON.stringify(coords)}.`);
  }
  return tokens.map(Number);
}

/** Returns whether a point lies on the segment from a to b. */
function onSegment([x, y]: Point, ax: number, ay: number, bx: number, by: number): boolean {
  const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  return (
    cross === 0 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by)
  );
}

/** Returns whether a point lies in a polygon or on its edge: an even-odd ray cast, the polygon closed if it is not. */
function insidePolygon(point: Point, coords: readonly number[]): boolean {
  const [x, y] = point;
  const corners = coords.length / 2;
  let inside = false;
  for (let i = 0, j = corners - 1; i < corners; j = i++) {
    const [ax = 0, ay = 0, bx = 0, by = 0] = [coords[2 * i], coords[2 * i + 1], coords[2 * j], coords[2 * j + 1]];
    if (onSegment(point, ax, ay, bx, by)) return true;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/**
 * Returns whether a point lies in an area, its edge included: a rectangle from its left-x, top-y, right-x and bottom-y,
 * a circle from its center and radius, an ellipse from its center and horizontal and vertical radii, a polygon from its
 * corners, and `default`, the whole image. The coordinates are the ones that {@link parseCoords} read.
 */
export function isInsideArea(shape: AreaShape, coords: readonly number[], point: Point): boolean {
  const [x, y] = point;
  const [a = 0, b = 0, c = 0, d = 0] = coords;
  switch (shape) {
    case "default":
      return true;
    case "rect":
      return x >= Math.min(a, c) && x <= Math.max(a, c) && y >= Math.min(b, d) && y <= Math.max(b, d);
    case "circle":
      return (x - a) ** 2 + (y - b) ** 2 <= c ** 2;
    case "ellipse":
      return (x - a) ** 2 * d ** 2 + (y - b) ** 2 * c ** 2 <= c ** 2 * d ** 2;
    case "poly":
      return insidePolygon(point, coords);
  }
}

/** The shapes, for the check of an argument. */
const AREA_SHAPES: readonly AreaShape[] = ["circle", "default", "ellipse", "poly", "rect"];

/**
 * Returns whether a point lies in an area of a hotspot or an area mapping, its edge included: the hit test of the shapes of
 * QTI, the one that `qti-inside` and `qti-map-response-point` use. A scorer of the points of a response with its own
 * rules, such as one that matches each point to the area it hits, takes the test from here.
 *
 * @remarks
 * The coordinates are those of the `coords` attribute as numbers, in the units of the image: a rectangle has its left-x,
 * top-y, right-x and bottom-y, a circle its center and radius, an ellipse its center and its horizontal and vertical
 * radii, a polygon the x and y of its corners, which it closes, and `default`, the whole image, any coordinates. A
 * percentage is a length relative to the image, which this function does not know: a caller converts it first. A polygon
 * is tested with an even-odd ray cast, so that a region that a self-crossing polygon encloses twice is outside.
 *
 * @param shape - The shape of the area.
 * @param coords - The coordinates of the area: non-negative numbers, as many as the shape takes.
 * @param point - The point as `[x, y]`, such as a value of base type point.
 * @returns Whether the point is in the area, on its edge included.
 * @throws `DataError` when the shape is not one of QTI, the coordinates are not an array of non-negative numbers that fits
 * the shape, or the point is not an array of two numbers.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function insideShape(shape: AreaShape, coords: readonly number[], point: Point): boolean {
  checkChoice(shape, "The shape", AREA_SHAPES);
  checkArray(coords, "The coordinates must be an array of non-negative numbers");
  const bad = coords.find(
    (coordinate) => !(typeof coordinate === "number" && coordinate >= 0 && Number.isFinite(coordinate)),
  );
  if (bad !== undefined || !fitsCoordinateCount(shape, coords.length)) {
    const problem =
      bad === undefined ? `the ${coords.length} coordinates do not fit a ${shape}` : `found ${describe(bad)}`;
    throw new DataError(`The coordinates of a ${shape} must be non-negative numbers that fit it: ${problem}.`);
  }
  checkArray(point, "The point must be an array of two numbers");
  if (point.length !== 2 || !point.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new DataError(`The point must be an array of two finite numbers, found ${describe(point)}.`);
  }
  return isInsideArea(shape, coords, point as Point);
}

/**
 * `qti-inside`: whether the point, or any point of a container, lies in the area.
 *
 * @remarks
 * NULL for NULL.
 *
 * @throws `ProcessingError` when the coordinates do not fit the shape.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-inside}
 */
export function inside(operand: Value | null, shape: AreaShape, coords: string): Value | null {
  const parsed = parseCoords(shape, coords);
  if (operand === null) return null;
  return booleanResult(primitivesOf(operand).some((primitive) => isInsideArea(shape, parsed, asPoint(primitive))));
}
