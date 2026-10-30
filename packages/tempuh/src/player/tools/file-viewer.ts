import { html } from "../dom.js";
import type { ToolContext, ToolFile } from "./context.js";
import type { FileMaterial } from "./model.js";
import { materialName } from "./names.js";
import { isAbsoluteUrl } from "./package-path.js";

/**
 * Shows a file of the package in the way its media type allows without running anything of it: an image, audio or
 * video in the element that plays it, a page in a frame with an empty `sandbox`, and any other file as a link that opens
 * in a tab of its own (tempuh design §3). A path with a scheme is not a package path and is not loaded; the viewer says
 * that the file is not available.
 */
export function viewFile({ messages, assets }: ToolContext, file: FileMaterial): HTMLElement {
  const path = file.fileHref.value;
  if (isAbsoluteUrl(path)) return html("p", {}, messages.toolUnavailable);
  const url = assets(path);
  const name = materialName(file);
  const type = (file.mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  let content: HTMLElement;
  if (type.startsWith("image/")) content = html("img", { src: url, alt: name });
  else if (type.startsWith("audio/")) content = html("audio", { src: url, controls: "" });
  else if (type.startsWith("video/")) content = html("video", { src: url, controls: "" });
  else if (type === "text/html") content = html("iframe", { src: url, sandbox: "", title: name });
  else content = html("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, messages.toolOpenFile);
  return html("div", { class: "tempuh-viewer" }, content);
}

/** Describes the file of a calculator for the tool of the host, or returns `null` when the path is not a package path. */
export function toolFile({ assets }: ToolContext, file: FileMaterial | null): ToolFile | null {
  if (file === null || isAbsoluteUrl(file.fileHref.value)) return null;
  return { url: assets(file.fileHref.value), mimeType: file.mimeType ?? null, label: file.label ?? null };
}
