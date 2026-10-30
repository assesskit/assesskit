import { html } from "../dom.js";
import type { OpenTool, ToolContext } from "./context.js";
import type { FileMaterial } from "./model.js";
import { materialName } from "./names.js";
import { isAbsoluteUrl } from "./package-path.js";
import { createPanel } from "./panel.js";

/**
 * Shows a file of the package in the way its media type allows without running anything of it: an image, audio or
 * video in the element that plays it, a page in a frame with an empty `sandbox`, and any other file as a link that opens
 * in a tab of its own (tempuh design §3).
 */
function viewer({ messages }: ToolContext, material: FileMaterial, url: string): HTMLElement {
  const name = materialName(material);
  const type = (material.mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type.startsWith("image/")) return html("img", { src: url, alt: name });
  if (type.startsWith("audio/")) return html("audio", { src: url, controls: "" });
  if (type.startsWith("video/")) return html("video", { src: url, controls: "" });
  if (type === "text/html") return html("iframe", { src: url, sandbox: "", title: name });
  return html("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, messages.toolOpenFile);
}

/**
 * Opens a digital material (INFO §5.80, BPIG §3.7.8.4), or the file of a calculator: a viewer for the file in the package. A path with a scheme is
 * not a package path and is not loaded; the viewer says that the material is not available.
 */
export function openDigital(context: ToolContext, material: FileMaterial, close: () => void): OpenTool {
  const panel = createPanel(context, materialName(material), close);
  panel.body.append(
    isAbsoluteUrl(material.fileHref.value)
      ? html("p", {}, context.messages.toolUnavailable)
      : html("div", { class: "tempuh-viewer" }, viewer(context, material, context.assets(material.fileHref.value))),
  );
  return { focus: () => panel.focus(), destroy: () => panel.remove() };
}
