import { DataError } from "@assesskit/runtime/errors";
import type { Point } from "@assesskit/runtime/values";
import { describe } from "../../../checks.js";

/** The shapes of an area. */
export type AreaShape = "circle" | "default" | "ellipse" | "poly" | "rect";

/** The size of an image in its own units, the pixels of the author: the unit of every coordinate and every point. */
export interface Size {
  /** The width. */
  readonly width: number;
  /** The height. */
  readonly height: number;
}

/** A rectangle in the units of the image. */
export interface Box extends Size {
  /** The distance from the left edge of the image. */
  readonly x: number;
  /** The distance from the top edge of the image. */
  readonly y: number;
}

/** An area of an image: the shape of a hotspot or a gap, with the smallest box that holds it. */
export interface Area {
  /** The shape. */
  readonly shape: AreaShape;
  /** The smallest box that holds the shape. */
  readonly box: Box;
  /** The corners of a polygon, in the units of the image; empty for the other shapes. */
  readonly corners: readonly Point[];
}

/** How many coordinates each shape takes; a polygon takes three corners or more. */
const COORDINATE_COUNTS: ReadonlyMap<AreaShape, (count: number) => boolean> = new Map<
  AreaShape,
  (count: number) => boolean
>([
  ["circle", (count) => count === 3],
  ["default", () => true],
  ["ellipse", (count) => count === 4],
  ["poly", (count) => count >= 6 && count % 2 === 0],
  ["rect", (count) => count === 4],
]);

/** A length of the `Coords` type: a number of pixels, or a percentage of the image. */
const LENGTH = /^(\d+)(%?)$/u;

/** Reads one length of the coordinates; a percentage is of `whole`, the dimension the coordinate runs along. */
function lengthOf(token: string, whole: number): number | undefined {
  const match = LENGTH.exec(token);
  if (match === null) return undefined;
  const value = Number(match[1]);
  return match[2] === "%" ? (value / 100) * whole : value;
}

/**
 * Reads the coordinates of an area against the size of its image.
 *
 * @remarks
 * A coordinate along the width is a percentage of the width, one along the height of the height, and the radius of a
 * circle of the smaller of the two. `default` is the whole image, and it takes no coordinates. A polygon closes itself.
 *
 * @param shape - The shape.
 * @param coords - The coordinates as the item writes them.
 * @param size - The size of the image.
 * @returns The area.
 * @throws `DataError` when a coordinate is not a length or the count does not fit the shape.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, geometry}
 */
export function parseArea(shape: AreaShape, coords: string, size: Size): Area {
  const { width, height } = size;
  const tokens = coords.trim() === "" ? [] : coords.split(",").map((token) => token.trim());
  if (shape === "default") return { shape, box: { x: 0, y: 0, width, height }, corners: [] };
  if (!(COORDINATE_COUNTS.get(shape)?.(tokens.length) ?? false)) {
    throw new DataError(`A ${shape} cannot have the ${tokens.length} coordinates ${describe(coords)}.`);
  }
  const radius = Math.min(width, height);
  // The coordinates alternate between x and y; the radius of a circle is a length of its own.
  const lengths = tokens.map((token, index) => {
    const whole = shape === "circle" && index === 2 ? radius : index % 2 === 0 ? width : height;
    const length = lengthOf(token, whole);
    if (length === undefined) {
      throw new DataError(`The coordinate ${describe(token)} of a ${shape} must be a length such as 12 or 50%.`);
    }
    return length;
  });
  const [a = 0, b = 0, c = 0, d = 0] = lengths;
  switch (shape) {
    case "rect":
      return {
        shape,
        box: { x: Math.min(a, c), y: Math.min(b, d), width: Math.abs(c - a), height: Math.abs(d - b) },
        corners: [],
      };
    case "circle":
      return { shape, box: { x: a - c, y: b - c, width: 2 * c, height: 2 * c }, corners: [] };
    case "ellipse":
      return { shape, box: { x: a - c, y: b - d, width: 2 * c, height: 2 * d }, corners: [] };
    default: {
      const corners = Array.from(
        { length: lengths.length / 2 },
        (_, i): Point => [lengths[2 * i] ?? 0, lengths[2 * i + 1] ?? 0],
      );
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      const [x, y] = [Math.min(...xs), Math.min(...ys)];
      return { shape, box: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }, corners };
    }
  }
}

/**
 * Returns the point at the center of a box, in the units of the image.
 *
 * @param box - The box.
 * @returns The center.
 */
export function centerOf(box: Box): Point {
  return [box.x + box.width / 2, box.y + box.height / 2];
}

/**
 * Returns a point limited to the image, with whole numbers, as the base type `point` has them.
 *
 * @param point - The point.
 * @param size - The size of the image.
 * @returns The point inside the image.
 */
export function clampPoint([x, y]: Point, size: Size): Point {
  return [Math.min(size.width, Math.max(0, Math.round(x))), Math.min(size.height, Math.max(0, Math.round(y)))];
}

/**
 * Returns the point of the image at a position on the screen.
 *
 * @remarks
 * The point is measured in the units of the author whatever the scale of the drawing.
 *
 * @param rect - Where the image is drawn.
 * @param size - The size of the image.
 * @param clientX - The horizontal position on the screen.
 * @param clientY - The vertical position on the screen.
 * @returns The point.
 */
export function pointAt(rect: Box, size: Size, clientX: number, clientY: number): Point {
  const x = ((clientX - rect.x) / rect.width) * size.width;
  const y = ((clientY - rect.y) / rect.height) * size.height;
  return clampPoint([x, y], size);
}
