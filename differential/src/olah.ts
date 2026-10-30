import { OlahError } from "@luthfanwakan/olah";
import { type AssessmentItem, type ResponseDeclaration, readAsi } from "@luthfanwakan/olah/asi";
import {
  createItemVariables,
  type ItemVariables,
  runResponseProcessing,
  runTemplateProcessing,
} from "@luthfanwakan/olah/processing";
import {
  type BaseType,
  container,
  type Primitive,
  parsePrimitive,
  single,
  type Value,
} from "@luthfanwakan/olah/values";
import { longsightRandom } from "./longsight.ts";
import type { Implementation, ItemCase, Observed, Scalar } from "./model.ts";

/** Returns a primitive in the neutral form: points, pairs and files as the text that the oracle reports. */
function scalarOf(primitive: Primitive): Scalar {
  if (typeof primitive !== "object") return primitive;
  return "reference" in primitive ? primitive.reference : primitive.join(" ");
}

/** Returns a value in the neutral form. */
function observe(value: Value | null): Observed {
  if (value === null) return null;
  if (value.cardinality === "single") return scalarOf(value.value);
  if (value.cardinality === "record") {
    return Object.fromEntries([...value.fields].map(([name, field]) => [name, scalarOf(field.value)]));
  }
  return value.values.map(scalarOf);
}

/** Returns the values of a map in the neutral form, by identifier. */
function observeAll(values: ReadonlyMap<string, Value | null>): Record<string, Observed> {
  return Object.fromEntries([...values].map(([identifier, value]) => [identifier, observe(value)]));
}

/** Reads a scalar of the neutral form as a primitive of a base type. */
function primitiveOf(scalar: Observed, baseType: BaseType): Primitive {
  if (typeof scalar === "number" || typeof scalar === "boolean") return scalar;
  if (typeof scalar === "string") return baseType === "string" ? scalar : parsePrimitive(scalar, baseType);
  throw new Error(`A response holds ${JSON.stringify(scalar)} where a ${baseType} belongs.`);
}

/** Reads a response in the neutral form as a value of its declaration; the cases give no record responses. */
function responseOf(observed: Observed, declaration: ResponseDeclaration): Value | null {
  const { identifier, cardinality, baseType = "string" } = declaration;
  if (observed === null) return null;
  if (cardinality === "record") throw new Error(`The case gives the record response ${identifier}.`);
  if (cardinality === "single") return single(baseType, primitiveOf(observed, baseType));
  const items = Array.isArray(observed) ? observed : [observed];
  return container(
    cardinality,
    baseType,
    items.map((item) => primitiveOf(item, baseType)),
  );
}

/**
 * Gives an item the responses of a case as the delivery engine does in the first attempt (INFO §2.2.2.2–3):
 * `numAttempts` becomes 1, `completionStatus` becomes `unknown`, and a response the case leaves out has its default
 * value. A case without responses makes no attempt unless the item is adaptive, as in the oracle.
 */
function attempt(item: AssessmentItem, variables: ItemVariables, responses: ItemCase["responses"]): ItemVariables {
  if (Object.keys(responses).length === 0 && item.adaptive !== true) return variables;
  const given = new Map(variables.responses);
  given.set("numAttempts", single("integer", 1));
  for (const declaration of item.responseDeclarations) {
    const { identifier } = declaration;
    given.set(
      identifier,
      Object.hasOwn(responses, identifier)
        ? responseOf(responses[identifier] ?? null, declaration)
        : (variables.defaults.get(identifier) ?? null),
    );
  }
  const outcomes = new Map(variables.outcomes);
  outcomes.set("completionStatus", single("identifier", "unknown"));
  return { ...variables, responses: given, outcomes };
}

/**
 * olah: template processing, then the responses, then response processing. It draws from the oracle's generator with
 * the case's seed, and both draw by the same procedures, so that they draw the same template values.
 */
export const olah: Implementation = {
  name: "olah",
  run: ({ xml, responses, seed }: ItemCase) => {
    try {
      const document = readAsi(xml);
      if (document.kind !== "item") return { accepted: false, reason: `The document is a ${document.kind}.` };
      const { item } = document;
      const random = longsightRandom(seed);
      const instance = runTemplateProcessing(item, createItemVariables(item), { random });
      const scored = runResponseProcessing(item, attempt(item, instance, responses), { random });
      return {
        accepted: true,
        observation: { outcomes: observeAll(scored.outcomes), templateValues: observeAll(scored.templates) },
      };
    } catch (error) {
      if (error instanceof OlahError) return { accepted: false, reason: error.message };
      throw error;
    }
  },
};
