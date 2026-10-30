import type { DigitalMaterial } from "@luthfanwakan/olah/asi";
import type { OpenTool, ToolContext } from "./context.js";
import { viewFile } from "./file-viewer.js";
import { materialName } from "./names.js";
import { createPanel } from "./panel.js";

/** Opens a digital material (INFO §5.80, BPIG §3.7.8.4): a viewer for the file in the package. */
export function openDigital(context: ToolContext, material: DigitalMaterial, close: () => void): OpenTool {
  const panel = createPanel(context, materialName(material), close);
  panel.body.append(viewFile(context, material));
  return { focus: () => panel.focus(), destroy: () => panel.remove() };
}
