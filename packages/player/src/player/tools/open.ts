import { openAnswerMasking } from "./answer-masking.js";
import { openCalculator } from "./calculator.js";
import type { OpenTool, ToolContext } from "./context.js";
import { openDigital } from "./digital.js";
import { openEliminator } from "./eliminator.js";
import { openHighlighter } from "./highlighter.js";
import { openLineReader } from "./line-reader.js";
import type { ToolEntry } from "./model.js";
import { openProtractor } from "./protractor.js";
import { openRuler } from "./ruler.js";
import { openSlot } from "./slot.js";

/**
 * Opens a tool: its panel in the tray and whatever it puts over the item.
 *
 * @param context - What the tool needs from the mount.
 * @param entry - The tool in force.
 * @param close - Called when the candidate closes its panel.
 * @returns The open tool.
 */
export function openTool(context: ToolContext, { spec, description, file }: ToolEntry, close: () => void): OpenTool {
  switch (spec.kind) {
    case "rule":
      return openRuler(context, spec.rule, description, close);
    case "protractor":
      return openProtractor(context, spec.protractor, description, close);
    case "line-reader":
      return openLineReader(context, spec.highlightColor, close);
    case "answer-masking":
      return openAnswerMasking(context);
    case "highlighter":
      return openHighlighter(context, close);
    case "eliminator":
      return openEliminator(context);
    case "calculator":
      // A scientific calculator of the host, such as the one a program requires, replaces the built-in one.
      return spec.type === "scientific" && context.slots["scientific-calculator"] !== undefined
        ? openSlot(context, "scientific-calculator", file, close)
        : openCalculator(context, spec.type, description, file, close);
    case "slot":
      return openSlot(context, spec.tool, file, close);
    case "digital":
      return openDigital(context, spec.material, close);
  }
}
