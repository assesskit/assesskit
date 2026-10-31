import type { DigitalMaterial } from "@assesskit/runtime/asi";
import type { OpenTool, ToolContext } from "./context.js";
import { viewFile } from "./file-viewer.js";
import { materialName } from "./names.js";
import { createPanel } from "./panel.js";

/**
 * Opens a digital material: a viewer for the file in the package.
 *
 * @param context - What the tool needs from the mount.
 * @param material - The material.
 * @param close - Called when the candidate closes the panel.
 * @returns The open tool.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, digital material}
 */
export function openDigital(context: ToolContext, material: DigitalMaterial, close: () => void): OpenTool {
  const panel = createPanel(context, materialName(material), close);
  panel.body.append(viewFile(context, material));
  return { focus: () => panel.focus(), destroy: () => panel.remove() };
}
