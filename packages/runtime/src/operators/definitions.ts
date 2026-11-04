/**
 * The `definition` of each operator, by the name it is called as its `class`: a fixed `urn:uuid:` that names its semantics.
 * The URIs depend on no brand, so response processing is the same under any name the content is published under; a change
 * that alters any verdict takes a new one.
 */
export const OPERATOR_DEFINITIONS = Object.freeze({
  /** The definition of `expression-equivalent`. */
  "expression-equivalent": "urn:uuid:bca67099-ac73-46d0-acb0-2b025e61b552",
  /** The definition of `number-equivalent`. */
  "number-equivalent": "urn:uuid:12fcd638-f818-41f5-a3f0-93f97e2a6250",
  /** The definition of `text-equivalent`. */
  "text-equivalent": "urn:uuid:02d09ea0-c251-49b1-95b2-96e4f3b9b540",
  /** The definition of `hotspot-matching`. */
  "hotspot-matching": "urn:uuid:3c8b8eae-0afe-4329-ab44-eb1679444afc",
  /** The definition of `readable`. */
  readable: "urn:uuid:6fab098c-9ba4-4314-92dd-8662c0c0489c",
});

/** The namespace of the `options` attribute that carries an operator's key on its `qti-custom-operator`. */
export const OPERATOR_NAMESPACE = "urn:uuid:37ee0bb1-9b3b-4da2-92a2-3102380d98b5";

/** The local name of the attribute that carries the options. */
export const OPTIONS_ATTRIBUTE = "options";

/** The prefix that `buildOperatorCall` binds to the namespace; a reader finds the attribute by namespace, whatever its prefix. */
export const OPTIONS_PREFIX = "operator";

/** The five operators of response processing, by the name each is called as its `class`. */
export type OperatorName = keyof typeof OPERATOR_DEFINITIONS;

/** The names of the operators, in the order of `OPERATOR_DEFINITIONS`. */
export const OPERATOR_NAMES: readonly OperatorName[] = Object.freeze(
  // `Object.keys` types its result as strings; the keys of the table are its names.
  Object.keys(OPERATOR_DEFINITIONS) as OperatorName[],
);
