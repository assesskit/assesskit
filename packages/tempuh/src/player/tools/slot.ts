import type { CalculatorInfo } from "@luthfanwakan/olah/asi";
import { checkFunction } from "../../checks.js";
import { html } from "../dom.js";
import type { OpenTool, ToolContext } from "./context.js";
import { toolFile, viewFile } from "./file-viewer.js";
import type { SlotTool } from "./model.js";
import { toolName } from "./names.js";
import { createPanel } from "./panel.js";

/**
 * Opens a tool that the host provides (tempuh design §2.8): its panel holds the element that the host's function builds
 * in, and the function gets the file of a calculator that the item gives. Without such a function, the panel says that
 * the tool is not available and shows the file, if there is one.
 *
 * @throws `DataError` when the host's function does not return a function; the panel is gone then.
 */
export function openSlot(
  context: ToolContext,
  tool: SlotTool,
  file: CalculatorInfo | null,
  close: () => void,
): OpenTool {
  const { messages, language, slots } = context;
  const name = toolName({ kind: "slot", tool }, messages);
  const panel = createPanel(context, name, close);
  const build = slots[tool];
  let unmount: () => void = () => undefined;
  if (build === undefined) {
    panel.body.append(html("p", {}, messages.toolUnavailable), ...(file === null ? [] : [viewFile(context, file)]));
  } else {
    try {
      const unmounted = build(panel.body, { name: tool, language, file: toolFile(context, file) });
      checkFunction(unmounted, `The function of the slot ${tool} must return a function`);
      unmount = unmounted;
    } catch (error) {
      panel.remove();
      throw error;
    }
  }
  return {
    focus: () => panel.focus(),
    destroy: () => {
      unmount();
      panel.remove();
    },
  };
}
