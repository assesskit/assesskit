import { finiteSchema, parseWith, type Schema } from "@assesskit/runtime/checks";
import type { ScoringDeclaration } from "@assesskit/runtime/delivery";
import { BASE_TYPES } from "@assesskit/runtime/values";
import * as v from "valibot";

const optionalString = v.optional(v.string());
const optionalFinite = v.optional(finiteSchema);

/** The entries of a declaration that its cardinality does not change. */
const declarationRest = {
  normalMinimum: optionalFinite,
  normalMaximum: optionalFinite,
  masteryValue: optionalFinite,
  interpretation: optionalString,
  longInterpretation: optionalString,
};

/** The schema of a scoring declaration. A record has no base type, so the property is not allowed beside it. */
export const declarationSchema: Schema<ScoringDeclaration> = v.variant("cardinality", [
  v.strictObject({ cardinality: v.literal("record"), ...declarationRest }),
  v.strictObject({
    cardinality: v.picklist(["multiple", "ordered", "single"]),
    baseType: v.picklist(BASE_TYPES),
    ...declarationRest,
  }),
]);

/**
 * Checks the declaration of an outcome as a scoring request carries it: its cardinality and base type, which a record
 * lacks, its numbers and its texts.
 *
 * @param declaration - The declaration.
 * @throws `DataError` when it is not a declaration.
 */
export function checkDeclaration(declaration: unknown): asserts declaration is ScoringDeclaration {
  parseWith(declarationSchema, declaration, "The declaration of a submission");
}
