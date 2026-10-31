import { readAsi } from "@assesskit/runtime/asi";
import { DataError } from "@assesskit/runtime/errors";
import { describeInteractions, type InteractionDescriptor } from "@assesskit/runtime/interactions";
import { container, single } from "@assesskit/runtime/values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  centerOf,
  clampPoint,
  fillRuns,
  type Pixels,
  parseArea,
  pointAt,
  pointsOf,
  responseOf,
} from "../src/player/elements/internal.js";

/** The descriptor of the only interaction of an item that has the given declaration and body. */
function descriptorOf(declaration: string, interaction: string): InteractionDescriptor {
  const document = readAsi(
    `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i" title="I" adaptive="false" time-dependent="false">${declaration}<qti-item-body>${interaction}</qti-item-body></qti-assessment-item>`,
  );
  if (document.kind !== "item") throw new Error("The fixture is not an item.");
  const [descriptor] = describeInteractions(document.item);
  if (descriptor === undefined) throw new Error("The fixture has no interaction.");
  return descriptor;
}

const IMAGE = '<object type="image/png" data="a.png" width="200" height="100"/>';
const SIZE = { width: 200, height: 100 };

describe("geometry", () => {
  it("gives the box of each shape as the information model states its coordinates", () => {
    // The information model: rect is left-x, top-y, right-x, bottom-y; circle is center-x, center-y, radius; ellipse is center-x,
    // center-y, h-radius, v-radius; poly is x1, y1, ... xN, yN; default is the whole image.
    expect(parseArea("rect", "10,20,30,50", SIZE).box).toEqual({ x: 10, y: 20, width: 20, height: 30 });
    expect(parseArea("circle", "50,60,10", SIZE).box).toEqual({ x: 40, y: 50, width: 20, height: 20 });
    expect(parseArea("ellipse", "50,60,10,5", SIZE).box).toEqual({ x: 40, y: 55, width: 20, height: 10 });
    expect(parseArea("default", "", SIZE).box).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    const polygon = parseArea("poly", "0,0,10,0,5,8", SIZE);
    expect(polygon.box).toEqual({ x: 0, y: 0, width: 10, height: 8 });
    expect(polygon.corners).toEqual([
      [0, 0],
      [10, 0],
      [5, 8],
    ]);
  });

  it("reads a percentage against the width for x, the height for y, and the smaller side for a radius", () => {
    expect(parseArea("rect", "10%,20%,50%,100%", SIZE).box).toEqual({ x: 20, y: 20, width: 80, height: 80 });
    // The radius is the smaller of the two values: 10% of 100, not of 200.
    expect(parseArea("circle", "50%,50%,10%", SIZE).box).toEqual({ x: 90, y: 40, width: 20, height: 20 });
    expect(parseArea("ellipse", "50%,50%,10%,10%", SIZE).box).toEqual({ x: 80, y: 40, width: 40, height: 20 });
  });

  it("takes a rectangle whose corners are swapped as the same box", () => {
    expect(parseArea("rect", "30,50,10,20", SIZE).box).toEqual(parseArea("rect", "10,20,30,50", SIZE).box);
  });

  it("refuses coordinates that do not fit the shape", () => {
    expect(() => parseArea("circle", "1,2", SIZE)).toThrow(DataError);
    expect(() => parseArea("rect", "1,2,3", SIZE)).toThrow("cannot have the 3 coordinates");
    expect(() => parseArea("poly", "1,2,3,4,5", SIZE)).toThrow(DataError);
    expect(() => parseArea("ellipse", "1,2,3", SIZE)).toThrow(DataError);
    expect(() => parseArea("rect", "1,2,3,x", SIZE)).toThrow('The coordinate "x" of a rect must be a length');
    expect(() => parseArea("rect", "1,2,3,-4", SIZE)).toThrow(DataError);
  });

  it("turns a position on the screen into a point of the image at any scale", () => {
    // The image is drawn at half size at (10, 20): the screen position (60, 45) is half way across and down.
    const drawn = { x: 10, y: 20, width: 100, height: 50 };
    expect(pointAt(drawn, SIZE, 60, 45)).toEqual([100, 50]);
    expect(pointAt(drawn, SIZE, 10, 20)).toEqual([0, 0]);
    expect(pointAt(drawn, SIZE, 110, 70)).toEqual([200, 100]);
    expect(centerOf({ x: 10, y: 20, width: 20, height: 30 })).toEqual([20, 35]);
  });

  describe("properties", () => {
    it("gives a point of the image with whole numbers for any position", () => {
      fc.assert(
        fc.property(
          fc.record({
            x: fc.integer({ min: -50, max: 500 }),
            y: fc.integer({ min: -50, max: 500 }),
            width: fc.integer({ min: 1, max: 800 }),
            height: fc.integer({ min: 1, max: 800 }),
          }),
          fc.double({ min: -1000, max: 1000, noNaN: true }),
          fc.double({ min: -1000, max: 1000, noNaN: true }),
          (drawn, clientX, clientY) => {
            const [x, y] = pointAt(drawn, SIZE, clientX, clientY);
            expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
            expect(x >= 0 && x <= SIZE.width && y >= 0 && y <= SIZE.height).toBe(true);
            expect(clampPoint([x, y], SIZE)).toEqual([x, y]);
          },
        ),
      );
    });

    it("holds every corner of a polygon in its box", () => {
      fc.assert(
        fc.property(
          fc.array(fc.tuple(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 100 })), {
            minLength: 3,
            maxLength: 12,
          }),
          (corners) => {
            const { box } = parseArea("poly", corners.flat().join(","), SIZE);
            for (const [x, y] of corners) {
              expect(x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height).toBe(true);
            }
          },
        ),
      );
    });
  });
});

describe("values", () => {
  const selectPoint = (cardinality: string, attributes: string) =>
    descriptorOf(
      `<qti-response-declaration identifier="R" cardinality="${cardinality}" base-type="point"/>`,
      `<qti-select-point-interaction response-identifier="R" ${attributes}>${IMAGE}</qti-select-point-interaction>`,
    );

  it("reads the points of a value in their order, and none from NULL or other values", () => {
    expect(
      pointsOf(
        container("multiple", "point", [
          [1, 2],
          [3, 4],
        ]),
      ),
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(pointsOf(single("point", [5, 6]))).toEqual([[5, 6]]);
    expect(pointsOf(null)).toEqual([]);
    expect(pointsOf(single("integer", 5))).toEqual([]);
    expect(pointsOf(container("multiple", "pair", [["A", "B"]]))).toEqual([]);
  });

  it("gives a single point for one point of a single variable, a container otherwise, and NULL for none", () => {
    expect(responseOf(selectPoint("single", 'max-choices="1"'), "point", [[1, 2]])).toEqual(single("point", [1, 2]));
    expect(responseOf(selectPoint("multiple", 'max-choices="3"'), "point", [[1, 2]])).toEqual(
      container("multiple", "point", [[1, 2]]),
    );
    expect(responseOf(selectPoint("multiple", 'max-choices="3"'), "point", [])).toBeNull();
  });
});

/** The pixels of a grid of colors by their letters: `.` is white and `#` is black. */
function grid(rows: readonly string[]): Pixels {
  const data = rows.flatMap((row) =>
    [...row].flatMap((cell) => (cell === "#" ? [0, 0, 0, 255] : [255, 255, 255, 255])),
  );
  return { width: rows[0]?.length ?? 0, height: rows.length, data };
}

/** The cells of the fill by a plain search of the neighbors, written apart from the code under test. */
function reachable(pixels: Pixels, startX: number, startY: number): Set<string> {
  const seed = (startY * pixels.width + startX) * 4;
  const close = (x: number, y: number): boolean => {
    const index = (y * pixels.width + x) * 4;
    let difference = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      difference += Math.abs((pixels.data[index + channel] ?? 0) - (pixels.data[seed + channel] ?? 0));
    }
    return difference <= 160;
  };
  const seen = new Set<string>([`${startX},${startY}`]);
  const queue: [number, number][] = [[startX, startY]];
  while (queue.length > 0) {
    const [x, y] = queue.shift() ?? [0, 0];
    for (const [nextX, nextY] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      const inside = nextX >= 0 && nextY >= 0 && nextX < pixels.width && nextY < pixels.height;
      if (inside && !seen.has(`${nextX},${nextY}`) && close(nextX, nextY)) {
        seen.add(`${nextX},${nextY}`);
        queue.push([nextX, nextY]);
      }
    }
  }
  return seen;
}

/** The cells that runs cover. */
const cellsOf = (runs: ReturnType<typeof fillRuns>): string[] =>
  runs.flatMap(({ x0, x1, y }) => Array.from({ length: x1 - x0 + 1 }, (_, i) => `${x0 + i},${y}`));

describe("drawing operations", () => {
  it("fills the region that joins the start and stops at a line", () => {
    const pixels = grid(["..#..", "..#..", "..#..", "..#.."]);
    expect(new Set(cellsOf(fillRuns(pixels, [0, 0])))).toEqual(
      new Set(["0,0", "1,0", "0,1", "1,1", "0,2", "1,2", "0,3", "1,3"]),
    );
    // The line itself is a region of its own, and a start in it fills only the line.
    expect(cellsOf(fillRuns(pixels, [2, 1])).sort()).toEqual(["2,0", "2,1", "2,2", "2,3"]);
  });

  it("fills nothing for a start outside the picture", () => {
    const pixels = grid(["..", ".."]);
    expect(fillRuns(pixels, [-1, 0])).toEqual([]);
    expect(fillRuns(pixels, [0, 2])).toEqual([]);
    expect(fillRuns(pixels, [2, 0])).toEqual([]);
  });

  it("does not cross a diagonal line of the other color", () => {
    const pixels = grid(["#..", ".#.", "..#"]);
    // Cells that only touch at a corner are not joined (four neighbors).
    expect(cellsOf(fillRuns(pixels, [1, 0])).sort()).toEqual(["1,0", "2,0", "2,1"].sort());
  });

  it("covers a soft edge: a gray close to the start color is filled, and one far from it is a line", () => {
    const soft = { width: 3, height: 1, data: [255, 255, 255, 255, 235, 235, 235, 255, 40, 40, 40, 255] };
    expect(cellsOf(fillRuns(soft, [0, 0])).sort()).toEqual(["0,0", "1,0"]);
  });

  describe("properties", () => {
    it("covers exactly the cells that a plain search of the neighbors reaches, each once", () => {
      const cell = fc.constantFrom(".", "#");
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 8 }).chain((width) =>
            fc.tuple(
              fc.array(
                fc.array(cell, { minLength: width, maxLength: width }).map((row) => row.join("")),
                { minLength: 1, maxLength: 8 },
              ),
              fc.nat(width - 1),
            ),
          ),
          fc.nat(),
          ([rows, startX], pick) => {
            const pixels = grid(rows);
            const startY = pick % pixels.height;
            const cells = cellsOf(fillRuns(pixels, [startX, startY]));
            expect(new Set(cells).size).toBe(cells.length);
            expect(new Set(cells)).toEqual(reachable(pixels, startX, startY));
          },
        ),
      );
    });
  });
});
