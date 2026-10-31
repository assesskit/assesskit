import * as v from "valibot";
import { parseWith } from "../checks.js";
import { type BaseType, baseTypeSchema } from "./base-type.js";
import type { Cardinality } from "./cardinality.js";

/** What a variable declaration says about its values: the cardinality and, except for a record, the base type. */
export interface ValueDeclaration {
  /** The cardinality. */
  readonly cardinality: Cardinality;
  /** The base type. A record has none, and one given for a record is checked and ignored. */
  readonly baseType?: BaseType;
}

/** A declaration read and checked: a record has no base type. */
export type Declared =
  | { readonly cardinality: "record" }
  | { readonly cardinality: "single" | "multiple" | "ordered"; readonly baseType: BaseType };

const declarationSchema = v.variant("cardinality", [
  v.object({ cardinality: v.literal("record"), baseType: v.optional(baseTypeSchema) }),
  v.object({ cardinality: v.picklist(["single", "multiple", "ordered"]), baseType: baseTypeSchema }),
]);

/**
 * Checks a declaration from untrusted data.
 *
 * @throws `DataError` when it is not a cardinality with a base type, or a record, which has none.
 */
export function readDeclaration(declaration: unknown): Declared {
  const declared = parseWith(declarationSchema, declaration, "The declaration");
  return declared.cardinality === "record" ? { cardinality: "record" } : declared;
}
