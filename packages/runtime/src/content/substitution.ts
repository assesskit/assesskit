import type { BodyNode } from "../asi/index.js";
import type { Value } from "../values/index.js";
import { singleText } from "./printed-variable.js";

/** An element that the model keeps as XML: MathML, SSML or `xi:include`. */
type XmlElement = Extract<BodyNode, { kind: "element" }>;

/**
 * The namespace of MathML 3.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";

/**
 * The MathML elements for an identifier, in presentation and in content markup, and the elements for a number.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const NUMBER_OF: ReadonlyMap<string, string> = new Map([
  ["mi", "mn"],
  ["ci", "cn"],
]);

/**
 * Returns the text a template variable's value is substituted as in an `object` parameter or in MathML.
 *
 * @remarks
 * Identifiers, strings and uris are written as they are, integers by `%i`, floats and durations by `%G`, booleans as
 * `true` or `false`, points as `x y` and pairs as `a b`. Containers, records, files and NULL have none.
 *
 * @param value - The value of the template variable.
 * @returns The text, or `undefined` for a value that has none.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
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
 * variable's value as its content.
 *
 * @param element - A MathML element, with its descendants.
 * @param values - The text of each template variable by identifier, as `templateText` gives it.
 * @returns A copy of the element with the substitutions.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
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
