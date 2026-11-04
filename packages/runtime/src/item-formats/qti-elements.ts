import { ASI_NAMESPACE } from "../asi/index.js";
import type { XmlElement, XmlNode } from "../xml/index.js";

// Builders of the QTI elements that a reader writes, as XML trees that `readAsi` then reads into the model.

/** An element of the ASI namespace with its attributes, in order, and its children; an attribute without value is left out. */
export function qti(
  name: string,
  attributes: Readonly<Record<string, string | undefined>> = {},
  children: readonly (XmlNode | string)[] = [],
): XmlElement {
  return {
    kind: "element",
    namespace: ASI_NAMESPACE,
    name,
    attributes: Object.entries(attributes).flatMap(([attribute, value]) =>
      value === undefined ? [] : [{ namespace: "", name: attribute, value }],
    ),
    children: children.flatMap((child) =>
      typeof child === "string" ? (child === "" ? [] : [{ kind: "text" as const, value: child }]) : [child],
    ),
  };
}

/** A number as an attribute or a value of the base type `float` writes it. */
export function formatFloat(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

/** `qti-variable`. */
export function variable(identifier: string): XmlElement {
  return qti("qti-variable", { identifier });
}

/** `qti-base-value`. */
export function baseValue(baseType: string, value: string): XmlElement {
  return qti("qti-base-value", { "base-type": baseType }, [value]);
}

/** `qti-set-outcome-value`. */
export function setOutcome(identifier: string, expression: XmlElement): XmlElement {
  return qti("qti-set-outcome-value", { identifier }, [expression]);
}

/** `qti-is-null` of a variable. */
export function isNull(identifier: string): XmlElement {
  return qti("qti-is-null", {}, [variable(identifier)]);
}

/** A response condition of branches, each a test and its rules, and the rules of an else, if any. */
export function condition(
  branches: readonly (readonly [XmlElement, readonly XmlElement[]])[],
  otherwise?: readonly XmlElement[],
): XmlElement {
  return qti("qti-response-condition", {}, [
    ...branches.map(([test, rules], index) =>
      qti(index === 0 ? "qti-response-if" : "qti-response-else-if", {}, [test, ...rules]),
    ),
    ...(otherwise === undefined ? [] : [qti("qti-response-else", {}, otherwise)]),
  ]);
}

/** A declaration of an outcome of the base type `float` with its default value. */
export function floatOutcome(
  identifier: string,
  value: number,
  attributes: Readonly<Record<string, string | undefined>> = {},
): XmlElement {
  return qti("qti-outcome-declaration", { identifier, cardinality: "single", "base-type": "float", ...attributes }, [
    qti("qti-default-value", {}, [qti("qti-value", {}, [formatFloat(value)])]),
  ]);
}
