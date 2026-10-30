import { svg } from "../dom.js";
import type { OpenTool, ToolContext } from "./context.js";
import type { ProtractorSpec } from "./model.js";
import { formatNumber } from "./numbers.js";
import { openPlacedTool } from "./placed-tool.js";
import { PROTRACTOR_EXTENT, protractorScale, unitSymbol } from "./scale.js";

/** The space in CSS pixels around the half circle. */
const PADDING = 16;

/** The height in CSS pixels of the strip under the base line. */
const BASE = 20;

/** The least and the greatest radius of the protractor in CSS pixels. */
const LEAST_RADIUS = 96;
const GREATEST_RADIUS = 200;

/** The lengths in CSS pixels of the major and the minor ticks. */
const MAJOR_TICK = 14;
const MINOR_TICK = 8;

/** The distances in CSS pixels from the arc of the outer and the inner numbers, which read from the right end and from the left end. */
const OUTER_LABEL = MAJOR_TICK + 10;
const INNER_LABEL = MAJOR_TICK + 28;

/** The half length in CSS pixels of the cross at the center. */
const CENTER_MARK = 6;

/** The distance in CSS pixels from the center of a number to its baseline: a third of its height. */
const NUMBER_DROP = 4;

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Opens a protractor (INFO §5.110): a half circle that measures 180 degrees, with ticks at the increments along the arc
 * and the numbers at the major ticks, in the unit of the major increment, from the right end on the outer ring and from
 * the left end on the inner ring. It turns about the center of its base line.
 */
export function openProtractor(
  context: ToolContext,
  protractor: ProtractorSpec,
  description: string | null,
  close: () => void,
): OpenTool {
  const radius = Math.min(Math.max(context.layer.clientWidth / 2 - PADDING, LEAST_RADIUS), GREATEST_RADIUS);
  const { ticks, unit, unitDegrees } = protractorScale(protractor, radius);
  const width = 2 * radius + 2 * PADDING;
  const height = radius + PADDING + BASE;
  const cx = PADDING + radius;
  const cy = PADDING + radius;
  // The point at an angle from the right end of the base line, and a distance from the center.
  const point = (degrees: number, distance: number): string =>
    `${cx + distance * Math.cos(radians(degrees))} ${cy - distance * Math.sin(radians(degrees))}`;
  const label = (degrees: number, distance: number, value: number): SVGTextElement => {
    const x = cx + (radius - distance) * Math.cos(radians(degrees));
    const y = cy - (radius - distance) * Math.sin(radians(degrees));
    return svg(
      "text",
      { class: "tempuh-scale-text", x: String(x), y: String(y + NUMBER_DROP) },
      formatNumber(value / unitDegrees),
    );
  };
  const graphic = svg("svg", { width: String(width), height: String(height) });
  graphic.append(
    svg("path", {
      class: "tempuh-surface",
      d: `M${cx - radius} ${cy}A${radius} ${radius} 0 0 1 ${cx + radius} ${cy}v${BASE}h${-2 * radius}Z`,
    }),
    svg("path", {
      class: "tempuh-ticks",
      d:
        `M${cx - radius} ${cy}H${cx + radius}M${cx} ${cy - CENTER_MARK}V${cy + CENTER_MARK}M${cx - CENTER_MARK} ${cy}H${cx + CENTER_MARK}` +
        ticks
          .map(
            (tick) => `M${point(tick.at, radius)}L${point(tick.at, radius - (tick.major ? MAJOR_TICK : MINOR_TICK))}`,
          )
          .join(""),
    }),
    ...ticks
      .filter((tick) => tick.labelled)
      .flatMap((tick) => [
        label(tick.at, OUTER_LABEL, tick.at),
        label(tick.at, INNER_LABEL, PROTRACTOR_EXTENT - tick.at),
      ]),
    svg("text", { class: "tempuh-scale-text", x: String(cx), y: String(cy - 2 * CENTER_MARK) }, unitSymbol(unit)),
  );
  return openPlacedTool(
    context,
    {
      title: context.messages.toolProtractor,
      description,
      graphic,
      width,
      height,
      pivot: { x: cx, y: cy },
    },
    close,
  );
}
