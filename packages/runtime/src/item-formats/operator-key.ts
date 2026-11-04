import { OPERATOR_NAMESPACE } from "../operators/index.js";
import { OPERATOR_NAMES, parseOptions } from "../operators/internal.js";
import type { XmlElement } from "../xml/index.js";
import { attribute } from "./probe.js";

/** The name of the attribute that carries the options of an operator's call. */
const OPTIONS_ATTRIBUTE = "options";

/**
 * The key of the call that a `qti-custom-operator` makes, read as the operator reads it: `buildOperatorCall` wrote it into
 * the attribute `options` of `OPERATOR_NAMESPACE`, with every field present. None when the operator is not one of the
 * runtime's or its options are not valid, as a call that fails in processing leaves the item out.
 */
export function operatorKey(element: XmlElement) {
  const name = OPERATOR_NAMES.find((candidate) => candidate === attribute(element, "class"));
  const text = element.attributes.find(
    (candidate) => candidate.namespace === OPERATOR_NAMESPACE && candidate.name === OPTIONS_ATTRIBUTE,
  )?.value;
  if (name === undefined || text === undefined) return undefined;
  try {
    return parseOptions(name, JSON.parse(text), "").key;
  } catch {
    return undefined;
  }
}
