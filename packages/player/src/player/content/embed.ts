import { html } from "../internal.js";
import type { RenderContext } from "./context.js";

/** What to embed: a file that the URL policy has resolved, its media type, and what stands for it where it is withheld. */
export interface Embedding {
  /** The URL of the file, resolved. */
  readonly url: string;
  /** The media type of the file, with or without parameters. */
  readonly type: string;
  /** The text alternative of the file as nodes: the fallback content of an `object`. */
  readonly alternative: readonly Node[];
  /** The `width` for the element, already scaled; absent when none. */
  readonly width?: string;
  /** The `height` for the element, already scaled; absent when none. */
  readonly height?: string;
}

/** The media types of pages that go in a frame; the frame has an empty `sandbox`, so it runs no script. */
const PAGE_TYPES: ReadonlySet<string> = new Set(["text/html", "application/xhtml+xml"]);

/** The image types that can move: an animation is withheld where a hazard remains. */
const ANIMATED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/svg+xml",
  "image/webp",
]);

/** The file extensions of those types, for an `img` that states no type. */
const ANIMATED_IMAGE_EXTENSIONS = /\.(?:apng|avif|gif|svg|webp)$/iu;

/**
 * Returns the media type without its parameters, in lower case.
 *
 * @param type - A media type, with or without parameters.
 * @returns The type and subtype.
 */
export function essence(type: string): string {
  return (type.split(";")[0] ?? "").trim().toLowerCase();
}

/**
 * Returns whether an image can move, by its media type or, when it has none, by the extension of its path.
 *
 * @param type - The media type of the image, if the author gave one.
 * @param path - The path or URL of the image.
 * @returns `true` for a type or extension of an animated format.
 */
export function canAnimate(type: string | undefined, path: string): boolean {
  return type === undefined || type === ""
    ? ANIMATED_IMAGE_EXTENSIONS.test(path.split(/[?#]/u)[0] ?? "")
    : ANIMATED_IMAGE_TYPES.has(essence(type));
}

/** Returns the text of nodes with its white space reduced: the text alternative of an embedded file. */
function textOf(nodes: readonly Node[]): string {
  return nodes
    .map((node) => node.textContent ?? "")
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Returns the last segment of a URL path, which names a file for a frame or a link that has no text of its own. */
function fileName(url: string): string {
  return (url.split(/[?#]/u)[0] ?? "").split("/").pop() ?? "";
}

function sized<T extends HTMLElement>(element: T, { width, height }: Embedding): T {
  if (width !== undefined) element.setAttribute("width", width);
  if (height !== undefined) element.setAttribute("height", height);
  return element;
}

/** Builds the element that plays an audio or video file, with the controls that WCAG 1.4.2 asks for. */
function player(name: "audio" | "video", embedding: Embedding): HTMLElement {
  const element = html(name, { src: embedding.url, controls: "", preload: "metadata" }, ...embedding.alternative);
  return name === "video" ? sized(element, embedding) : element;
}

/**
 * Embeds a file by its media type, without running anything of it.
 *
 * @remarks
 * - An image is an `img` with the text alternative as its `alt`.
 * - Audio and video are `audio` and `video` with controls, and the alternative as fallback content.
 * - A page (`text/html`) is an `iframe` with an empty `sandbox`, titled by the alternative.
 * - Anything else is a link that opens in a tab of its own.
 *
 * Where a hazard remains, what plays or can move (audio, video, a page and an animated image) is replaced by its
 * alternative.
 *
 * @param context - The context of the rendering.
 * @param embedding - The file and what stands for it.
 * @returns The DOM nodes that stand for the file.
 * @see {@link https://www.w3.org/TR/WCAG22/#audio-control | WCAG 2.2, audio control}
 */
export function embed(context: RenderContext, embedding: Embedding): Node[] {
  const type = essence(embedding.type);
  const alternative = textOf(embedding.alternative);
  const isImage = type.startsWith("image/");
  const isPlayer = type.startsWith("audio/") || type.startsWith("video/");
  const isPage = PAGE_TYPES.has(type);
  if (context.withholdMedia && (isPlayer || isPage || (isImage && canAnimate(type, embedding.url)))) {
    return [...embedding.alternative];
  }
  if (isImage) return [sized(html("img", { src: embedding.url, alt: alternative }), embedding)];
  if (isPlayer) return [player(type.startsWith("audio/") ? "audio" : "video", embedding)];
  if (isPage) {
    const title = alternative === "" ? fileName(embedding.url) : alternative;
    const frame = html("iframe", { src: embedding.url, sandbox: "", title, referrerpolicy: "no-referrer" });
    return [sized(frame, embedding)];
  }
  const text = embedding.alternative.length === 0 ? [context.messages.toolOpenFile] : embedding.alternative;
  return [html("a", { href: embedding.url, target: "_blank", rel: "noopener noreferrer" }, ...text)];
}
