import type { PrintedVariable } from "@assesskit/runtime/asi";
import { formatPrintedVariable } from "@assesskit/runtime/content";
import type { FileValue, Primitive, Value } from "@assesskit/runtime/values";
import { html } from "../dom.js";
import type { RenderContext } from "./context.js";
import { resolveUrl } from "./urls.js";

/** Returns the value that a printed variable prints: an outcome, else a template variable (INFO §7.30.6). */
function variableValue(identifier: string, context: RenderContext): Value | null {
  const variables = context.variables;
  if (variables === undefined) return null;
  return variables.outcomes.has(identifier)
    ? (variables.outcomes.get(identifier) ?? null)
    : (variables.templates.get(identifier) ?? null);
}

/** Returns the file value that a primitive is, or `undefined`. */
const fileOf = (primitive: Primitive): FileValue | undefined =>
  typeof primitive === "object" && "reference" in primitive ? primitive : undefined;

/** Builds the link that opens a URL in a tab of its own, with the text that the runtime formatted. */
function link(href: string, text: string): HTMLElement {
  return html("a", { href, target: "_blank", rel: "noopener noreferrer" }, text);
}

/**
 * Renders a `qti-printed-variable` that content still holds: the runtime formats the text of the variable's value (INFO §7.30),
 * and the value of a `uri` or a `file` is a link to it, which opens in a tab of its own. Without variables a printed
 * variable prints nothing, as a NULL value does. Content that `resolveContent` of the runtime has resolved holds the text itself.
 */
export function renderPrinted(node: PrintedVariable, context: RenderContext): Element {
  const element = context.element("qti-printed-variable", node, []);
  const { variables, fileUrl } = context;
  if (variables === undefined) return element;
  const value = variableValue(node.identifier, context);
  const text = formatPrintedVariable(node, value, variables);
  if (value?.cardinality === "single" && value.baseType === "uri" && typeof value.value === "string") {
    const href = resolveUrl(value.value, context.urls, "navigate");
    element.append(href === undefined ? text : link(href, text));
  } else if (value?.cardinality === "single" && value.baseType === "file") {
    const file = fileOf(value.value);
    element.append(file === undefined || fileUrl === undefined ? text : link(fileUrl(file), text));
  } else {
    element.append(text);
  }
  return element;
}
