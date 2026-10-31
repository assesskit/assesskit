import type { XmlElement, XmlNode } from "@assesskit/runtime/xml";
import { plainText, ssmlElement } from "./ssml.js";

/**
 * Makes a text node of an SSML document.
 *
 * @param value - The text.
 * @returns The node.
 */
export const textNode = (value: string): XmlNode => ({ kind: "text", value });

/**
 * Counts the words of a text that has single spaces between them.
 *
 * @param text - The text.
 * @returns The number of words.
 */
export function wordsIn(text: string): number {
  return text.split(" ").filter((word) => word !== "").length;
}

/**
 * Removes the space at the start of a paragraph and the second of two in a row, across the nodes.
 *
 * @param nodes - The nodes of a paragraph.
 * @returns The nodes without those spaces.
 */
function collapseSpaces(nodes: readonly XmlNode[]): XmlNode[] {
  let afterSpace = true;
  const walk = (list: readonly XmlNode[]): XmlNode[] =>
    list.flatMap((node): XmlNode[] => {
      if (node.kind === "element") return [{ ...node, children: walk(node.children) }];
      if (node.kind !== "text") return [node];
      const value = afterSpace ? node.value.replace(/^ /u, "") : node.value;
      if (value === "") return [];
      afterSpace = value.endsWith(" ");
      return [textNode(value)];
    });
  return walk(nodes);
}

/** Removes the space at the end of a paragraph. */
function trimEnd(nodes: readonly XmlNode[]): XmlNode[] {
  const last = nodes.at(-1);
  if (last === undefined) return [];
  const rest = nodes.slice(0, -1);
  if (last.kind === "element") return [...rest, { ...last, children: trimEnd(last.children) }];
  if (last.kind !== "text") return [...rest, last];
  const value = last.value.replace(/ $/u, "");
  return value === "" ? trimEnd(rest) : [...rest, textNode(value)];
}

/**
 * Makes a paragraph of a run of inline nodes.
 *
 * @param run - The inline nodes.
 * @returns The `p` element, or `undefined` when the run says nothing.
 */
export function paragraph(run: readonly XmlNode[]): XmlElement | undefined {
  const nodes = trimEnd(collapseSpaces(run));
  return plainText(nodes) === "" ? undefined : ssmlElement("p", {}, nodes);
}
