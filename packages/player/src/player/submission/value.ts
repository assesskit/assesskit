import {
  type FileValue,
  formatPrimitive,
  type Primitive,
  type SingleValue,
  type Value,
} from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import { essence } from "../content/embed.js";
import { html } from "../dom.js";

/** What the display of a value needs besides the value. */
export interface ValueContext {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The URL of a file value; absent when the host gives none, so that a file shows as its name. */
  readonly fileUrl: ((file: FileValue) => string) | undefined;
}

/** Returns the file value that a primitive is, or `undefined`. */
const fileOf = (primitive: Primitive): FileValue | undefined =>
  typeof primitive === "object" && "reference" in primitive ? primitive : undefined;

/**
 * Builds how a file that the candidate submitted shows. An image is an `img`, audio and video play with controls, and
 * anything else is a link that opens in a tab of its own. A file is never framed: the candidate chose its bytes and its
 * media type.
 */
function fileNode(file: FileValue, context: ValueContext): Node {
  const { messages, fileUrl } = context;
  const name = file.fileName ?? messages.submissionFile;
  if (fileUrl === undefined) return html("span", { class: "ak-submission-text" }, name);
  const url = fileUrl(file);
  const type = essence(file.mimeType);
  if (type.startsWith("image/")) return html("img", { src: url, alt: name });
  if (type.startsWith("audio/"))
    return html("audio", { src: url, controls: "", preload: "metadata", "aria-label": name });
  if (type.startsWith("video/"))
    return html("video", { src: url, controls: "", preload: "metadata", "aria-label": name });
  return html("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, name);
}

/**
 * Builds a primitive. A string keeps its line breaks and takes the direction of its text; the other base types show in
 * their lexical form (INFO §8.13).
 */
function primitiveNode(value: SingleValue, primitive: Primitive, context: ValueContext): Node {
  const file = fileOf(primitive);
  if (file !== undefined) return fileNode(file, context);
  if (typeof primitive === "string" && value.baseType === "string") {
    return html("span", { class: "ak-submission-text", dir: "auto" }, primitive);
  }
  return html("span", {}, formatPrimitive(primitive, value.baseType));
}

/** Builds the list of the values of a container: ordered for `ordered`, else unordered. */
function listNode(
  value: Extract<Value, { readonly cardinality: "multiple" | "ordered" }>,
  context: ValueContext,
): Node {
  const items = value.values.map((primitive) =>
    html(
      "li",
      {},
      primitiveNode({ cardinality: "single", baseType: value.baseType, value: primitive }, primitive, context),
    ),
  );
  return html(value.cardinality === "ordered" ? "ol" : "ul", { class: "ak-submission-list" }, ...items);
}

/** Builds the fields of a record as a list of names and values. */
function recordNode(value: Extract<Value, { readonly cardinality: "record" }>, context: ValueContext): Node {
  const fields = [...value.fields].map(([identifier, field]) =>
    html("div", {}, html("dt", {}, identifier), html("dd", {}, primitiveNode(field, field.value, context))),
  );
  return html("dl", { class: "ak-submission-fields" }, ...fields);
}

/**
 * Builds how a value shows to a rater: a single value as its text, a container as a list, a record as names and values, a
 * file as an image, a player or a link, and NULL as the given text.
 *
 * @param value - The value, or `null` for NULL.
 * @param none - The text that stands for NULL.
 */
export function valueNode(value: Value | null, none: string, context: ValueContext): HTMLElement {
  const content: Node =
    value === null
      ? html("span", { class: "ak-submission-none" }, none)
      : value.cardinality === "single"
        ? primitiveNode(value, value.value, context)
        : value.cardinality === "record"
          ? recordNode(value, context)
          : listNode(value, context);
  return html("div", { class: "ak-submission-value" }, content);
}
