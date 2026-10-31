import { buildElement, type XmlElement } from "../xml/index.js";
import { CSM_NAMESPACE, DRD_NAMESPACE, QTI_METADATA_NAMESPACE } from "./namespaces.js";

/** A namespace with the prefix that the writers give it. */
export interface QualifiedName {
  readonly namespace: string;
  readonly prefix: string;
}

/** The namespace of QTI metadata, written with the prefix `qmd`. */
export const QMD: QualifiedName = { namespace: QTI_METADATA_NAMESPACE, prefix: "qmd" };

/** The namespace of curriculum standards metadata, written with the prefix `csmd`. */
export const CSMD: QualifiedName = { namespace: CSM_NAMESPACE, prefix: "csmd" };

/** The namespace of the accessibility description, written with the prefix `drd`. */
export const DRD: QualifiedName = { namespace: DRD_NAMESPACE, prefix: "drd" };

/** Builds an element of a namespace with the prefix the writers give it; see `buildElement`. */
export function branch(
  { namespace, prefix }: QualifiedName,
  name: string,
  children: readonly (XmlElement | string)[],
  attributes: Readonly<Record<string, string | undefined>> = {},
): XmlElement {
  return { ...buildElement(namespace, name, attributes, children), prefix };
}

/** Builds an element of a namespace that holds text. */
export function leaf(qualified: QualifiedName, name: string, text: string): XmlElement {
  return branch(qualified, name, [text]);
}

/** Appends an element that holds text, unless the text is `undefined`. */
export function appendLeaf(
  children: XmlElement[],
  qualified: QualifiedName,
  name: string,
  text: string | undefined,
): void {
  if (text !== undefined) children.push(leaf(qualified, name, text));
}
