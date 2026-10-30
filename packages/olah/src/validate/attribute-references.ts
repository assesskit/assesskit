import type { AttributeType, ElementVisit } from "../asi/index.js";
import type { Findings } from "./findings.js";
import { elementPath } from "./model-access.js";
import type { StaticType } from "./static-type.js";

/** The base types a reference to a number may name, by the type of the attribute (INFO §2.7.2, §9.3, G34). */
const REFERABLE_BASE_TYPES = { integer: ["integer"], double: ["float", "integer"] } as const;

/** The type of an attribute that holds numbers or the identifiers of variables, alone or in a list. */
type ReferenceType = Extract<AttributeType, { kind: "reference" }>;

function referenceTypeOf(type: AttributeType): ReferenceType | undefined {
  if (type.kind === "reference") return type;
  return type.kind === "list" && type.item.kind === "reference" ? type.item : undefined;
}

/** Finds the variable an attribute names: `identifier` is the text of the attribute, `templateProcessing` where it is. */
export type ReferenceLookup = (identifier: string, templateProcessing: boolean) => StaticType | undefined;

/**
 * Checks the attributes that hold either a number or the identifier of a variable that holds it, such as the `figures` of
 * `qti-round-to`, the `tolerance` of `qti-equal` and the `base` of a printed variable (INFO §2.7.2, §9.3): the variable
 * must be a template or outcome variable in reach, single, of a base type that fits the attribute, so that the reference
 * resolves when the attribute is read.
 */
export class AttributeReferences {
  private readonly findings: Findings;
  private readonly lookup: ReferenceLookup;
  private readonly owner: string;

  /**
   * @param findings - Where the issues go.
   * @param lookup - Finds the variable an attribute names.
   * @param owner - What declares the variables, `item` or `test`, for messages.
   */
  constructor(findings: Findings, lookup: ReferenceLookup, owner: "item" | "test") {
    this.findings = findings;
    this.lookup = lookup;
    this.owner = owner;
  }

  /** Checks the references of one element. */
  visit(visit: ElementVisit): void {
    const templateProcessing = this.within(visit, "qti-template-processing");
    for (const definition of visit.attributes) {
      const type = referenceTypeOf(definition.type);
      if (type === undefined) continue;
      for (const identifier of this.identifiersOf(visit.model[definition.property])) {
        const found = this.lookup(identifier, templateProcessing);
        const here = elementPath(visit);
        if (found === undefined) {
          const message = `The attribute ${definition.name} of the ${visit.name} names ${JSON.stringify(identifier)}, which is no template or outcome variable of the ${this.owner} in reach.`;
          this.findings.error("olah/validate/undeclared-variable", message, "INFO §2.7.2", here);
          continue;
        }
        const accepted: readonly string[] = REFERABLE_BASE_TYPES[type.value];
        if (found.cardinality !== "single" || (found.baseType !== undefined && !accepted.includes(found.baseType))) {
          const message = `The attribute ${definition.name} of the ${visit.name} names ${JSON.stringify(identifier)}, which must be a single ${accepted.join(" or ")} variable.`;
          this.findings.error("olah/validate/reference-type", message, "INFO §2.7.2", here);
        }
      }
    }
  }

  private within(visit: ElementVisit, name: string): boolean {
    for (let at = visit.parent; at !== undefined; at = at.parent) if (at.name === name) return true;
    return false;
  }

  /** Returns the identifiers an attribute value names: the value, or the items of a list, when they are not numbers. */
  private identifiersOf(value: unknown): readonly string[] {
    if (typeof value === "string") return [value];
    if (!Array.isArray(value)) return [];
    return value.filter((member: unknown): member is string => typeof member === "string");
  }
}
