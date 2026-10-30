/**
 * The files the gate serves, by extension, with their media types: the types a browser loads for content. A file with any
 * other extension, such as `.xml`, is never served, whatever the token and whatever is in it. QTI documents are XML, so
 * this keeps every document that can hold a key, a template or hidden content out by its type, besides the checks of the
 * manifest and the sniff of what the file holds.
 */
const TYPES: ReadonlyMap<string, string> = new Map([
  ["html", "text/html; charset=utf-8"],
  ["htm", "text/html; charset=utf-8"],
  ["css", "text/css; charset=utf-8"],
  ["js", "text/javascript; charset=utf-8"],
  ["mjs", "text/javascript; charset=utf-8"],
  ["json", "application/json"],
  ["txt", "text/plain; charset=utf-8"],
  ["csv", "text/csv; charset=utf-8"],
  ["pls", "application/pls+xml"],
  ["svg", "image/svg+xml"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["opus", "audio/ogg"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["mp4", "video/mp4"],
  ["m4v", "video/mp4"],
  ["webm", "video/webm"],
  ["ogv", "video/ogg"],
  ["vtt", "text/vtt; charset=utf-8"],
  ["srt", "text/plain; charset=utf-8"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
  ["ttf", "font/ttf"],
  ["otf", "font/otf"],
  ["pdf", "application/pdf"],
]);

/**
 * Returns the media type for a file, from the extension of its path; `undefined` when the gate does not serve files of that
 * extension, which includes a path without one.
 */
export function contentTypeOf(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  return dot <= slash ? undefined : TYPES.get(path.slice(dot + 1).toLowerCase());
}
