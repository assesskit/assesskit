import { svg } from "../dom.js";
import type { OpenTool, ToolContext } from "./context.js";
import type { RuleSpec } from "./model.js";
import { formatNumber } from "./numbers.js";
import { openPlacedTool } from "./placed-tool.js";
import { ruleScale, unitSymbol } from "./scale.js";

/** The space in CSS pixels around the scale, which holds the first and last numbers. */
const PADDING = 16;

/** The height of the rule in CSS pixels. */
const HEIGHT = 56;

/** The lengths in CSS pixels of the major and the minor ticks. */
const MAJOR_TICK = 16;
const MINOR_TICK = 9;

/** The distances in CSS pixels of the baseline of the numbers below the top edge, and of the unit above the bottom edge. */
const NUMBER_BASELINE = MAJOR_TICK + 14;
const UNIT_BASELINE = 8;

/** The least width in CSS pixels the rule is laid out for, when the item has none to give. */
const LEAST_WIDTH = 100;

/**
 * Opens a rule (INFO §5.126): a bar as long as `minimumLength` in the unit of the major increment, with ticks at the
 * increments and the numbers at the major ticks, in the unit of the major increment.
 */
export function openRuler(
  context: ToolContext,
  rule: RuleSpec,
  description: string | null,
  close: () => void,
): OpenTool {
  const { ticks, lengthPx, pxPerMm, unitMm, unit } = ruleScale(
    rule,
    Math.max(context.layer.clientWidth - 2 * PADDING, LEAST_WIDTH),
  );
  const width = lengthPx + 2 * PADDING;
  const graphic = svg("svg", { width: String(width), height: String(HEIGHT) });
  const path = (major: boolean): string =>
    ticks
      .filter((tick) => tick.major === major)
      .map((tick) => `M${PADDING + tick.at * pxPerMm} 0v${major ? MAJOR_TICK : MINOR_TICK}`)
      .join("");
  graphic.append(
    svg("rect", {
      class: "tempuh-surface",
      x: "1",
      y: "1",
      width: String(width - 2),
      height: String(HEIGHT - 2),
      rx: "3",
    }),
    svg("path", { class: "tempuh-ticks", d: path(true) + path(false) }),
    ...ticks
      .filter((tick) => tick.labelled)
      .map((tick) =>
        svg(
          "text",
          { class: "tempuh-scale-text", x: String(PADDING + tick.at * pxPerMm), y: String(NUMBER_BASELINE) },
          formatNumber(tick.at / unitMm),
        ),
      ),
    svg(
      "text",
      { class: "tempuh-scale-text", x: String(width / 2), y: String(HEIGHT - UNIT_BASELINE) },
      unitSymbol(unit),
    ),
  );
  return openPlacedTool(
    context,
    {
      title: context.messages.toolRule,
      description,
      graphic,
      width,
      height: HEIGHT,
      pivot: { x: width / 2, y: HEIGHT / 2 },
    },
    close,
  );
}
