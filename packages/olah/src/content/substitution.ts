import type { BodyNode } from "../asi/index.js";
import type { Value } from "../values/index.js";
import { singleText } from "./printed-variable.js";

/** An element that the model keeps as XML: MathML, SSML or `xi:include`. */
type XmlElement = Extract<BodyNode, { kind: "element" }>;

/** The namespace of MathML 3 (INFO §2.3.3). */
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";

/** The MathML elements for an identifier, in presentation and in content markup, and the elements for a number (INFO §2.3.3). */
const NUMBER_OF: ReadonlyMap<string, string> = new Map([
  ["mi", "mn"],
  ["ci", "cn"],
]);

/**
 * Returns the text a template variable's value is substituted as in an `object` parameter or in MathML (INFO §7.29.2):
 * identifiers, strings and uris as they are, integers by `%i`, floats and durations by `%G`, booleans as `true` or
 * `false`, points as `x y` and pairs as `a b`. Containers, records, files and NULL have none.
 */
export function templateText(value: Value | null | undefined): string | undefined {
  if (value === null || value === undefined || value.cardinality !== "single" || value.baseType === "file") {
    return undefined;
  }
  return singleText(value);
}

function textOf(element: XmlElement): string {
  return element.children
    .map((child) => {
      if (child.kind === "element") return textOf(child);
      return child.kind === "text" || child.kind === "cdata" ? child.value : "";
    })
    .join("");
}

/**
 * Replaces every `mi` and `ci` in MathML whose text names a template variable of `values` by an `mn` or `cn` with the
 * variable's value as its content (INFO §2.3.3, §5.151.5).
 */
export function substituteMath(element: XmlElement, values: ReadonlyMap<string, string>): XmlElement {
  const number = element.namespace === MATHML_NAMESPACE ? NUMBER_OF.get(element.name) : undefined;
  const text = number === undefined ? undefined : values.get(textOf(element).trim());
  if (number !== undefined && text !== undefined) {
    return { ...element, name: number, children: [{ kind: "text", value: text }] };
  }
  return {
    ...element,
    children: element.children.map((child) => (child.kind === "element" ? substituteMath(child, values) : child)),
  };
}
