import { openAnswerMasking } from "./answer-masking.js";
import { openCalculator } from "./calculator.js";
import type { OpenTool, ToolContext } from "./context.js";
import { openDigital } from "./digital.js";
import { openLineReader } from "./line-reader.js";
import type { ToolEntry } from "./model.js";
import { openProtractor } from "./protractor.js";
import { openRuler } from "./ruler.js";
import { openSlot } from "./slot.js";

/** Opens a tool: its panel in the tray and whatever it puts over the item. `close` is called when the candidate closes its panel. */
export function openTool(context: ToolContext, { spec, description }: ToolEntry, close: () => void): OpenTool {
  switch (spec.kind) {
    case "rule":
      return openRuler(context, spec.rule, description, close);
    case "protractor":
      return openProtractor(context, spec.protractor, description, close);
    case "line-reader":
      return openLineReader(context, spec.highlightColor, close);
    case "answer-masking":
      return openAnswerMasking(context);
    case "calculator":
      return openCalculator(context, spec.type, description, close);
    case "slot":
      return openSlot(context, spec.tool, close);
    case "digital":
      return openDigital(context, spec.material, close);
  }
}
