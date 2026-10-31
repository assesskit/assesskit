import type { Point } from "@assesskit/runtime/values";

/** The tools of the drawing interaction. The pen and the eraser follow the pointer; the others take points that the candidate picks. */
export type Tool = "pen" | "eraser" | "line" | "rectangle" | "ellipse" | "fill";

/** The tools that follow a path of the pointer, which only a pointer can give (WCAG 2.2, 2.1.1 exempts such functions). */
export const FREEHAND_TOOLS: ReadonlySet<Tool> = new Set<Tool>(["pen", "eraser"]);

/** A stroke of the pen or the eraser: the points of the path, in the units of the image. */
export interface Stroke {
  /** The tool. */
  readonly tool: "pen" | "eraser";
  /** The color of the pen; the eraser takes the color off whatever it passes. */
  readonly color: string;
  /** The points of the path, in the order the pointer passed them. */
  readonly points: readonly Point[];
}

/** A line, a rectangle or an ellipse between two points the candidate picked. */
export interface Shape {
  /** The tool. */
  readonly tool: "line" | "rectangle" | "ellipse";
  /** The color of the outline. */
  readonly color: string;
  /** The first point: an end of the line, a corner of the rectangle or of the box of the ellipse. */
  readonly from: Point;
  /** The second point: the other end, or the opposite corner. */
  readonly to: Point;
}

/** A fill of the region that joins a point. */
interface Fill {
  /** The tool. */
  readonly tool: "fill";
  /** The color of the fill. */
  readonly color: string;
  /** The point the fill starts at. */
  readonly at: Point;
}

/** What the candidate drew in one go, in the units of the image. */
export type Operation = Stroke | Shape | Fill;

/** A horizontal run of pixels, from `x0` to `x1` on the row `y`, ends included. */
export interface Run {
  readonly x0: number;
  readonly x1: number;
  readonly y: number;
}

/** The pixels of a picture, as `ImageData` has them: four bytes for each, red, green, blue and alpha. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

/**
 * How far a pixel may differ from the one the fill starts at and still be filled: the sum of the differences of its
 * red, green, blue and alpha values. It lets the fill cover the soft edge of a line without crossing it.
 */
const FILL_TOLERANCE = 160;

/** Returns a function that tells whether a pixel is close to the color of the pixel at `start`. */
function similarTo(pixels: Pixels, [startX, startY]: Point): (x: number, y: number) => boolean {
  const { width, data } = pixels;
  const seed = 4 * (startY * width + startX);
  return (x, y) => {
    const index = 4 * (y * width + x);
    let difference = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      difference += Math.abs((data[index + channel] ?? 0) - (data[seed + channel] ?? 0));
    }
    return difference <= FILL_TOLERANCE;
  };
}

/** Returns the points to continue from on a row next to a run: one for each stretch of the row that `open` finds open. */
function seedsOnRow(open: (x: number, y: number) => boolean, row: number, x0: number, x1: number): Point[] {
  const seeds: Point[] = [];
  let inside = false;
  for (let column = x0; column <= x1; column += 1) {
    const here = open(column, row);
    if (here && !inside) seeds.push([column, row]);
    inside = here;
  }
  return seeds;
}

/** Returns the runs of pixels that a fill from a point covers: the pixels that join it and are close to its color. */
export function fillRuns(pixels: Pixels, start: Point): Run[] {
  const { width, height } = pixels;
  const [startX, startY] = start;
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return [];
  const similar = similarTo(pixels, start);
  const filled = new Uint8Array(width * height);
  const open = (x: number, y: number): boolean => y >= 0 && y < height && filled[y * width + x] !== 1 && similar(x, y);
  const runs: Run[] = [];
  const seeds: Point[] = [start];
  for (let next = seeds.pop(); next !== undefined; next = seeds.pop()) {
    const [x, y] = next;
    if (!open(x, y)) continue;
    let x0 = x;
    let x1 = x;
    while (x0 > 0 && open(x0 - 1, y)) x0 -= 1;
    while (x1 < width - 1 && open(x1 + 1, y)) x1 += 1;
    filled.fill(1, y * width + x0, y * width + x1 + 1);
    runs.push({ x0, x1, y });
    seeds.push(...seedsOnRow(open, y - 1, x0, x1), ...seedsOnRow(open, y + 1, x0, x1));
  }
  return runs;
}

/** Traces the path of a stroke: a single point is a dot, a line of no length with round caps. */
function traceStroke(context: CanvasRenderingContext2D, { points }: Stroke, scale: number): void {
  const [first, ...rest] = points;
  if (first === undefined) return;
  context.moveTo(first[0] * scale, first[1] * scale);
  for (const [x, y] of rest.length === 0 ? [first] : rest) context.lineTo(x * scale, y * scale);
}

/** Traces a line, a rectangle or an ellipse between two points. */
function traceShape(context: CanvasRenderingContext2D, { tool, from, to }: Shape, scale: number): void {
  const [fromX, fromY] = from;
  const [toX, toY] = to;
  if (tool === "line") {
    context.moveTo(fromX * scale, fromY * scale);
    context.lineTo(toX * scale, toY * scale);
  } else if (tool === "rectangle") {
    context.rect(
      Math.min(fromX, toX) * scale,
      Math.min(fromY, toY) * scale,
      Math.abs(toX - fromX) * scale,
      Math.abs(toY - fromY) * scale,
    );
  } else {
    const radii: [number, number] = [(Math.abs(toX - fromX) / 2) * scale, (Math.abs(toY - fromY) / 2) * scale];
    context.ellipse(((fromX + toX) / 2) * scale, ((fromY + toY) / 2) * scale, ...radii, 0, 0, 2 * Math.PI);
  }
}

/** Paints a pen stroke, an erasure or a shape on a canvas. `scale` is the pixels of the canvas for one unit of the image. */
export function paint(
  context: CanvasRenderingContext2D,
  operation: Stroke | Shape,
  scale: number,
  lineWidth: number,
): void {
  context.save();
  context.lineWidth = lineWidth * scale;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = operation.color;
  context.globalCompositeOperation = operation.tool === "eraser" ? "destination-out" : "source-over";
  context.beginPath();
  if ("points" in operation) traceStroke(context, operation, scale);
  else traceShape(context, operation, scale);
  context.stroke();
  context.restore();
}
