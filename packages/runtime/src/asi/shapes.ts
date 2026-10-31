/**
 * The shapes of areas: the values of the `shape` attribute of `qti-area-mapping` and of the hotspots and gaps of the graphic
 * interactions.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export type AreaShape = "circle" | "default" | "ellipse" | "poly" | "rect";

/** The tests of the number of coordinates that each shape takes. */
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

/**
 * Returns whether a number of coordinates fits a shape: three for a circle (its center and radius), four for a rectangle
 * and an ellipse, an even number of at least six for a polygon, which takes three points or more, and any number for
 * `default`, the whole image.
 *
 * @param shape - The shape.
 * @param count - The number of coordinates.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
export function coordinateCountFits(shape: AreaShape, count: number): boolean {
  return COORDINATE_COUNTS.get(shape)?.(count) ?? false;
}
